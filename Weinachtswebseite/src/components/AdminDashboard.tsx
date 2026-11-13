import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { deleteItem, getAdminItems, resetItem, saveItem, saveOrder } from '../lib/api'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { AdminWishItem } from '../lib/types'

const ADMIN_EMAIL = 'janus.kleine@cbg-duelmen.de'

function money(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function SortableRow({
  item,
  index,
  onEdit,
  onReset,
  onDelete,
}: {
  item: AdminWishItem
  index: number
  onEdit: (item: AdminWishItem) => void
  onReset: (item: AdminWishItem) => void
  onDelete: (item: AdminWishItem) => void
}) {
  const sortable = useSortable({ id: item.id, index })
  return (
    <tr ref={sortable.ref} className={sortable.isDragging ? 'admin-row dragging' : 'admin-row'}>
      <td className="drag-cell"><button ref={sortable.handleRef} className="drag-handle" aria-label={'Sortiere ' + item.title} title="Ziehen zum Sortieren">⠿</button></td>
      <td className="admin-item-title"><span className="mobile-row-label">Artikel</span><strong>{item.title}</strong><a href={item.url} target="_blank" rel="noreferrer">Shop öffnen ↗</a></td>
      <td>{money(item.price_cents)}</td>
      <td>
        {item.reserved_by ? (
          <div className="giver-info"><span className="status-pill status-taken">Verschenkt</span><strong>{item.reserved_by}</strong>{item.reserved_email && <small>{item.reserved_email}</small>}</div>
        ) : <span className="status-pill status-free">Verfügbar</span>}
      </td>
      <td className="actions-cell">
        <button className="text-action" onClick={() => onEdit(item)}>Bearbeiten</button>
        {item.reserved_by && <button className="text-action" onClick={() => onReset(item)}>Freigeben</button>}
        <button className="text-action text-danger" onClick={() => onDelete(item)}>Löschen</button>
      </td>
    </tr>
  )
}

function ItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: AdminWishItem | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [url, setUrl] = useState(item?.url ?? 'https://')
  const [priceInput, setPriceInput] = useState(item ? (item.price_cents / 100).toFixed(2) : '')
  const [isFeatured, setIsFeatured] = useState(item?.is_featured ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const numericPrice = Number(priceInput.replace(',', '.'))
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        throw new Error('Bitte einen gültigen Preis eingeben.')
      }
      await saveItem({
        id: item?.id ?? null,
        title: title.trim(),
        url: url.trim(),
        price_cents: Math.round(numericPrice * 100),
        is_featured: isFeatured,
      })
      await onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Artikel konnte nicht gespeichert werden.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="reserve-modal editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <button className="modal-close" onClick={onClose} aria-label="Schließen">×</button>
        <p className="eyebrow">Wunschliste bearbeiten</p>
        <h2 id="editor-title">{item ? 'Artikel ändern' : 'Wunsch hinzufügen'}</h2>
        <form onSubmit={submit}>
          <label htmlFor="item-title">Produkttitel</label>
          <input id="item-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required />
          <label htmlFor="item-url">Shop-Link</label>
          <input id="item-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required />
          <label htmlFor="item-price">Preis in Euro</label>
          <input id="item-price" inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} required placeholder="0,00" />
          <label className="featured-option"><input type="checkbox" checked={isFeatured} onChange={(event) => setIsFeatured(event.target.checked)} /> Als Hauptwunsch hervorheben</label>
          <button className="gift-button modal-submit" disabled={pending}>{pending ? 'Speichert …' : 'Speichern'} <span aria-hidden="true">↗</span></button>
          {error && <p className="form-message" role="alert">{error}</p>}
        </form>
      </section>
    </div>
  )
}

