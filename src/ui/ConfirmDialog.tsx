import type { ReactNode, Ref } from 'react'
import { trapTabKey } from '../a11y/modalFocus'

interface ConfirmDialogProps {
  /** Ref for the backdrop; the owner keeps it (e.g. a fade-exit ref) so it outlives this dialog. */
  backdropRef?: Ref<HTMLDivElement>
  /** Accessible name of the dialog. */
  label: string
  icon: ReactNode
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  /** Close when the backdrop itself is pressed. */
  dismissOnBackdrop?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Modal alert dialog with Cancel (focused first) and a confirm action. Escape cancels. */
export default function ConfirmDialog({
  backdropRef, label, icon, title, children, confirmLabel, danger = false, dismissOnBackdrop = false, onCancel, onConfirm,
}: ConfirmDialogProps) {
  return (
    <div ref={backdropRef} className="modal-backdrop" onPointerDown={dismissOnBackdrop ? (event) => { if (event.target === event.currentTarget) onCancel() } : undefined}>
      <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-label={label} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); else trapTabKey(event) }}>
        <header className="modal-header"><div>{icon}<strong>{title}</strong></div></header>
        <div className="confirm-body">{children}</div>
        <footer className="modal-footer">
          <span />
          <div className="dialog-buttons">
            <button className="phase-secondary-button" autoFocus onClick={onCancel}>Cancel</button>
            <button className={`phase-primary-button${danger ? ' danger-confirm' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </footer>
      </section>
    </div>
  )
}
