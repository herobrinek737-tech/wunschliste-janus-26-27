import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export default function Modal({ className = '', titleId, closeLabel = 'Schließen', busy = false, onClose, children }: {
  className?: string
  titleId: string
  closeLabel?: string
  busy?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const trigger = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
      if (document.activeElement === document.body) document.querySelector<HTMLElement>('.cart-toggle')?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={`reserve-modal ${className}`}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <button className="modal-close" type="button" onClick={onClose} disabled={busy} aria-label={closeLabel}>×</button>
      {children}
    </dialog>
  )
}
