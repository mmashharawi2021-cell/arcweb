import { useRef, useState } from 'react'
import { MapPin, Search, X, Loader } from 'lucide-react'
import { geocodeAddress } from '../toolboxes/geocoding/nominatim'

interface LocateResult {
  name: string
  center: [number, number]
}

interface Props {
  onGo: (center: [number, number]) => void
  onClose: () => void
}

export default function LocatePanel({ onGo, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocateResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const feature = await geocodeAddress(q)
      if (!feature) {
        setError('No results found.')
      } else {
        setResults([{
          name: feature.properties?.display_name as string ?? q,
          center: feature.geometry.coordinates as [number, number],
        }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="locate-panel" role="dialog" aria-label="Locate">
      <div className="locate-header">
        <MapPin size={14} />
        <span>Locate</span>
        <button className="locate-close" aria-label="Close Locate" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="locate-search">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          placeholder="Search for a place or address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(); if (e.key === 'Escape') onClose() }}
        />
        <button aria-label="Search" onClick={() => void search()} disabled={loading}>
          {loading ? <Loader size={14} className="spin" /> : <Search size={14} />}
        </button>
      </div>
      {error && <p className="locate-error">{error}</p>}
      {results.map((result, index) => (
        <button key={index} className="locate-result" onClick={() => { onGo(result.center); onClose() }}>
          <MapPin size={12} />
          <bdi>{result.name}</bdi>
        </button>
      ))}
    </div>
  )
}
