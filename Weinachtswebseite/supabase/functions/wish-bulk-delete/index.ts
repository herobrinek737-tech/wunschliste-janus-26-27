import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const recipient = 'janus.kleine@cbg-duelmen.de'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
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

function generateCode() {
  const random = new Uint32Array(1)
  do {
    crypto.getRandomValues(random)
  } while (random[0] >= 4_294_000_000)
  return String(random[0] % 1_000_000).padStart(6, '0')
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
    if ((slug !== 'janus' && slug !== 'marlene') || (action !== 'send' && action !== 'confirm')) {
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

    if (action === 'send') {
      const mailKey = Deno.env.get('RESEND_API_KEY')
      const sender = Deno.env.get('WISH_BULK_DELETE_FROM')
      if (!mailKey || !sender) return reply({ message: 'Der E-Mail-Versand für die Löschfunktion ist noch nicht eingerichtet.' }, 503)

      const code = generateCode()
      const challenge = await service.rpc('start_wish_bulk_delete', {
        ...params,
        p_code_hash: await hashCode(serviceKey, scope, code),
      })
      if (challenge.error) throw challenge.error
      if (!challenge.data) return reply({ message: 'Bitte warte 60 Sekunden zwischen zwei Code-Anfragen.' }, 429)

      const listName = slug === 'janus' ? 'Janus' : 'Marlene'
      const mail = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + mailKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: sender,
          to: [recipient],
          subject: 'Bestätigung zum Löschen der Wunschliste von ' + listName,
          text: 'Dein Bestätigungscode lautet ' + code + '. Er ist zehn Minuten gültig und bestätigt, dass alle Produkte auf der Wunschliste von ' + listName + ' gelöscht werden sollen. Wenn du das nicht angefordert hast, ignoriere diese E-Mail.',
        }),
      })
      if (!mail.ok) {
        console.error('Mail provider returned status', mail.status)
        return reply({ message: 'Der Code konnte nicht gesendet werden. Bitte versuche es in einer Minute erneut.' }, 502)
      }
      return reply({ sent: true })
    }

    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return reply({ message: 'Bitte gib den sechsstelligen Code ein.' }, 400)
    }
    const result = await service.rpc('finish_wish_bulk_delete', {
      ...params,
      p_code_hash: await hashCode(serviceKey, scope, body.code),
    })
    if (result.error) throw result.error
    switch (result.data?.status) {
      case 'deleted': return reply({ count: result.data.count })
      case 'invalid': return reply({ message: 'Der Code ist falsch.' }, 400)
      case 'expired': return reply({ message: 'Der Code ist abgelaufen, verbraucht oder gesperrt. Fordere einen neuen an.' }, 409)
      case 'protected': return reply({ message: 'Kläre zuerst offene Reservierungen und zugesagte Teilbeträge in dieser Wunschliste.' }, 409)
      default: throw new Error('Unexpected bulk delete result')
    }
  } catch {
    console.error('Bulk delete request failed')
    return reply({ message: 'Die Anfrage konnte nicht abgeschlossen werden.' }, 500)
  }
})
