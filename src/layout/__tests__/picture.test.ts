import { describe, expect, it } from 'vitest'
import { buildProject, parseProject } from '../../project'
import { defaultWorkspaceLayout } from '../../workspaceLayout'
import { isEmbeddedPicture } from '../picture'
import { useLayoutStore } from '../layoutStore'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const picture = { id: 'picture', type: 'picture' as const, x: 10, y: 20, w: 60, h: 40, src: png, alt: 'Logo', fit: 'contain' as const }
function roundTrip(src = png) {
  const layout = { paper: 'A4' as const, orientation: 'landscape' as const, elements: [{ ...picture, src }] }
  return parseProject(JSON.stringify(buildProject({ name: 'Pictures', basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [], layers: [], layout, workspaceLayout: defaultWorkspaceLayout() })), { ...layout, elements: [] }).layout
}
describe('layout pictures', () => {
  it('embeds image content, description, fit and geometry in project round trips', () => {
    expect(roundTrip().elements).toEqual([picture])
  })
  it('rejects external URLs, SVG and non-image content on project load', () => {
    for (const src of ['https://example.com/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)']) {
      expect(isEmbeddedPicture(src)).toBe(false)
      expect(roundTrip(src).elements).toEqual([])
    }
  })
  it('retains pictures through page resizing and layout restore', () => {
    const original = useLayoutStore.getState()
    try {
      original.restore(roundTrip())
      original.setPage('A3', 'portrait')
      expect(useLayoutStore.getState().elements[0]).toMatchObject({ src: png, alt: 'Logo', type: 'picture' })
      original.removeElement('picture')
      expect(useLayoutStore.getState().elements).toEqual([])
    } finally { original.restore(original) }
  })
})
