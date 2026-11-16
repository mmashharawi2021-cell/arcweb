import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { PanelFrame } from './workspaceLayout'

interface DockablePanelProps {
  floating: boolean
  frame: PanelFrame
  className?: string
  children: ReactNode
  onFrameChange: (frame: PanelFrame) => void
}

let nextZIndex = 30

export default function DockablePanel({ floating, frame, className = '', children, onFrameChange }: DockablePanelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const frameRef = useRef(frame)
  const resizeTimerRef = useRef<number | null>(null)

  useEffect(() => { frameRef.current = frame }, [frame])

  useEffect(() => {
    const root = rootRef.current
    if (!floating || !root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        const bounds = root.getBoundingClientRect()
        const current = frameRef.current
        const width = Math.round(bounds.width)
        const height = Math.round(bounds.height)
        if (Math.abs(width - current.width) < 2 && Math.abs(height - current.height) < 2) return
        onFrameChange({ ...current, width, height })
      }, 120)
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current)
    }
  }, [floating, onFrameChange])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!floating) return
    event.currentTarget.style.zIndex = String(++nextZIndex)
    const target = event.target as HTMLElement
    if (!target.closest('.dock-heading, .attribute-table-header')) return
    if (target.closest('button, input, select, textarea, a')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const movePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const root = event.currentTarget
    const bounds = root.getBoundingClientRect()
    const maxLeft = Math.max(0, window.innerWidth - Math.min(bounds.width, Math.max(0, window.innerWidth - 12)))
    const maxTop = Math.max(0, window.innerHeight - Math.min(bounds.height, Math.max(0, window.innerHeight - 12)))
    const left = Math.max(0, Math.min(maxLeft, event.clientX - drag.offsetX))
    const top = Math.max(0, Math.min(maxTop, event.clientY - drag.offsetY))
    root.style.left = `${left}px`
    root.style.top = `${top}px`
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    const bounds = event.currentTarget.getBoundingClientRect()
    onFrameChange({ ...frameRef.current, left: Math.round(bounds.left), top: Math.round(bounds.top) })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={rootRef}
      className={`panel-window-shell ${floating ? 'is-floating' : ''} ${className}`}
      style={floating ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height } : undefined}
      onPointerDownCapture={startDrag}
      onPointerMove={movePanel}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {children}
    </div>
  )
}