function AdminDashboard() {
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
  const [items, setItems] = useState<AdminWishItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [loginCooldown, setLoginCooldown] = useState(0)
  const [loginNotice, setLoginNotice] = useState('')
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminWishItem | null>(null)

  useEffect(() => {
    if (loginCooldown === 0) return
    const timer = window.setTimeout(() => setLoginCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [loginCooldown])

  async function refresh() {
    setLoading(true)
    try {
      setItems(await getAdminItems())
      setFormError('')
    } catch (reason) {
      const problem = reason instanceof Error ? reason.message : 'Admin-Daten konnten nicht geladen werden.'
      setFormError(problem)
      if (/autorisiert/i.test(problem)) {
        await requireSupabase().auth.signOut()
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    const client = requireSupabase()
    client.auth.getSession().then(({ data }) => setSignedInEmail(data.session?.user.email ?? null))
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (signedInEmail) void refresh()
    else setItems([])
  }, [signedInEmail])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFormError('')
    setLoginNotice('')
    try {
      const { error } = await requireSupabase().auth.signInWithPassword({ email: ADMIN_EMAIL, password })
      if (error) throw error
      setPassword('')
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Anmeldung fehlgeschlagen.')
    } finally {
      setPending(false)
    }
  }

  async function sendLoginLink() {
    if (pending || loginCooldown > 0) return
    setPending(true)
    setFormError('')
    setLoginNotice('')
    try {
      const { error } = await requireSupabase().auth.signInWithOtp({
        email: ADMIN_EMAIL,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: new URL('./?admin=setup', window.location.href).href,
        },
      })
      if (error) throw error
      setLoginCooldown(60)
      setLoginNotice('Der Anmeldelink ist unterwegs. Öffne nur den neuesten Link in diesem Browser; ältere Links sind ungültig.')
    } catch (reason) {
      const details = typeof reason === 'object' && reason !== null ? reason as { code?: string; status?: number; message?: string } : null
      if (details?.status === 429 || details?.code?.includes('rate_limit')) {
        setLoginCooldown(60)
        setFormError('Das Supabase-E-Mail-Limit ist gerade erreicht. Bitte warte, bevor du erneut anforderst, und verwende den zuletzt erhaltenen Link.')
      } else {
        setFormError(reason instanceof Error ? reason.message : 'Der Anmeldelink konnte nicht gesendet werden.')
      }
    } finally {
      setPending(false)
    }
  }

  async function setAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    if (newPassword.length < 8) {
      setFormError('Dein Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (newPassword !== confirmPassword) {
      setFormError('Die Passwörter stimmen nicht überein.')
      return
    }
    setPending(true)
    try {
      const { error } = await requireSupabase().auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      setConfirmPassword('')
      setPasswordFormOpen(false)
      setMessage('Passwort gespeichert. Ab jetzt meldest du dich nur mit diesem Passwort an.')
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Das Passwort konnte nicht gespeichert werden.')
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    await requireSupabase().auth.signOut()
    setMessage('Du wurdest abgemeldet.')
  }

  async function handleReset(item: AdminWishItem) {
    if (!window.confirm('Reservierung von „' + item.title + '“ wirklich aufheben?')) return
    try {
      const changed = await resetItem(item.id)
      if (!changed) throw new Error('Der Artikel konnte nicht gefunden werden.')
      setMessage('Reservierung aufgehoben.')
      await refresh()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Die Reservierung konnte nicht freigegeben werden.')
    }
  }

  async function handleDelete(item: AdminWishItem) {
    if (!window.confirm('„' + item.title + '“ endgültig aus der Wunschliste löschen?')) return
    try {
      await deleteItem(item.id)
      setMessage('Artikel gelöscht.')
      await refresh()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Der Artikel konnte nicht gelöscht werden.')
    }
  }

  function openEditor(item: AdminWishItem | null) {
    setEditing(item)
    setEditorOpen(true)
  }

  return (
    <main className="site-shell admin-shell">
      <header className="topbar">
        <a className="brand" href={window.location.pathname} aria-label="Zur öffentlichen Wunschliste">
          <span className="brand-mark">J</span><span>JANUS <i>·</i> 26/27</span>
        </a>
        <a className="back-link" href={window.location.pathname}>← Öffentliche Liste</a>
      </header>

      <section className="admin-intro">
        <p className="eyebrow">Privater Bereich</p>
        <h1>Wunschliste <em>verwalten.</em></h1>
        <p>Artikel pflegen, Reservierungen sehen und die Reihenfolge anpassen.</p>
      </section>

      {!isSupabaseConfigured ? (
        <div className="admin-login">
          <p className="eyebrow">Einrichtung erforderlich</p>
          <h2>Supabase verbinden</h2>
          <p>Trage Projekt-URL und Publishable Key in .env.local ein, um das Admin-Dashboard zu verwenden.</p>
        </div>
      ) : !signedInEmail ? (
        <section className="admin-login">
          <p className="eyebrow">Nur für Janus</p>
          <h2>Admin-Anmeldung</h2>
          <form onSubmit={signIn}>
            <label htmlFor="admin-password">Admin-Passwort</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button className="gift-button modal-submit" disabled={pending}>{pending ? 'Meldet an …' : 'Anmelden'} <span aria-hidden="true">↗</span></button>
            <button className="outline-button magic-link-button" type="button" disabled={pending || loginCooldown > 0} onClick={sendLoginLink}>{pending ? 'Wird gesendet …' : loginCooldown > 0 ? `Link erneut senden in ${loginCooldown} s` : 'Einmalig per Link anmelden / Passwort einrichten'}</button>
            {loginNotice && <p className="login-note" role="status">{loginNotice}</p>}
            {formError && <p className="form-message" role="alert">{formError}</p>}
          </form>
        </section>
      ) : (
        <section className="admin-section">
          <div className="admin-toolbar">
            <div><p className="eyebrow">Angemeldet als {signedInEmail}</p><h2>Alle Wünsche <span>{items.length}</span></h2></div>
            <div className="admin-toolbar-actions"><button className="outline-button" onClick={() => openEditor(null)}>+ Artikel hinzufügen</button><button className="quiet-button" onClick={() => { setPasswordFormOpen((open) => !open); setFormError('') }}>Passwort festlegen</button><button className="quiet-button" onClick={signOut}>Abmelden</button></div>
          </div>
          {message && <div className="notice-banner">{message}<button onClick={() => setMessage('')} aria-label="Hinweis schließen">×</button></div>}
          {formError && <div className="error-banner" role="alert">{formError}<button onClick={() => setFormError('')} aria-label="Fehler schließen">×</button></div>}
          {passwordFormOpen && <form className="password-setup" onSubmit={setAccountPassword}>
            <h3>Dein Admin-Passwort</h3>
            <label htmlFor="new-admin-password">Neues Passwort<input id="new-admin-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <label htmlFor="confirm-admin-password">Passwort wiederholen<input id="confirm-admin-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            <div className="password-setup-actions"><button className="outline-button" disabled={pending}>{pending ? 'Speichert …' : 'Passwort speichern'}</button><button className="quiet-button" type="button" onClick={() => setPasswordFormOpen(false)}>Abbrechen</button></div>
          </form>}
          {loading ? <div className="loading-state"><span className="loader" /> Daten werden geladen …</div> : (
            <>
              <p className="drag-hint">Ziehe die Artikel am Griff in deine Wunschreihenfolge. Die Änderung wird direkt gespeichert.</p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th aria-label="Sortierung" /><th>Artikel</th><th>Preis</th><th>Status · Schenker</th><th>Aktionen</th></tr></thead>
                  <DragDropProvider onDragEnd={async (event) => {
                    if (event.canceled || !isSortable(event.operation.source)) return
                    const { initialIndex, index } = event.operation.source
                    if (initialIndex === index) return
                    const next = [...items]
                    const [moved] = next.splice(initialIndex, 1)
                    if (!moved) return
                    next.splice(index, 0, moved)
                    setItems(next)
                    setMessage('Reihenfolge wird gespeichert …')
                    try {
                      await saveOrder(next.map((item) => item.id))
                      setMessage('Neue Reihenfolge gespeichert.')
                    } catch (reason) {
                      const problem = reason instanceof Error ? reason.message : 'Die Reihenfolge konnte nicht gespeichert werden.'
                      try {
                        setItems(await getAdminItems())
                      } catch {
                        // Keep the current list visible if the refresh also fails.
                      }
                      setMessage('')
                      setFormError(problem)
                    }
                  }}>
                    <tbody>
                      {items.map((item, index) => (
                        <SortableRow key={item.id} item={item} index={index} onEdit={openEditor} onReset={handleReset} onDelete={handleDelete} />
                      ))}
                    </tbody>
                  </DragDropProvider>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      <footer className="site-footer"><span>Admin · Wunschliste Janus 26/27</span><span>Reservierungsdaten sind nur für Admins sichtbar.</span></footer>
      {editorOpen && <ItemEditor item={editing} onClose={() => setEditorOpen(false)} onSaved={refresh} />}
    </main>
  )
}

export default AdminDashboard
