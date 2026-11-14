import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { bulkDelete, getListSeason, saveListSeason } from '../lib/api'
import { errorMessage } from '../lib/input'
import { bulkDeleteEmail, listNames, seasons } from '../lib/seasons'
import type { Season } from '../lib/seasons'
import type { WishListSlug } from '../lib/types'
import Modal from './Modal'

export default function WishlistSettings({ list, itemCount, email, onDeleted }: {
  list: WishListSlug
  itemCount: number
  email: string
  onDeleted: (count: number) => void
}) {
  const [season, setSeason] = useState<Season | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [seasonError, setSeasonError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    let active = true
    getListSeason(list).then((value) => {
      if (active) setSeason(value)
    }).catch(() => {
      if (active) setSeasonError('Die Jahreszeit konnte nicht geladen werden.')
    })
    return () => { active = false }
  }, [list])

  async function changeSeason(value: Season) {
    setSaving(true)
    setFeedback('')
    setSeasonError('')
    try {
      await saveListSeason(list, value)
      setSeason(value)
      setFeedback('Jahreszeit gespeichert.')
    } catch {
      setSeasonError('Die Jahreszeit konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wishlist-settings">
      <div>
        <label htmlFor="wishlist-season">Jahreszeit für Seite und PDF</label>
        <select id="wishlist-season" value={season ?? ''} disabled={!season || saving}
          onChange={(event) => void changeSeason(event.target.value as Season)}>
          <option value="" disabled>Jahreszeit auswählen</option>
          {(Object.keys(seasons) as Season[]).map((key) => <option key={key} value={key}>{seasons[key].label}</option>)}
        </select>
        {feedback && <small role="status">{feedback}</small>}
        {seasonError && <small role="alert">{seasonError}</small>}
      </div>
      {email.toLowerCase() === bulkDeleteEmail && <button className="outline-button bulk-delete-button"
        type="button" disabled={itemCount === 0} onClick={() => setDeleteOpen(true)}>Alle Produkte löschen</button>}
      {deleteOpen && <BulkDeleteDialog list={list} onClose={() => setDeleteOpen(false)} onDeleted={onDeleted} />}
    </div>
  )
}

function BulkDeleteDialog({ list, onClose, onDeleted }: {
  list: WishListSlug
  onClose: () => void
  onDeleted: (count: number) => void
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function sendCode() {
    setPending(true)
    setError('')
    try {
      await bulkDelete(list)
      setSent(true)
      setCode('')
    } catch (reason) {
      setError(errorMessage(reason, 'Der Löschcode konnte nicht gesendet werden.'))
    } finally {
      setPending(false)
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const count = await bulkDelete(list, code.trim())
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
      {sent ? (
        <form onSubmit={confirm}>
          <p>Der Code wurde an {bulkDeleteEmail} gesendet und gilt zehn Minuten.</p>
          <label htmlFor="bulk-delete-code">Sechsstelliger E-Mail-Code</label>
          <input id="bulk-delete-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}"
            value={code} onChange={(event) => setCode(event.target.value)} maxLength={6} required />
          <button className="outline-button bulk-delete-button" disabled={pending}>Endgültig löschen</button>
          <button className="quiet-button" type="button" disabled={pending} onClick={sendCode}>Neuen Code senden</button>
        </form>
      ) : (
        <>
          <p>Die Löschung erfordert eine Anmeldung mit Admin-Passwort und einen Code per E-Mail an {bulkDeleteEmail}.</p>
          <button className="outline-button" type="button" disabled={pending} onClick={sendCode}>
            {pending ? 'Code wird gesendet …' : 'Code per E-Mail senden'}
          </button>
        </>
      )}
      {error && <p className="form-message" role="alert">{error}</p>}
    </Modal>
  )
}
