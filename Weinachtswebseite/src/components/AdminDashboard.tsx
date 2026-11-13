import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import {
  deleteContribution,
  deleteItem,
  getAdminCapabilities,
  getAdminContributions,
  getAdminItems,
  getGiftActivity,
  resetItem,
  removeUnlinkedProductImage,
  saveItem,
  saveOrder,
  uploadProductImage,
} from '../lib/api'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { errorMessage, euroToCents, isPublicShopUrl } from '../lib/input'
import type { AdminCapabilities, AdminContribution, AdminWishItem, GiftActivity, WishListSlug } from '../lib/types'
import Modal from './Modal'

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
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  item: AdminWishItem
  index: number
  onEdit: (item: AdminWishItem) => void
  onReset: (item: AdminWishItem) => void
  onDelete: (item: AdminWishItem) => void
  onMove: (from: number, to: number) => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const sortable = useSortable({ id: item.id, index })
  return (
    <tr ref={sortable.ref} className={sortable.isDragging ? 'admin-row dragging' : 'admin-row'}>
      <td className="drag-cell">
        <button ref={sortable.handleRef} className="drag-handle" aria-label={'Sortiere ' + item.title} title="Ziehen zum Sortieren">⠿</button>
        <div className="sort-controls">
          <button className="quiet-button" disabled={!canMoveUp} onClick={() => onMove(index, index - 1)} aria-label={`${item.title} nach oben verschieben`}>↑</button>
          <button className="quiet-button" disabled={!canMoveDown} onClick={() => onMove(index, index + 1)} aria-label={`${item.title} nach unten verschieben`}>↓</button>
        </div>
      </td>
      <td className="admin-item-title"><span className="mobile-row-label">Artikel</span><strong>{item.title}</strong>{isPublicShopUrl(item.url) ? <a href={item.url} target="_blank" rel="noreferrer">Shop öffnen ↗</a> : <small>Shop-Link prüfen</small>}</td>
      <td>{item.price_cents > 0 ? money(item.price_cents) : 'Preis offen'}</td>
      <td>
        {item.is_reserved ? (
          <span className="status-pill status-taken">Reserviert</span>
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
  onNotice,
}: {
  item: AdminWishItem | null
  listSlug: WishListSlug
  onClose: () => void
  onSaved: () => Promise<void>
  onNotice: (notice: string) => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [priceInput, setPriceInput] = useState(item?.price_cents ? (item.price_cents / 100).toFixed(2).replace('.', ',') : '')
  const [isFeatured, setIsFeatured] = useState(item?.is_featured ?? false)
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (filePreview) URL.revokeObjectURL(filePreview)
  }, [filePreview])

  function chooseImage(file: File | undefined) {
    setError('')
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
    if (pending) return
    setError('')
    const priceCents = priceInput.trim() ? euroToCents(priceInput) : 0
    if (priceCents === null || !title.trim() || !isPublicShopUrl(url.trim())) {
      setError(priceCents === null ? 'Bitte gib einen Preis mit höchstens zwei Nachkommastellen ein.' : !title.trim() ? 'Bitte gib einen Produkttitel ein.' : 'Bitte gib einen vollständigen HTTPS-Link zu einem öffentlichen Shop ein.')
      return
    }
    setPending(true)
    let uploadedImage: string | null = null
    let saved = false
    try {
      if (imageFile) uploadedImage = await uploadProductImage(imageFile, listSlug)
      await saveItem({
        id: item?.id ?? null,
        list_slug: listSlug,
        title: title.trim(),
        url: url.trim(),
        price_cents: priceCents,
        is_featured: isFeatured,
        image_url: uploadedImage ?? imageUrl,
      })
      saved = true
      await removeUnlinkedProductImage(item?.image_url, uploadedImage ?? imageUrl)
      await onSaved()
      onNotice('Wunsch gespeichert.')
      onClose()
    } catch (reason) {
      if (!saved) await removeUnlinkedProductImage(uploadedImage)
      setError(errorMessage(reason, 'Der Artikel konnte nicht gespeichert werden.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal className="editor-modal" titleId="editor-title" busy={pending} onClose={onClose}>
      <p className="eyebrow">Wunschliste {listSlug === 'marlene' ? 'Marlene' : 'Janus'} bearbeiten</p>
      <h2 id="editor-title">{item ? 'Artikel ändern' : 'Wunsch hinzufügen'}</h2>
      <form onSubmit={submit}>
        <label htmlFor="item-title">Produkttitel</label>
        <input id="item-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required />
        <label htmlFor="item-url">Shop-Link</label>
        <input id="item-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} required />
        <label htmlFor="item-price">Geschätzter Preis in Euro <span>(optional)</span></label>
        <input id="item-price" inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} placeholder="Preis offen" />
        <label className="product-upload" htmlFor="item-image">Produktbild hochladen <span>(JPG, PNG, WebP oder GIF · bis 5 MB)</span>
          <input ref={fileInput} id="item-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseImage(event.target.files?.[0])} />
        </label>
        {(filePreview || imageUrl) && <img className="upload-preview" src={filePreview || imageUrl || ''} alt="Vorschau des Produktbilds" />}
        {imageUrl && !filePreview && <button className="quiet-button" type="button" onClick={() => setImageUrl(null)}>Bild entfernen</button>}
        {filePreview && <button className="quiet-button" type="button" onClick={() => {
          chooseImage(undefined)
          if (fileInput.current) fileInput.current.value = ''
        }}>Neue Bildauswahl entfernen</button>}
        <label className="featured-option"><input type="checkbox" checked={isFeatured} onChange={(event) => setIsFeatured(event.target.checked)} /> Als Hauptwunsch hervorheben</label>
        <button className="gift-button modal-submit" disabled={pending}>{pending ? 'Speichert …' : 'Speichern'} <span aria-hidden="true">↗</span></button>
        {error && <p className="form-message" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

function GiftActivityList({ activity, canDeleteContributions, onDeleteContribution }: {
  activity: GiftActivity[]
  canDeleteContributions: boolean
  onDeleteContribution: (entry: { activity_id: string; item_title: string; amount_cents: number }) => void
}) {
  return (
    <section className="gift-activity" aria-labelledby="gift-activity-title">
      <h3 id="gift-activity-title">Schenkungen und Beteiligungen</h3>
      <p className="admin-status-note">Namen und E-Mail-Adressen dieser Übersicht sind nur für Papas freigeschaltetes Konto sichtbar.</p>
      {activity.length === 0 ? <div className="empty-state">Bisher wurden noch keine Geschenke reserviert oder Teilbeträge eingetragen.</div> : activity.map((entry) => (
        <article className="gift-activity-row" key={`${entry.activity_kind}-${entry.activity_id}`}>
          <div><strong>{entry.item_title}</strong><small>{entry.list_slug === 'marlene' ? 'Wunschliste Marlene' : 'Wunschliste Janus'} · {entry.activity_kind}</small></div>
          <div><strong>{entry.giver_name}</strong>{entry.giver_email && <small>{entry.giver_email}</small>}</div>
          <div className="gift-activity-controls">
            <div className="gift-activity-amount">{money(entry.amount_cents)}</div>
            {canDeleteContributions && entry.activity_kind === 'Beteiligung' && <button className="text-action text-danger" onClick={() => onDeleteContribution(entry)}>Betrag löschen</button>}
          </div>
        </article>
      ))}
    </section>
  )
}

function AdminContributionList({ contributions, onDelete }: {
  contributions: AdminContribution[]
  onDelete: (entry: AdminContribution) => void
}) {
  return (
    <section className="gift-activity" aria-labelledby="admin-contributions-title">
      <h3 id="admin-contributions-title">Teilbeträge verwalten</h3>
      <p className="admin-status-note">Hier siehst du nur Wunsch und Betrag. Namen und E-Mail-Adressen bleiben verborgen. Löschen aktualisiert den offenen Restbetrag.</p>
      {contributions.length === 0 ? <div className="empty-state">Für diese Wunschliste gibt es noch keine Teilbeträge.</div> : contributions.map((entry) => (
        <article className="gift-activity-row admin-contribution-row" key={entry.activity_id}>
          <div><strong>{entry.item_title}</strong><small>{entry.list_slug === 'marlene' ? 'Wunschliste Marlene' : 'Wunschliste Janus'} · Beteiligung</small></div>
          <div className="gift-activity-amount">{money(entry.amount_cents)}</div>
          <button className="text-action text-danger" onClick={() => onDelete(entry)}>Betrag löschen</button>
        </article>
      ))}
    </section>
  )
}

function AdminDashboard() {
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const loginEmailInput = useRef<HTMLInputElement>(null)
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<AdminCapabilities | null>(null)
  const [listSlug, setListSlug] = useState<WishListSlug>(() => new URLSearchParams(window.location.search).get('list') === 'marlene' ? 'marlene' : 'janus')
  const [items, setItems] = useState<AdminWishItem[]>([])
  const [activity, setActivity] = useState<GiftActivity[]>([])
  const [contributions, setContributions] = useState<AdminContribution[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingSession, setCheckingSession] = useState(isSupabaseConfigured)
  const [savingOrder, setSavingOrder] = useState(false)
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
        setContributions([])
        setFormError('Dieses Konto hat keine Berechtigung für den Wunschlisten-Admin.')
        await requireSupabase().auth.signOut()
        return
      }
      if (roles.can_edit) setItems(await getAdminItems(listSlug))
      else setItems([])
      if (roles.can_view_givers) {
        setActivity(await getGiftActivity())
        setContributions([])
      } else {
        setActivity([])
        if (roles.can_edit) setContributions(await getAdminContributions(listSlug))
        else setContributions([])
      }
      setFormError('')
    } catch (reason) {
      const problem = errorMessage(reason, 'Admin-Daten konnten nicht geladen werden.')
      setFormError(problem)
      setItems([])
      setActivity([])
      setContributions([])
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
    let active = true
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setFormError('Die Anmeldung konnte nicht geprüft werden.')
      setSignedInEmail(data.session?.user.email ?? null)
      setCheckingSession(false)
    })
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (signedInEmail) void refresh()
    else {
      setItems([])
      setActivity([])
      setContributions([])
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
    if (pending || loginCooldown > 0 || !loginEmailInput.current?.reportValidity()) return
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
      setMessage('Passwort gespeichert. Du kannst dich jetzt auch mit deinem Passwort anmelden.')
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Das Passwort konnte nicht gespeichert werden.')
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    if (pending) return
    setPending(true)
    setFormError('')
    setMessage('')
    try {
      const { error } = await requireSupabase().auth.signOut()
      if (error) throw error
      setSignedInEmail(null)
      setEditorOpen(false)
      setPasswordFormOpen(false)
      setNewPassword('')
      setConfirmPassword('')
      setLoginNotice('Du wurdest abgemeldet.')
    } catch {
      setFormError('Abmelden fehlgeschlagen. Du bist noch angemeldet. Bitte versuche es erneut.')
    } finally {
      setPending(false)
    }
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
    if (item.is_reserved || item.contributed_cents > 0) {
      setFormError('Dieser Wunsch hat eine Reservierung oder Teilbeträge. Kläre die offenen Zusagen, bevor du ihn löschst.')
      return
    }
    if (!window.confirm('„' + item.title + '“ endgültig aus der Wunschliste löschen?')) return
    try {
      await deleteItem(item.id, listSlug)
      await removeUnlinkedProductImage(item.image_url)
      setMessage('Artikel gelöscht.')
      await refresh()
    } catch (reason) {
      setFormError(errorMessage(reason, 'Der Artikel konnte nicht gelöscht werden.'))
    }
  }

  async function handleDeleteContribution(entry: { activity_id: string; item_title: string; amount_cents: number }) {
    if (!window.confirm(`Teilbetrag von ${money(entry.amount_cents)} für „${entry.item_title}“ wirklich löschen?`)) return
    try {
      const deleted = await deleteContribution(entry.activity_id)
      if (!deleted) {
        setMessage('Dieser Teilbetrag war nicht mehr vorhanden.')
        await refresh()
        return
      }
      setMessage('Teilbetrag gelöscht. Der offene Restbetrag wurde aktualisiert.')
      await refresh()
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Der Teilbetrag konnte nicht gelöscht werden.')
    }
  }

  function openEditor(item: AdminWishItem | null) {
    setEditing(item)
    setEditorOpen(true)
  }

  function selectList(slug: WishListSlug) {
    if (slug === listSlug || savingOrder) return
    setLoading(true)
    setListSlug(slug)
    setEditorOpen(false)
    setMessage('')
    const url = new URL(window.location.href)
    if (slug === 'marlene') url.searchParams.set('list', 'marlene')
    else url.searchParams.delete('list')
    window.history.replaceState(window.history.state, '', url)
  }

  async function moveItem(from: number, to: number) {
    if (savingOrder || from === to || !items[from] || !items[to]) return
    const previous = items
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setItems(next)
    setSavingOrder(true)
    setFormError('')
    setMessage('Reihenfolge wird gespeichert …')
    try {
      await saveOrder(next.map((wish) => wish.id), listSlug)
      setMessage('Neue Reihenfolge gespeichert.')
    } catch (reason) {
      setItems(previous)
      setMessage('')
      setFormError(errorMessage(reason, 'Die Reihenfolge konnte nicht gespeichert werden.'))
    } finally {
      setSavingOrder(false)
    }
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
      ) : checkingSession ? (
        <div className="loading-state" role="status">Anmeldung wird geprüft …</div>
      ) : !signedInEmail ? (
        <section className="admin-login">
          <p className="eyebrow">Nur freigeschaltete Konten</p>
          <h2>Admin-Anmeldung</h2>
          <form onSubmit={signIn}>
            <label htmlFor="admin-email">E-Mail-Adresse</label>
            <input ref={loginEmailInput} id="admin-email" type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
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
              <button className="quiet-button" onClick={signOut} disabled={pending || savingOrder}>Abmelden</button>
            </div>
          </div>
          {message && <div className="notice-banner"><span role="status">{message}</span><button onClick={() => setMessage('')} aria-label="Hinweis schließen">×</button></div>}
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
                  <button className="outline-button" disabled={savingOrder} aria-pressed={listSlug === 'janus'} onClick={() => selectList('janus')}>Janus</button>
                  <button className="outline-button" disabled={savingOrder} aria-pressed={listSlug === 'marlene'} onClick={() => selectList('marlene')}>Marlene</button>
                </div>
                <p className="drag-hint">Ziehe die Artikel am Griff oder nutze die Pfeile, um die Reihenfolge zu ändern.</p>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead><tr><th aria-label="Sortierung" /><th>Artikel</th><th>Preis</th><th>Status</th><th>Aktionen</th></tr></thead>
                    <DragDropProvider onDragEnd={(event) => {
                      if (event.canceled || !isSortable(event.operation.source)) return
                      const { initialIndex, index } = event.operation.source
                      void moveItem(initialIndex, index)
                    }}>
                      <tbody>
                        {items.map((item, index) => <SortableRow key={item.id} item={item} index={index} onEdit={openEditor} onReset={handleReset} onDelete={handleDelete} onMove={moveItem} canMoveUp={!savingOrder && index > 0} canMoveDown={!savingOrder && index < items.length - 1} />)}
                      </tbody>
                    </DragDropProvider>
                  </table>
                  {items.length === 0 && <div className="empty-state">Auf dieser Wunschliste stehen noch keine Artikel.</div>}
                </div>
              </>}
              {canViewGivers && <GiftActivityList activity={activity} canDeleteContributions={canEdit} onDeleteContribution={handleDeleteContribution} />}
              {canEdit && !canViewGivers && <AdminContributionList contributions={contributions} onDelete={handleDeleteContribution} />}
              {!canEdit && !canViewGivers && <div className="empty-state">Dieses Konto ist nicht für den Admin-Bereich freigeschaltet.</div>}
            </>
          )}
        </section>
      )}

      <footer className="site-footer"><span>Admin · Wunschlisten Janus und Marlene</span><span>Reservierungsdetails sind nur für Papas freigeschaltetes Konto sichtbar.</span></footer>
      {editorOpen && canEdit && <ItemEditor key={`${listSlug}-${editing?.id ?? 'new'}`} item={editing} listSlug={listSlug} onClose={() => setEditorOpen(false)} onSaved={refresh} onNotice={setMessage} />}
    </main>
  )
}

export default AdminDashboard
