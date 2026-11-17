import type { ReactNode } from 'react'
import { FolderOpen, Map as MapIcon, Redo2, Save, Undo2 } from 'lucide-react'
import type { SaveState } from '../storage/projectSession'

interface QuickAccess {
  onSave: () => void
  onUndo: () => void
  onRedo: () => void
  onOpen: () => void
  canUndo: boolean
  canRedo: boolean
}

interface TitleBarProps {
  projectName: string
  onRename: (name: string) => void
  saveState: SaveState
  saveError: string
  quickAccess: QuickAccess
  /** Right-hand slot (command search, notifications). */
  children?: ReactNode
}

const SAVE_LABELS: Record<SaveState, string> = { saved: 'Saved locally', saving: 'Saving…', loading: 'Loading…', error: 'Save failed' }

/** ArcGIS Pro–style title bar: app glyph, Quick Access Toolbar, centred project name, save state. */
export default function TitleBar({ projectName, onRename, saveState, saveError, quickAccess, children }: TitleBarProps) {
  const commands = [
    { label: 'Save', shortcut: 'Ctrl+S', icon: Save, onClick: quickAccess.onSave, disabled: false },
    { label: 'Undo', shortcut: 'Ctrl+Z', icon: Undo2, onClick: quickAccess.onUndo, disabled: !quickAccess.canUndo },
    { label: 'Redo', shortcut: 'Ctrl+Y', icon: Redo2, onClick: quickAccess.onRedo, disabled: !quickAccess.canRedo },
    { label: 'Open', shortcut: 'Ctrl+O', icon: FolderOpen, onClick: quickAccess.onOpen, disabled: false },
  ]
  return (
    <header className="title-bar">
      <div className="title-bar-start">
        <div className="brand-mark" aria-hidden="true"><MapIcon size={15} strokeWidth={2.3} /></div>
        <div className="quick-access" role="toolbar" aria-label="Quick Access Toolbar">
          {commands.map(({ label, shortcut, icon: Icon, onClick, disabled }) => (
            <button key={label} type="button" className="quick-access-button" aria-label={label} title={`${label} (${shortcut})`} disabled={disabled} onClick={onClick}>
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="title-bar-title">
        <input className="project-name" aria-label="Project name" title="Project name — used for the saved file name" dir="auto"
          value={projectName} spellCheck={false} maxLength={80}
          onChange={(event) => onRename(event.target.value)}
          onBlur={(event) => { if (!event.target.value.trim()) onRename('Untitled map') }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
        <span className="title-bar-app">— ArcWeb</span>
      </div>
      <div className="title-bar-end">
        {children}
        <div className="save-state" data-save-state={saveState} role="status" title={saveError || 'Project library on this device'}>
          <span className="save-dot" />{SAVE_LABELS[saveState]}
        </div>
      </div>
    </header>
  )
}
