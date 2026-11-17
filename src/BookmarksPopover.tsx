import { useEffect, useState } from 'react'
import { Bookmark as BookmarkIcon, BookmarkPlus, Trash2 } from 'lucide-react'
import type { Bookmark } from './store'
import { useFadeExit } from './ui/useFadeExit'

interface BookmarksPopoverProps {
  bookmarks: Bookmark[]
  /** Screen position of the popover's top-left corner. */
  anchor: { left: number; top: number }
  onAdd: (name: string) => void
  onGo: (bookmark: Bookmark) => void
  onRemove: (id: string) => void
  onClose: () => void
}

/** Spatial bookmarks: named camera extents to jump between study areas. */
export default function BookmarksPopover({ bookmarks, anchor, onAdd, onGo, onRemove, onClose }: BookmarksPopoverProps) {
  const [name, setName] = useState('')
  const fadeRef = useFadeExit<HTMLDivElement>()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', onClose)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onClose)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const submit = () => {
    onAdd(name.trim() || `Bookmark ${bookmarks.length + 1}`)
    setName('')
  }

  return (
    <div ref={fadeRef} className="bookmarks-popover" role="dialog" aria-label="Bookmarks" style={{ left: anchor.left, top: anchor.top }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="bookmarks-title"><BookmarkIcon size={13} /><strong>Bookmarks</strong><span>{bookmarks.length}</span></div>
      <div className="bookmarks-new">
        <input autoFocus value={name} placeholder="Name this view, e.g. Study area A" aria-label="Bookmark name" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
        <button title="Save the current map view as a bookmark" onClick={submit}><BookmarkPlus size={13} />New</button>
      </div>
      <div className="bookmarks-list">
        {bookmarks.map((bookmark) => (
          <div key={bookmark.id} className="bookmark-row">
            <button className="bookmark-go" title={`Zoom to ${bookmark.name}`} onClick={() => onGo(bookmark)}>
              <strong>{bookmark.name}</strong>
              <small>{Math.abs(bookmark.center[1]).toFixed(4)}°{bookmark.center[1] < 0 ? 'S' : 'N'}, {Math.abs(bookmark.center[0]).toFixed(4)}°{bookmark.center[0] < 0 ? 'W' : 'E'} · zoom {bookmark.zoom.toFixed(1)}</small>
            </button>
            <button className="bookmark-remove" title={`Delete ${bookmark.name}`} onClick={() => onRemove(bookmark.id)}><Trash2 size={12} /></button>
          </div>
        ))}
        {!bookmarks.length && <div className="bookmarks-empty">No bookmarks yet. Navigate to a study area and choose New to save the view.</div>}
      </div>
    </div>
  )
}
