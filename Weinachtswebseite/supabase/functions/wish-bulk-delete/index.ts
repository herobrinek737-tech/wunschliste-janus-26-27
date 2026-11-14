import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.119.0/cors'

const recipient = 'janus.kleine@cbg-duelmen.de'
const callbackUrl = 'https://herobrinek737-tech.github.io/wunschliste-janus-26-27/'
const cors = {
  ...corsHeaders,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: cors })
}

async function hashCode(secret: string, scope: string, code: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(scope + ':' + code))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (request.method !== 'POST') return reply({ message: 'Ungültige Anfrage.' }, 405)
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.match(/^Bearer (\S+)$/i)?.[1]
  if (!token) return reply({ message: 'Bitte zuerst anmelden.' }, 401)

  try {
    const body = await request.json().catch(() => null)
    const slug = body?.listSlug
    const action = body?.action
    if ((slug !== 'janus' && slug !== 'marlene') || !['send-link', 'verify-link', 'delete-confirmed'].includes(action)) {
      return reply({ message: 'Ungültige Anfrage.' }, 400)
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const auth = { persistSession: false, autoRefreshToken: false }
    const client = createClient(url, publicKey, { auth, global: { headers: { Authorization: authorization } } })
    const [userResult, claimResult, capability] = await Promise.all([
      client.auth.getUser(token),
      client.auth.getClaims(token),
      client.rpc('can_manage_wish_list', { p_list_slug: slug }),
    ])
    const user = userResult.data.user
    const claims = claimResult.data?.claims
    if (!user || user.email?.toLowerCase() !== recipient || !user.email_confirmed_at ||
      !claims?.session_id || claims.sub !== user.id || capability.data !== true) {
      return reply({ message: 'Dieses Konto darf hier keine Sammellöschung starten.' }, 403)
    }
    if (!claims.amr?.some((method) => (typeof method === 'string' ? method : method.method) === 'password')) {
      return reply({ message: 'Bitte melde dich mit deinem Admin-Passwort an und versuche es erneut.' }, 403)
    }

    const params = { p_user_id: user.id, p_session_id: claims.session_id, p_list_slug: slug }
    const scope = [user.id, claims.session_id, slug].join(':')
    const service = createClient(url, serviceKey, { auth })

    const authHeaders = { apikey: publicKey, 'Content-Type': 'application/json' }
    const state = action === 'send-link' ? crypto.randomUUID() : body.state
    if (typeof state !== 'string' || !/^[a-f0-9-]{36}$/.test(state)) {
      return reply({ message: 'Starte die Bestätigung im selben Browser erneut.' }, 400)
    }
    const verifier = await hashCode(serviceKey, scope, 'pkce:' + state)
    const challengeHash = await hashCode(serviceKey, scope, 'challenge:' + state)

    if (action === 'send-link') {
      const challenge = await service.rpc('start_wish_bulk_delete', { ...params, p_code_hash: challengeHash })
      if (challenge.error) throw challenge.error
      if (!challenge.data) return reply({ message: 'Bitte warte 60 Sekunden zwischen zwei Anfragen.' }, 429)
      const otpUrl = new URL('/auth/v1/otp', url)
      otpUrl.searchParams.set('redirect_to', callbackUrl)
      const mail = await fetch(otpUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: recipient,
          create_user: false,
          code_challenge: await pkceChallenge(verifier),
          code_challenge_method: 's256',
        }),
      })
      if (mail.status === 429) {
        return reply({ message: 'Das E-Mail-Limit ist erreicht. Versuche es später erneut.' }, 429)
      }
      if (!mail.ok) {
        console.error('Supabase Auth email status', mail.status)
        return reply({ message: 'Der Bestätigungslink konnte nicht gesendet werden.' }, 502)
      }
      return reply({ state })
    }

    const proof = await hashCode(serviceKey, scope, 'approved:' + state)
    if (action === 'verify-link') {
      if (typeof body.code !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.code)) {
        return reply({ message: 'Der Bestätigungslink ist ungültig.' }, 400)
      }
      const pending = await service.from('wish_bulk_delete_challenges').select('sent_at')
        .eq('user_id', user.id).eq('session_id', claims.session_id).eq('list_slug', slug)
        .eq('code_hash', challengeHash).eq('consumed', false)
        .gt('sent_at', new Date(Date.now() - 600_000).toISOString()).maybeSingle()
      if (pending.error) throw pending.error
      if (!pending.data) return reply({ message: 'Der Link ist abgelaufen. Fordere einen neuen an.' }, 409)
      const exchange = await fetch(new URL('/auth/v1/token?grant_type=pkce', url), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ auth_code: body.code, code_verifier: verifier }),
      })
      const verified = exchange.ok ? await exchange.json() : null
      if (verified?.user?.id !== user.id || verified.user.email?.toLowerCase() !== recipient) {
        return reply({ message: 'Der Link ist abgelaufen, wurde bereits verwendet oder gehört zu einer anderen Anmeldung.' }, 400)
      }
      // The extra Auth session proves mailbox access. The original password session remains in use.
      await fetch(new URL('/auth/v1/logout?scope=local', url), {
        method: 'POST',
        headers: { ...authHeaders, Authorization: 'Bearer ' + verified.access_token },
      }).catch(() => {})
      return reply({ proof })
    }

    if (body.proof !== proof) return reply({ message: 'Bestätige zuerst den Link aus der E-Mail.' }, 403)
    const result = await service.rpc('finish_wish_bulk_delete', { ...params, p_code_hash: challengeHash })
    if (result.error) throw result.error
    switch (result.data?.status) {
      case 'deleted': return reply({ count: result.data.count })
      case 'invalid':
      case 'expired': return reply({ message: 'Die Bestätigung ist abgelaufen oder verbraucht. Fordere einen neuen Link an.' }, 409)
      case 'protected': return reply({ message: 'Kläre zuerst offene Reservierungen und zugesagte Teilbeträge in dieser Wunschliste.' }, 409)
      default: throw new Error('Unexpected bulk delete result')
    }
  } catch {
    console.error('Bulk delete request failed')
    return reply({ message: 'Die Anfrage konnte nicht abgeschlossen werden.' }, 500)
  }
})
