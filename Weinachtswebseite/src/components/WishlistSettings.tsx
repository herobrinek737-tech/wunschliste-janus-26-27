import { useEffect, useState } from 'react'
import { bulkDelete, getListSeason, saveListSeason } from '../lib/api'
import { bulkDeleteReturn, clearBulkDeleteReturn, rememberBulkDelete } from '../lib/bulk-delete-return'
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
  const [deleteOpen, setDeleteOpen] = useState(bulkDeleteReturn?.list === list && email.toLowerCase() === bulkDeleteEmail)

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
