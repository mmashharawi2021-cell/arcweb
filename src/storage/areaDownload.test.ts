import { afterEach, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { downloadArea, NASA_TILE_ROOT, planArea } from './areaDownload'

afterEach(() => vi.unstubAllGlobals())
it('covers exact XYZ quadrants without including east/south neighbouring tiles', () => {
  expect(planArea([0, 0, 180, 85.0511287798066], 1, 1).tiles).toEqual([{ z: 1, x: 1, y: 0 }])
  expect(planArea([0, -85.0511287798066, 180, 0], 1, 1).tiles).toEqual([{ z: 1, x: 1, y: 1 }])
  expect(planArea([-180, -85, 180, 85], 0, 1).tiles.length).toBe(5)
})
it('rejects invalid bounds, unsupported zoom and large plans before network access', () => {
  expect(() => planArea([170, -5, -170, 5], 0, 3)).toThrow('date-line')
  expect(() => planArea([0, 0, 1, 90], 0, 3)).toThrow()
  expect(() => planArea([0, 0, 1, 1], 3, 2)).toThrow()
  expect(() => planArea([0, 0, 1, 1], 0, 9)).toThrow()
  expect(() => planArea([-180, -85, 180, 85], 0, 8)).toThrow('2,000')
})
it('downloads only approved NASA URLs and creates an importable XYZ package', async () => {
  const jpeg = new Uint8Array(40); jpeg.set([255, 216]); jpeg.set([255, 217], 38)
  const fetcher = vi.fn(async (_url: string) => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }))
  vi.stubGlobal('fetch', fetcher)
  const progress = vi.fn(), plan = planArea([0, 0, 180, 85], 1, 1)
  const file = await downloadArea({ ...plan, tiles: [{ z: 999, x: 999, y: 999 }] }, new AbortController().signal, progress)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toBe(`${NASA_TILE_ROOT}/1/0/1.jpeg`)
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  expect(zip.file('tiles/1/1/0.jpg')).not.toBeNull()
  const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'))
  expect(metadata).toMatchObject({ format: 'jpg', minZoom: 1, maxZoom: 1, bounds: plan.bounds })
  expect(progress).toHaveBeenLastCalledWith(1, 1, 40)
})
it('does not start requests when already cancelled', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController(); controller.abort()
  await expect(downloadArea(planArea([0, 0, 1, 1], 0, 0), controller.signal, () => undefined)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('aborts other requests when a tile fails, without returning a partial archive', async () => {
  let other: AbortSignal | undefined
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    if (++calls === 1) return new Response('Unavailable', { status: 503 })
    other = options.signal ?? undefined
    return new Promise<Response>((_resolve, reject) => other!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }))
  }))
  await expect(downloadArea(planArea([-180, -85, 180, 85], 1, 1), new AbortController().signal, () => undefined)).rejects.toThrow('503')
  expect(calls).toBe(2)
  expect(other?.aborted).toBe(true)
})
