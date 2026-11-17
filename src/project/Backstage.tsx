import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowLeft, Download, FileInput, FilePlus2, FolderOpen, Copy } from 'lucide-react'
import { trapTabKey, useRestoreFocus } from '../a11y/modalFocus'
import ProjectLibraryContent, { type ProjectLibraryContentProps } from '../storage/ProjectLibraryContent'
import type { CoordinateFormat, LengthUnit, UiSettings } from '../ui/uiSettings'

export type BackstageSection = 'new' | 'open' | 'save-as' | 'library' | 'options' | 'about'

const SECTIONS: { id: BackstageSection; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'open', label: 'Open' },
  { id: 'save-as', label: 'Save As' },
  { id: 'library', label: 'Projects & offline' },
  { id: 'options', label: 'Options' },
  { id: 'about', label: 'About' },
]

const UNIT_OPTIONS: { value: LengthUnit; label: string }[] = [
  { value: 'metric', label: 'Metric (m, km)' },
  { value: 'imperial', label: 'Imperial (ft, mi)' },
  { value: 'nautical', label: 'Nautical (NM)' },
]

const FORMAT_OPTIONS: { value: CoordinateFormat; label: string }[] = [
  { value: 'dd', label: 'Decimal degrees' },
  { value: 'dms', label: 'Degrees minutes seconds' },
  { value: 'ddm', label: 'Degrees decimal minutes' },
  { value: 'utm', label: 'UTM' },
]

const LIBRARIES = ['React', 'MapLibre GL JS', 'Turf.js', 'Zustand', 'proj4', 'shpjs', '@tmcw/togeojson', 'Papa Parse', 'jsPDF', 'Lucide']

interface BackstageProps {
  projectName: string
  section: BackstageSection
  onSection: (section: BackstageSection) => void
  onClose: () => void
  /** New › Blank map: start an empty workspace; the current project stays in Projects. */
  onNewBlank: () => void
  /** Open › Browse: pick an .arcweb.json file. */
  onOpenFile: () => void
  /** Save As › Download project file. */
  onSaveFile: () => void
  /** Save As › Save a copy in Projects. */
  onSaveCopy: () => void
  library: Omit<ProjectLibraryContentProps, 'sections' | 'onDone' | 'onBusyChange' | 'autoFocusFirst'>
  settings: UiSettings
  onSettings: (settings: UiSettings) => void
  /** Reports a running storage operation, so the app can keep shortcuts from replacing the page. */
  onBusyChange?: (busy: boolean) => void
}

