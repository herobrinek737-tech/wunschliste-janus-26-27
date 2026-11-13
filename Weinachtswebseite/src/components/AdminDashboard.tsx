import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import {
  deleteItem,
  getAdminCapabilities,
  getAdminItems,
  getGiftActivity,
  resetItem,
  saveItem,
  saveOrder,
  uploadProductImage,
} from '../lib/api'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { AdminCapabilities, AdminWishItem, GiftActivity, WishListSlug } from '../lib/types'

const ADMIN_EMAIL = 'janus.kleine@cbg-duelmen.de'

function money(cents: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function publicListHref(listSlug: WishListSlug) {
  const url = new URL(window.location.href)
  url.hash = ''
  url.searchParams.delete('admin')
  url.searchParams.delete('code')
  if (listSlug === 'marlene') url.searchParams.set('list', 'marlene')
  else url.searchParams.delete('list')
  return `${url.pathname}${url.search}`
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
        {item.is_reserved ? (
          <span className="status-pill status-taken">Verschenkt</span>
        ) : item.contributed_cents > 0 ? (
          <div><span className="status-pill status-taken">Teilbeträge</span><small className="admin-contribution-total">{money(item.contributed_cents)} gesamt</small></div>
        ) : <span className="status-pill status-free">Verfügbar</span>}
      </td>
      <td className="actions-cell">
        <button className="text-action" onClick={() => onEdit(item)}>Bearbeiten</button>
        {item.is_reserved && <button className="text-action" onClick={() => onReset(item)}>Freigeben</button>}
        <button className="text-action text-danger" onClick={() => onDelete(item)}>Löschen</button>
      </td>
    </tr>
  )
}

function ItemEditor({
  item,
  listSlug,
  onClose,
  onSaved,
}: {
  item: AdminWishItem | null
  listSlug: WishListSlug
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [url, setUrl] = useState(item?.url ?? 'https://')
  const [priceInput, setPriceInput] = useState(item ? (item.price_cents / 100).toFixed(2) : '')
  const [isFeatured, setIsFeatured] = useState(item?.is_featured ?? false)
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (filePreview) URL.revokeObjectURL(filePreview)
  }, [filePreview])

  function chooseImage(file: File | undefined) {
    setError('')
    if (filePreview) URL.revokeObjectURL(filePreview)
    setFilePreview('')
    setImageFile(null)
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Bitte wähle ein JPG-, PNG-, WebP- oder GIF-Bild aus.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Das Bild darf höchstens 5 MB groß sein.')
      return
    }
    setImageFile(file)
    setFilePreview(URL.createObjectURL(file))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const numericPrice = Number(priceInput.replace(',', '.'))
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        throw new Error('Bitte einen gültigen Preis eingeben.')
      }
      const savedImageUrl = imageFile ? await uploadProductImage(imageFile, listSlug) : imageUrl
      await saveItem({
        id: item?.id ?? null,
        list_slug: listSlug,
        title: title.trim(),
        url: url.trim(),
        price_cents: Math.round(numericPrice * 100),
        is_featured: isFeatured,
        image_url: savedImageUrl,
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
        <p className="eyebrow">Wunschliste {listSlug === 'marlene' ? 'Marlene' : 'Janus'} bearbeiten</p>
        <h2 id="editor-title">{item ? 'Artikel ändern' : 'Wunsch hinzufügen'}</h2>
        <form onSubmit={submit}>
          <label htmlFor="item-title">Produkttitel</label>
          <input id="item-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required />
          <label htmlFor="item-url">Shop-Link</label>
          <input id="item-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required />
          <label htmlFor="item-price">Preis in Euro</label>
          <input id="item-price" inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} required placeholder="0,00" />
          <label className="product-upload" htmlFor="item-image">Produktbild hochladen <span>(JPG, PNG, WebP oder GIF · bis 5 MB)</span>
            <input id="item-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseImage(event.target.files?.[0])} />
          </label>
          {(filePreview || imageUrl) && <img className="upload-preview" src={filePreview || imageUrl || ''} alt="Vorschau des Produktbilds" />}
          {imageUrl && !filePreview && <button className="quiet-button" type="button" onClick={() => setImageUrl(null)}>Bild entfernen</button>}
          <label className="featured-option"><input type="checkbox" checked={isFeatured} onChange={(event) => setIsFeatured(event.target.checked)} /> Als Hauptwunsch hervorheben</label>
          <button className="gift-button modal-submit" disabled={pending}>{pending ? 'Speichert …' : 'Speichern'} <span aria-hidden="true">↗</span></button>
          {error && <p className="form-message" role="alert">{error}</p>}
        </form>
      </section>
    </div>
  )
}

