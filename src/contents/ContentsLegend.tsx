import { Circle, Layers3, MoveRight, Table2, Triangle } from 'lucide-react'
import type { MapLayer } from '../store'
import { getGraduatedClassCounts, getGraduatedClasses, getUniqueValueClasses } from '../symbology'

export function LayerIcon({ geometry }: { geometry: MapLayer['geometry'] }) {
  if (geometry === 'Point') return <Circle size={15} strokeWidth={2.2} />
  if (geometry === 'Line') return <MoveRight size={16} strokeWidth={2.2} />
  if (geometry === 'Polygon') return <Triangle size={15} strokeWidth={2.2} />
  if (geometry === 'Unknown') return <Table2 size={15} />
  return <Layers3 size={15} />
}

export function ContentsRendererLegend({ layer }: { layer: MapLayer }) {
  if (layer.renderer.type === 'single') return null
  const graduatedCounts = layer.renderer.type === 'graduated' ? getGraduatedClassCounts(layer, layer.renderer) : []
  const classes = layer.renderer.type === 'unique'
    ? getUniqueValueClasses(layer, layer.renderer.field, layer.renderer)
    : getGraduatedClasses(layer.renderer).map((item, index) => ({
      ...item,
      count: graduatedCounts[index],
    }))
  return (
    <div className="contents-class-list">
      {classes.map((item) => <div className="contents-class-row" key={item.value} title={item.label}>
        <span className={`contents-class-swatch geometry-${layer.geometry.toLowerCase()} shape-${layer.pointShape}`} style={{ backgroundColor: item.color, borderColor: layer.geometry === 'Point' ? layer.strokeColor : item.color, opacity: layer.opacity * layer.fillOpacity }} />
        <span className="contents-class-label">{item.label}</span>
        <span className="contents-class-count">{item.count.toLocaleString()}</span>
      </div>)}
    </div>
  )
}
