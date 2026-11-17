// Public-domain Natural Earth fixtures; keep large downloads out of version control.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

globalThis.self ??= globalThis // shpjs also supports a browser/worker global.
const { default: shapefile } = await import('shpjs')
const directory = path.resolve('tmp/real-data')
fs.mkdirSync(directory, { recursive: true })
const sources = [
  ['countries', 'https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip'],
  ['roads', 'https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_roads.zip'],
]
const records = []
for (const [name, url] of sources) {
  const zipPath = path.join(directory, `${name}.zip`)
  if (!fs.existsSync(zipPath)) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Natural Earth download returned HTTP ${response.status}`)
    fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()))
  }
  const bytes = fs.readFileSync(zipPath)
  const data = await shapefile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  if (Array.isArray(data)) throw new Error('Expected a single layer per fixture')
  const json = JSON.stringify(data)
  fs.writeFileSync(path.join(directory, `${name}.geojson`), json)
  let coordinates = 0
  const count = value => { if (Array.isArray(value)) { if (typeof value[0] === 'number') coordinates++; else value.forEach(count) } }
  for (const feature of data.features) count(feature.geometry?.coordinates)
  const record = { name, url, license: 'Public domain', terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
    zipBytes: bytes.length, geojsonBytes: Buffer.byteLength(json), features: data.features.length, coordinates,
    zipSha256: createHash('sha256').update(bytes).digest('hex'), geojsonSha256: createHash('sha256').update(json).digest('hex') }
  records.push(record)
  console.log(JSON.stringify(record))
}
fs.writeFileSync(path.join(directory, 'sources.json'), JSON.stringify(records, null, 2))
