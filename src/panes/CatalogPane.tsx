import { useArcWebStore } from '../store'
import { useEffect, useState } from 'react'
import { toolboxTools } from '../toolboxes/registry'
import { assetInfo, getAsset } from '../storage/assets'
import { Database, FileInput, FolderOpen, Layers, Server, Table2 } from 'lucide-react'

export function CatalogPane({
  assetIds, onView, onTool, onAdd, onOffline, offlineBasemapName, onNewLayer,
}: {
  offlineBasemapName?: string
  assetIds: string[]
  onView: (kind: '2d' | 'layout') => void
  onTool: (id: string) => void
  onAdd: (files: File[]) => void
  onOffline: () => void
  onNewLayer?: () => void
}) {
  const [search, setSearch] = useState('')
  const [assets, setAssets] = useState<{ id: string; name: string; missing: boolean }[]>([])
  const layers = useArcWebStore(state => state.layers)
  const projectName = useArcWebStore(state => state.projectName)
  const key = assetIds.join('|')

  useEffect(() => {
    let alive = true
    void Promise.all(
      key.split('|').filter(Boolean).map(async id => {
        try {
          const info = await assetInfo(id)
          return { id, name: info?.name ?? 'Source file is no longer stored', missing: !info }
        } catch {
          return { id, name: 'Source file is no longer stored', missing: true }
        }
      })
    ).then(rows => { if (alive) setAssets(rows) })
    return () => { alive = false }
  }, [key])

  const match = (text: string) => text.toLowerCase().includes(search.toLowerCase())

  const gdbName = (projectName || 'Untitled map') + '.arcweb'

  return (
    <div className="pro-pane-content catalog-pane">
      <input aria-label="Search Catalog" placeholder="Search Catalog" value={search} onChange={e => setSearch(e.target.value)} />

      {/* ── Databases ───────────────────────────── */}
      {(!search || match('database geodatabase feature class shapefile')) && (
        <>
          <div className="catalog-section-header">
            <Database size={13} /><span>Databases</span>
          </div>
          <div className="catalog-new-row">
            <button className="catalog-new-btn" title="New File Geodatabase — creates an empty layer collection in this project" onClick={onNewLayer}>
              <Database size={12} /><span>New File Geodatabase</span>
            </button>
            <button className="catalog-new-btn" title="New Personal Geodatabase — same as file geodatabase in ArcWeb (browser storage)" onClick={onNewLayer}>
              <FolderOpen size={12} /><span>New Personal Geodatabase</span>
            </button>
            <button className="catalog-new-btn" title="New Feature Class — creates an empty editable layer" onClick={onNewLayer}>
              <Layers size={12} /><span>New Feature Class</span>
            </button>
            <button className="catalog-new-btn" title="New Table — creates a standalone attribute table layer" onClick={onNewLayer}>
              <Table2 size={12} /><span>New Table</span>
            </button>
            <button className="catalog-new-btn" title="Import data — add GeoJSON, Shapefile, KML or CSV" onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.multiple = true
              input.accept = '.geojson,.json,.zip,.kml,.kmz,.csv'
              input.onchange = () => { if (input.files?.length) onAdd([...input.files]) }
              input.click()
            }}>
              <FileInput size={12} /><span>Import Data…</span>
            </button>
          </div>
          {layers.length > 0 && (
            <details className="catalog-gdb" open>
              <summary><Database size={12} /><bdi>{gdbName}</bdi></summary>
              {layers.filter(l => match(l.name)).map(layer => (
                <div key={layer.id} className="catalog-feature-class">
                  <span className={`geometry-icon geometry-${layer.geometry.toLowerCase()}`} />
                  <bdi>{layer.name}</bdi>
                  <span className="catalog-fc-type">{layer.geometry}</span>
                </div>
              ))}
            </details>
          )}
        </>
      )}

      {/* ── Database Servers (read-only note) ───── */}
      {(!search || match('server enterprise sde connection')) && (
        <>
          <div className="catalog-section-header">
            <Server size={13} /><span>Database Servers</span>
          </div>
          <div className="catalog-info-note">
            Enterprise geodatabases (SDE) require a backend server.<br />
            ArcWeb is a fully offline browser app — connect via your ArcGIS Server or use local layers.
          </div>
        </>
      )}

      {/* ── Maps ────────────────────────────────── */}
      <h3>Maps</h3>
      {match('Map') && <button onClick={() => onView('2d')}>Map</button>}

      {/* ── Layouts ─────────────────────────────── */}
      <h3>Layouts</h3>
      {match('Layout') && <button onClick={() => onView('layout')}>Layout</button>}

      {/* ── Toolboxes ───────────────────────────── */}
      <h3>Toolboxes</h3>
      {[...new Set(toolboxTools.map(tool => tool.category))]
        .filter(category => toolboxTools.some(tool => tool.category === category && match(tool.name + ' ' + category)))
        .map(category => (
          <details key={category}>
            <summary>{category}</summary>
            {toolboxTools.filter(tool => tool.category === category && match(tool.name + ' ' + category)).map(tool => (
              <button key={tool.id} onClick={() => onTool(tool.id)}>{tool.name}</button>
            ))}
          </details>
        ))}

      {/* ── Project files ───────────────────────── */}
      <h3>Project files</h3>
      {assets.filter(asset => match(asset.name)).map(asset => (
        <div key={asset.id}>
          <bdi>{asset.name}</bdi>
          <button disabled={asset.missing} onClick={() =>
            void getAsset(asset.id)
              .then(blob => onAdd([new File([blob], asset.name)]))
              .catch(error => useArcWebStore.getState().addNotification(error instanceof Error ? error.message : 'Could not read source file', 'error'))
          }>Add To Current Map</button>
        </div>
      ))}

      {/* ── Offline basemaps ────────────────────── */}
      <h3>Offline basemaps</h3>
      <bdi>{offlineBasemapName ?? 'No offline basemap selected'}</bdi>
      <button onClick={onOffline}>Manage...</button>
    </div>
  )
}