function GiftActivityList({ activity }: { activity: GiftActivity[] }) {
  return (
    <section className="gift-activity" aria-labelledby="gift-activity-title">
      <h3 id="gift-activity-title">Schenkungen und Beteiligungen</h3>
      <p className="admin-status-note">Diese Übersicht ist nur für Papas freigeschaltetes Konto sichtbar. Janus sieht im Admin-Bereich ausschließlich den Reservierungsstatus.</p>
      {activity.length === 0 ? <div className="empty-state">Bisher wurden noch keine Geschenke reserviert oder Teilbeträge eingetragen.</div> : activity.map((entry) => (
        <article className="gift-activity-row" key={`${entry.activity_kind}-${entry.activity_id}`}>
          <div><strong>{entry.item_title}</strong><small>{entry.list_slug === 'marlene' ? 'Wunschliste Marlene' : 'Wunschliste Janus'} · {entry.activity_kind}</small></div>
          <div><strong>{entry.giver_name}</strong>{entry.giver_email && <small>{entry.giver_email}</small>}</div>
          <div className="gift-activity-amount">{money(entry.amount_cents)}</div>
        </article>
      ))}
    </section>
  )
}

function AdminDashboard() {
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loginEmail, setLoginEmail] = useState(ADMIN_EMAIL)
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<AdminCapabilities | null>(null)
  const [listSlug, setListSlug] = useState<WishListSlug>('janus')
  const [items, setItems] = useState<AdminWishItem[]>([])
  const [activity, setActivity] = useState<GiftActivity[]>([])
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
      const roles = await getAdminCapabilities()
      setCapabilities(roles)
      if (!roles.can_edit && !roles.can_view_givers) {
        setItems([])
        setActivity([])
        setFormError('Dieses Konto hat keine Berechtigung für den Wunschlisten-Admin.')
        await requireSupabase().auth.signOut()
        return
      }
      if (roles.can_edit) setItems(await getAdminItems(listSlug))
      else setItems([])
      if (roles.can_view_givers) setActivity(await getGiftActivity())
      else setActivity([])
      setFormError('')
    } catch (reason) {
      const problem = reason instanceof Error ? reason.message : 'Admin-Daten konnten nicht geladen werden.'
      setFormError(problem)
      setItems([])
      setActivity([])
      if (/autorisiert/i.test(problem)) await requireSupabase().auth.signOut()
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
    else {
      setItems([])
      setActivity([])
      setCapabilities(null)
      setLoading(false)
    }
  }, [signedInEmail, listSlug])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFormError('')
    setLoginNotice('')
    try {
      const { error } = await requireSupabase().auth.signInWithPassword({ email: loginEmail.trim(), password })
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
        email: loginEmail.trim(),
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
    setItems([])
    setActivity([])
    setCapabilities(null)
    setMessage('Du wurdest abgemeldet.')
  }

  async function handleReset(item: AdminWishItem) {
    if (!window.confirm('Reservierung von „' + item.title + '“ wirklich aufheben?')) return
    try {
      const changed = await resetItem(item.id, listSlug)
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
      await deleteItem(item.id, listSlug)
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

  const canEdit = capabilities?.can_edit ?? false
  const canViewGivers = capabilities?.can_view_givers ?? false

  return (
    <main className="site-shell admin-shell">
      <header className="topbar">
        <a className="brand" href={publicListHref(listSlug)} aria-label="Zur öffentlichen Wunschliste">
          <span className="brand-mark">{listSlug === 'marlene' ? 'M' : 'J'}</span><span>{listSlug === 'marlene' ? 'MARLENE' : 'JANUS'} <i>·</i> 26/27</span>
        </a>
        <a className="back-link" href={publicListHref(listSlug)}>← Öffentliche Liste</a>
      </header>

      <section className="admin-intro">
        <p className="eyebrow">Privater Bereich</p>
        <h1>Wunschliste <em>verwalten.</em></h1>
        <p>Artikel pflegen und Reservierungen schützen die Überraschung.</p>
      </section>

      {!isSupabaseConfigured ? (
        <div className="admin-login">
          <p className="eyebrow">Einrichtung erforderlich</p>
          <h2>Supabase verbinden</h2>
          <p>Trage Projekt-URL und Publishable Key in .env.local ein, um das Admin-Dashboard zu verwenden.</p>
        </div>
      ) : !signedInEmail ? (
        <section className="admin-login">
          <p className="eyebrow">Nur freigeschaltete Konten</p>
          <h2>Admin-Anmeldung</h2>
          <form onSubmit={signIn}>
            <label htmlFor="admin-email">E-Mail-Adresse</label>
            <input id="admin-email" type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
            <label htmlFor="admin-password">Admin-Passwort</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button className="gift-button modal-submit" disabled={pending}>{pending ? 'Meldet an …' : 'Anmelden'} <span aria-hidden="true">↗</span></button>
            <button className="outline-button magic-link-button" type="button" disabled={pending || loginCooldown > 0} onClick={sendLoginLink}>{pending ? 'Wird gesendet …' : loginCooldown > 0 ? `Link erneut senden in ${loginCooldown} s` : 'Einmalig per Link anmelden / Passwort einrichten'}</button>
            {loginNotice && <p className="login-note" role="status">{loginNotice}</p>}
            {formError && <p className="form-message" role="alert">{formError}</p>}
          </form>
          <p className="login-note">Die Datenbank schaltet Listenbearbeitung und Einsicht in Schenkerdaten getrennt frei.</p>
        </section>
      ) : (
        <section className="admin-section">
          <div className="admin-toolbar">
            <div><p className="eyebrow">Angemeldet als {signedInEmail}</p><h2>{canEdit ? 'Wunschlisten' : 'Geschenke'} <span>{canEdit ? items.length : activity.length}</span></h2></div>
            <div className="admin-toolbar-actions">
              {canEdit && <button className="outline-button" onClick={() => openEditor(null)}>+ Artikel hinzufügen</button>}
              <button className="quiet-button" onClick={() => { setPasswordFormOpen((open) => !open); setFormError('') }}>Passwort festlegen</button>
              <button className="quiet-button" onClick={signOut}>Abmelden</button>
            </div>
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
              {canEdit && <>
                <div className="admin-list-tabs" role="group" aria-label="Wunschliste wählen">
                  <button className="outline-button" aria-pressed={listSlug === 'janus'} onClick={() => { setListSlug('janus'); setEditorOpen(false) }}>Janus</button>
                  <button className="outline-button" aria-pressed={listSlug === 'marlene'} onClick={() => { setListSlug('marlene'); setEditorOpen(false) }}>Marlene</button>
                </div>
                <p className="drag-hint">Ziehe die Artikel am Griff in deine Wunschreihenfolge. Nur der Reservierungsstatus erscheint in dieser Liste.</p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th aria-label="Sortierung" /><th>Artikel</th><th>Preis</th><th>Status</th><th>Aktionen</th></tr></thead>
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
                        await saveOrder(next.map((wish) => wish.id), listSlug)
                        setMessage('Neue Reihenfolge gespeichert.')
                      } catch (reason) {
                        const problem = reason instanceof Error ? reason.message : 'Die Reihenfolge konnte nicht gespeichert werden.'
                        try { setItems(await getAdminItems(listSlug)) } catch { /* keep the current view visible */ }
                        setMessage('')
                        setFormError(problem)
                      }
                    }}>
                      <tbody>
                        {items.map((item, index) => <SortableRow key={item.id} item={item} index={index} onEdit={openEditor} onReset={handleReset} onDelete={handleDelete} />)}
                      </tbody>
                    </DragDropProvider>
                  </table>
                  {items.length === 0 && <div className="empty-state">Auf dieser Wunschliste stehen noch keine Artikel.</div>}
                </div>
              </>}
              {canViewGivers && <GiftActivityList activity={activity} />}
              {canEdit && !canViewGivers && <p className="admin-status-note">Schenker-Namen, E-Mail-Adressen und einzelne Teilbeträge sind für dieses Konto gesperrt und nur für Papas freigeschaltetes Konto sichtbar.</p>}
              {!canEdit && !canViewGivers && <div className="empty-state">Dieses Konto ist nicht für den Admin-Bereich freigeschaltet.</div>}
            </>
          )}
        </section>
      )}

      <footer className="site-footer"><span>Admin · Wunschlisten Janus und Marlene</span><span>Reservierungsdetails sind nur für Papas freigeschaltetes Konto sichtbar.</span></footer>
      {editorOpen && canEdit && <ItemEditor key={`${listSlug}-${editing?.id ?? 'new'}`} item={editing} listSlug={listSlug} onClose={() => setEditorOpen(false)} onSaved={refresh} />}
    </main>
  )
}

export default AdminDashboard
