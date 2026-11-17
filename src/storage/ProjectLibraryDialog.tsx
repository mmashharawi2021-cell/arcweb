import { useEffect, useState } from 'react'
import { X, Database } from 'lucide-react'
import { trapTabKey, useRestoreFocus } from '../a11y/modalFocus'
import { useFadeExit } from '../ui/useFadeExit'
import ProjectLibraryContent, { type ProjectLibraryContentProps } from './ProjectLibraryContent'

export interface ProjectLibraryDialogProps extends Omit<ProjectLibraryContentProps, 'onDone' | 'onBusyChange' | 'autoFocusFirst'> {
  onClose: () => void
}

/** The project library as a modal dialog. The Project backstage shows the same content inline. */
export default function ProjectLibraryDialog({ onClose, ...library }: ProjectLibraryDialogProps) {
  useRestoreFocus()
  const fadeRef = useFadeExit<HTMLDivElement>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose])
  return <div ref={fadeRef} className="modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="modal project-library" role="dialog" aria-modal="true" aria-label="Project library" onKeyDown={trapTabKey} aria-busy={busy}>
      <header className="modal-header"><div><Database size={16} /><strong>Projects on this device</strong></div><button className="subtle-icon" title="Close project library" disabled={busy} onClick={onClose}><X size={15} /></button></header>
      <div className="modal-body">
        <ProjectLibraryContent {...library} onDone={onClose} onBusyChange={setBusy} autoFocusFirst />
      </div>
    </section>
  </div>
}
