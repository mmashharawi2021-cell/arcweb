import { expect, it } from 'vitest'
import { loadMapBlob } from '../mapBlobProtocol'
it('reads local map JSON in the worker protocol and respects abort/revocation', async () => {
  const input = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', properties: { name: 'محطة' }, geometry: null }] }
  const url = URL.createObjectURL(new Blob([JSON.stringify(input)], { type: 'application/json' }))
  expect((await loadMapBlob({ url, type: 'json' }, new AbortController())).data).toEqual(input)
  const cancelled = new AbortController(); cancelled.abort()
  await expect(loadMapBlob({ url, type: 'json' }, cancelled)).rejects.toMatchObject({ name: 'AbortError' })
  URL.revokeObjectURL(url)
  await expect(loadMapBlob({ url, type: 'json' }, new AbortController())).rejects.toThrow()
})
