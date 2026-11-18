import { useState } from 'react'
import { Download, FileImage, FileText, LayoutTemplate, Map as MapIcon, Settings, X } from 'lucide-react'
import { insertableElements } from '../layout/catalog'
import { elementLabels, type LayoutElementType } from '../layout/layoutStore'
import { PAPER_SIZES, type PaperSize, type Orientation } from '../layout/paper'
import type { LayoutExportFormat } from '../layout/exportLayout'
import { RibbonButton, RibbonGroup, RibbonMenuButton } from './RibbonParts'
import { RibbonGroupBar } from './RibbonGroupBar'

interface Props {
  tab: 'LayoutInsert' | 'LayoutExport'
  paper: PaperSize
  orientation: Orientation
  exporting: boolean
  onPage: (paper: PaperSize, orientation: Orientation) => void
  onInsert: (type: LayoutElementType) => void
  onExport: (format: LayoutExportFormat, dpi: number) => void
  onClose: () => void
}
export function LayoutRibbon({ tab, paper, orientation, exporting, onPage, onInsert, onExport, onClose }: Props) {
  const [dpi, setDpi] = useState(200)
  if (tab === 'LayoutInsert') return <RibbonGroupBar>
    <RibbonGroup label="Map Elements" icon={LayoutTemplate}>
      {insertableElements.map(({ type, icon }) => <RibbonButton key={type} id={'layout-insert-' + type} label={elementLabels[type]} icon={icon} size="large" onClick={() => onInsert(type)} />)}
    </RibbonGroup>
    <RibbonGroup label="Page Setup" icon={Settings}>
      <RibbonMenuButton id="layout-paper" label={paper} icon={FileText} size="large" items={PAPER_SIZES.map(item => ({ id: item.id, label: item.label, onSelect: () => onPage(item.id, orientation) }))} />
      <RibbonMenuButton id="layout-orientation" label={orientation === 'portrait' ? 'Portrait' : 'Landscape'} icon={LayoutTemplate} size="large" items={(['portrait', 'landscape'] as const).map(value => ({ id: value, label: value === 'portrait' ? 'Portrait' : 'Landscape', onSelect: () => onPage(paper, value) }))} />
    </RibbonGroup>
  </RibbonGroupBar>
  return <RibbonGroupBar>
    <RibbonGroup label="Export Layout" icon={Download}>
      <RibbonMenuButton id="layout-dpi" label={dpi + ' DPI'} icon={Settings} size="large" disabled={exporting} items={[150, 200, 300].map(value => ({ id: String(value), label: value + ' DPI', onSelect: () => setDpi(value) }))} />
      <RibbonButton id="layout-export-png" label="PNG" icon={FileImage} size="large" disabled={exporting} onClick={() => onExport('png', dpi)} />
      <RibbonButton id="layout-export-pdf" label="PDF" icon={FileText} size="large" disabled={exporting} onClick={() => onExport('pdf', dpi)} />
    </RibbonGroup>
    <RibbonGroup label="Close" icon={MapIcon}><RibbonButton id="layout-close" label="Close Layout" icon={X} size="large" disabled={exporting} onClick={onClose} /></RibbonGroup>
  </RibbonGroupBar>
}