/** ArcGIS Pro–style "Project" page: a full-window view with a blue navigation rail. */
export default function Backstage({
  projectName, section, onSection, onClose, onNewBlank, onOpenFile, onSaveFile, onSaveCopy, library, settings, onSettings, onBusyChange,
}: BackstageProps) {
  useRestoreFocus()
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { backRef.current?.focus() }, [])

  // While a storage operation runs (restore, download, open), leaving would unmount it mid-way:
  // its result could be lost, or a late restore could overwrite edits made after leaving.
  const [busy, setBusy] = useState(false)
  const reportBusy = (value: boolean) => { setBusy(value); onBusyChange?.(value) }
  const close = () => { if (!busy) onClose() }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const command = event.ctrlKey || event.metaKey
    // Ctrl/⌘+S and +O stay application shortcuts; every other key belongs to this page, so
    // window handlers (layout Delete/arrows, Ctrl+Z, sketch Escape) never act on the hidden map.
    if (!(command && !event.altKey && (event.key.toLowerCase() === 's' || event.key.toLowerCase() === 'o'))) event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    trapTabKey(event)
  }

  return (
    <div className="backstage" role="dialog" aria-modal="true" aria-label="Project" aria-busy={busy} tabIndex={-1} onKeyDown={onKeyDown}>
      <nav className="backstage-rail" aria-label="Project">
        <button ref={backRef} type="button" className="backstage-back" aria-label="Back to map" disabled={busy} onClick={close}><ArrowLeft size={18} aria-hidden="true" /></button>
        <div role="tablist" aria-orientation="vertical" aria-label="Project sections">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" role="tab" id={`backstage-tab-${item.id}`} aria-selected={item.id === section}
              aria-controls="backstage-panel" className="backstage-tab" disabled={busy} onClick={() => onSection(item.id)}>{item.label}</button>
          ))}
        </div>
      </nav>
      <section id="backstage-panel" className="backstage-panel" role="tabpanel" aria-labelledby={`backstage-tab-${section}`}>
        <header className="backstage-header"><h1>{SECTIONS.find((item) => item.id === section)?.label}</h1><p>Current project: <bdi>{projectName}</bdi></p></header>
        {section === 'new' && (
          <div className="backstage-cards">
            <button type="button" className="backstage-card" onClick={() => { onNewBlank(); onClose() }}>
              <FilePlus2 size={32} aria-hidden="true" /><strong>Blank map</strong><span>Start an empty map. The current project stays in Projects.</span>
            </button>
          </div>
        )}
        {section === 'open' && (
          <>
            <div className="backstage-cards">
              <button type="button" className="backstage-card" onClick={() => { onClose(); onOpenFile() }}>
                <FolderOpen size={32} aria-hidden="true" /><strong>Browse for a project file…</strong><span>Open an .arcweb.json file from this computer.</span>
              </button>
            </div>
            <h2>Projects on this device</h2>
            <ProjectLibraryContent {...library} sections={['projects']} onDone={onClose} onBusyChange={reportBusy} />
          </>
        )}
        {section === 'save-as' && (
          <div className="backstage-cards">
            <button type="button" className="backstage-card" onClick={onSaveFile}>
              <Download size={32} aria-hidden="true" /><strong>Download project file</strong><span>Save the whole workspace as an .arcweb.json file.</span>
            </button>
            <button type="button" className="backstage-card" onClick={onSaveCopy}>
              <Copy size={32} aria-hidden="true" /><strong>Save a copy in Projects</strong><span>Keep a separate copy in this browser's project library.</span>
            </button>
          </div>
        )}
        {section === 'library' && <ProjectLibraryContent {...library} sections={['projects', 'recovery', 'backup', 'offline']} onDone={onClose} onBusyChange={reportBusy} />}
        {section === 'options' && (
          <div className="backstage-options">
            <fieldset>
              <legend>Theme</legend>
              {(['light', 'dark'] as const).map((theme) => (
                <label key={theme}>
                  <input type="radio" name="backstage-theme" value={theme} checked={settings.theme === theme}
                    onChange={() => onSettings({ ...settings, theme })} />
                  {theme === 'light' ? 'Light' : 'Dark'}
                </label>
              ))}
            </fieldset>
            <label>Measure units
              <select aria-label="Measure units" value={settings.measureUnits}
                onChange={(event) => onSettings({ ...settings, measureUnits: event.target.value as LengthUnit })}>
                {UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>Coordinate format
              <select aria-label="Coordinate format" value={settings.coordinateFormat}
                onChange={(event) => onSettings({ ...settings, coordinateFormat: event.target.value as CoordinateFormat })}>
                {FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <p className="modal-note">These preferences are saved in this browser, not in the project.</p>
          </div>
        )}
        {section === 'about' && (
          <div className="backstage-about">
            <p><strong>ArcWeb</strong> — client-side Web GIS for students. Everything runs in your browser; no data leaves this device.</p>
            <p>Version {__APP_VERSION__}</p>
            <h2>Open-source libraries</h2>
            <ul>{LIBRARIES.map((name) => <li key={name}>{name}</li>)}</ul>
            <p className="modal-note"><FileInput size={12} aria-hidden="true" /> ArcWeb is an independent project and is not affiliated with Esri.</p>
          </div>
        )}
      </section>
    </div>
  )
}
