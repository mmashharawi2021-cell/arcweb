import { afterEach, describe, expect, it, vi } from 'vitest'
import Papa from 'papaparse'
import { exportLayer } from '../exportData'
import { testLayer } from '../toolboxes/testUtils'

afterEach(() => vi.unstubAllGlobals())

describe('Share CSV export', () => {
  it('includes an Excel-compatible UTF-8 BOM and preserves Arabic attributes', async () => {
    let downloaded: Blob | undefined
    const revokeObjectURL = vi.fn()
    const timers: (() => void)[] = []
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:audit'; },
      revokeObjectURL,
    })
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor })
    vi.stubGlobal('window', { setTimeout: (callback: () => void) => { timers.push(callback); return 1 } })
    const layer = testLayer('Arabic export', [{
      type: 'Feature', properties: { name: '\u0645\u062d\u0637\u0629', _geometry: 'user data' },
      geometry: { type: 'Point', coordinates: [35, 31] },
    }])
    exportLayer(layer, 'csv')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(downloaded).toBeDefined()
    const bytes = new Uint8Array(await downloaded!.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const rows = Papa.parse<Record<string, string>>(await downloaded!.text(), { header: true }).data
    expect(rows[0].name).toBe('\u0645\u062d\u0637\u0629')
    expect(rows[0]._geometry).toBe('user data')
    expect(JSON.parse(rows[0].__geometry)).toEqual(layer.data.features[0].geometry)
    timers.forEach((callback) => callback())
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audit')
  })
})
