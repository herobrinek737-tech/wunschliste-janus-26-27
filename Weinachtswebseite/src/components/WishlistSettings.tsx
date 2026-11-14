import { useState } from 'react'
import { bulkDelete, saveListSettings } from '../lib/api'
import { bulkDeleteReturn, clearBulkDeleteReturn, rememberBulkDelete } from '../lib/bulk-delete-return'
import { errorMessage } from '../lib/input'
import { bulkDeleteEmail, listNames, seasons } from '../lib/seasons'
import type { Season, WishlistSettings as ListSettings } from '../lib/seasons'
import type { WishListSlug } from '../lib/types'
import Modal from './Modal'

export default function WishlistSettings({ list, itemCount, email, settings, settingsLoadError, onSettingsSaved, onDeleted }: {
  list: WishListSlug
  itemCount: number
  email: string
  settings?: ListSettings
  settingsLoadError: boolean
  onSettingsSaved: (settings: ListSettings) => void
  onDeleted: (count: number) => void
}) {
  const [saving, setSaving] = useState(false)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [saveError, setSaveError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(bulkDeleteReturn?.list === list && email.toLowerCase() === bulkDeleteEmail)
  const customTitle = titleDraft ?? settings?.custom_title ?? ''

  async function saveSettings(changes: Partial<ListSettings>, label: string) {
    setSaving(true)
    setFeedback('')
    setSaveError('')
    try {
      const updated = await saveListSettings(list, changes)
      onSettingsSaved(updated)
      if ('custom_title' in changes) setTitleDraft(null)
      setFeedback(`${label} gespeichert.`)
    } catch {
      setSaveError(`${label} konnte nicht gespeichert werden.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wishlist-settings">
      <div>
        <label htmlFor="wishlist-season">Jahreszeit für Seite und PDF</label>
        <select id="wishlist-season" value={settings?.season ?? ''} disabled={!settings || saving}
          onChange={(event) => void saveSettings({ season: event.target.value as Season }, 'Jahreszeit')}>
          <option value="" disabled>Jahreszeit auswählen</option>
          {(Object.keys(seasons) as Season[]).map((key) => <option key={key} value={key}>{seasons[key].label}</option>)}
        </select>
      </div>
      <form className="wishlist-title-form" onSubmit={(event) => {
        event.preventDefault()
        void saveSettings({ custom_title: customTitle.trim() || null }, 'Titel')
      }}>
        <label htmlFor="custom-wishlist-title">Titel der Wunschliste</label>
        <div>
          <input id="custom-wishlist-title" type="text" maxLength={100} value={customTitle}
            disabled={!settings || saving} aria-describedby="custom-wishlist-title-help"
            placeholder="Geburtstagswunschliste" onChange={(event) => setTitleDraft(event.target.value)} />
          <button className="outline-button" disabled={!settings || saving || customTitle.trim() === (settings.custom_title ?? '')}>Titel speichern</button>
        </div>
        <small id="custom-wishlist-title-help">Leer lassen für den Titel der Jahreszeit. „von {listNames[list]}“ wird ergänzt.</small>
      </form>
      {email.toLowerCase() === bulkDeleteEmail && <button className="outline-button bulk-delete-button"
        type="button" disabled={itemCount === 0} onClick={() => setDeleteOpen(true)}>Alle Produkte löschen</button>}
      {feedback && <small className="wishlist-settings-message" role="status">{feedback}</small>}
      {saveError && <small className="wishlist-settings-message" role="alert">{saveError}</small>}
      {settingsLoadError && <small className="wishlist-settings-message" role="alert">Die Einstellungen konnten nicht geladen werden.</small>}
      {deleteOpen && <BulkDeleteDialog list={list} onClose={() => {
        if (bulkDeleteReturn) clearBulkDeleteReturn()
        setDeleteOpen(false)
      }} onDeleted={onDeleted} />}
    </div>
  )
}

function BulkDeleteDialog({ list, onClose, onDeleted }: {
  list: WishListSlug
  onClose: () => void
  onDeleted: (count: number) => void
}) {
  const [sent, setSent] = useState(false)
  const confirmation = bulkDeleteReturn?.list === list ? bulkDeleteReturn : null
  const [proof, setProof] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function sendLink() {
    setPending(true)
    setError('')
    try {
      const result = await bulkDelete(list, { action: 'send-link' })
      if (!result?.state) throw new Error('Die Bestätigung konnte nicht gestartet werden.')
      rememberBulkDelete(list, result.state)
      setSent(true)
    } catch (reason) {
      setError(errorMessage(reason, 'Der Bestätigungslink konnte nicht gesendet werden.'))
    } finally {
      setPending(false)
    }
  }

  async function verifyLink() {
    if (!confirmation) return
    setPending(true)
    setError('')
    try {
      const result = await bulkDelete(list, { action: 'verify-link', state: confirmation.state, code: confirmation.code })
      if (!result?.proof) throw new Error('Die E-Mail konnte nicht bestätigt werden.')
      setProof(result.proof)
    } catch (reason) {
      setError(errorMessage(reason, 'Die E-Mail konnte nicht bestätigt werden.'))
    } finally {
      setPending(false)
    }
  }

  async function confirm() {
    if (!confirmation || !proof) return
    setPending(true)
    setError('')
    try {
      const count = (await bulkDelete(list, { action: 'delete-confirmed', state: confirmation.state, proof }))?.count
      if (count === undefined) throw new Error('Die Löschung konnte nicht bestätigt werden.')
      onClose()
      onDeleted(count)
    } catch (reason) {
      setError(errorMessage(reason, 'Die Produkte konnten nicht gelöscht werden.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal titleId="bulk-delete-title" busy={pending} onClose={onClose}>
      <h2 id="bulk-delete-title">Alle Produkte löschen</h2>
      <p>Damit löschst du alle Produkte und Notizen auf der Wunschliste von {listNames[list]} endgültig.</p>
      {confirmation ? (
        proof ? <>
          <p role="status">E-Mail bestätigt.</p>
          <button className="outline-button bulk-delete-button" type="button" disabled={pending} onClick={confirm}>Endgültig löschen</button>
        </> :
          <button className="outline-button" type="button" disabled={pending} onClick={verifyLink}>E-Mail bestätigen</button>
      ) : sent ? (
        <>
          <p role="status">Der Link wurde an {bulkDeleteEmail} gesendet. Öffne ihn innerhalb von zehn Minuten im selben Browser.</p>
          <button className="quiet-button" type="button" disabled={pending} onClick={sendLink}>Neuen Link senden</button>
        </>
      ) : (
        <>
          <p>Die Löschung erfordert eine Anmeldung mit Admin-Passwort und einen Bestätigungslink per E-Mail an {bulkDeleteEmail}.</p>
          <button className="outline-button" type="button" disabled={pending} onClick={sendLink}>
            {pending ? 'Link wird gesendet …' : 'Link per E-Mail senden'}
          </button>
        </>
      )}
      {error && <p className="form-message" role="alert">{error}</p>}
    </Modal>
  )
}
