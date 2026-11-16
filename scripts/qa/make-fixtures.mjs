// Dev-only QA fixture generator for the Phase 8 browser regression pass.
// Usage: node scripts/qa/make-fixtures.mjs   (writes to tmp/qa-fixtures/, which is gitignored)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(resolve(root, 'package.json'))
const out = resolve(root, 'tmp', 'qa-fixtures')
mkdirSync(out, { recursive: true })
const { writeArrayBuffer, fromArrayBuffer } = await import(pathToFileURL(require.resolve('geotiff')).href)
const shpwrite = (await import(pathToFileURL(require.resolve('@mapbox/shp-write')).href)).default
const JSZip = require('jszip')

// ---- GeoTIFF DEMs (40x30 Float32): EPSG:4326 and EPSG:32636 ----
const W = 40, H = 30
const surface = new Float32Array(W * H)
for (let r = 0; r < H; r += 1) for (let c = 0; c < W; c += 1) surface[r * W + c] = 20 + 80 * Math.exp(-(((c - 26) / 9) ** 2 + ((r - 10) / 7) ** 2)) + r * 0.8
const tiff = (pixelScale, tiepoint, keys) => Buffer.from(writeArrayBuffer(surface, {
  width: W, height: H, BitsPerSample: [32], SampleFormat: [3], SamplesPerPixel: 1, PhotometricInterpretation: 1,
  ModelPixelScale: pixelScale, ModelTiepoint: [0, 0, 0, ...tiepoint, 0], GTRasterTypeGeoKey: 1, ...keys,
}))
writeFileSync(`${out}/dem_wgs84.tif`, tiff([0.002, 0.002, 0], [34.40, 31.53], { GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 }))
writeFileSync(`${out}/dem_utm36.tif`, tiff([60, 60, 0], [651000, 3490500], { GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32636 }))

// ---- Shapefiles (with and without .prj) ----
const rows = [
  { name: 'حي الرمال', landuse: 'res', area_ha: 12.5, pop: 5400 },
  { name: 'Market 7 سوق', landuse: 'com', area_ha: 3.2, pop: 900 },
  { name: 'Park', landuse: 'green', area_ha: 8.1, pop: 0 },
  { name: 'الشاطئ 2', landuse: 'res', area_ha: 15.7, pop: 7600 },
]
const origins = [[34.44, 31.50], [34.446, 31.50], [34.452, 31.50], [34.44, 31.506]]
const sq = (x, y, d, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] } })
const parcels = { type: 'FeatureCollection', features: rows.map((row, i) => sq(origins[i][0], origins[i][1], 0.004, row)) }
const zipped = await shpwrite.zip(parcels, { outputType: 'nodebuffer', types: { polygon: 'parcels' } })

// @mapbox/shp-write truncates non-ASCII text, so write a minimal UTF-8 dBase III file by hand (+ .cpg).
const fields = [{ name: 'name', type: 'C', size: 60, dec: 0 }, { name: 'landuse', type: 'C', size: 10, dec: 0 }, { name: 'area_ha', type: 'N', size: 10, dec: 2 }, { name: 'pop', type: 'N', size: 10, dec: 0 }]
const recordSize = 1 + fields.reduce((s, f) => s + f.size, 0)
const headerSize = 32 + fields.length * 32 + 1
const dbf = Buffer.alloc(headerSize + rows.length * recordSize + 1, 0)
dbf[0] = 0x03; dbf[1] = 126; dbf[2] = 11; dbf[3] = 15
dbf.writeUInt32LE(rows.length, 4); dbf.writeUInt16LE(headerSize, 8); dbf.writeUInt16LE(recordSize, 10)
fields.forEach((f, i) => { const o = 32 + i * 32; dbf.write(f.name, o, 'latin1'); dbf.write(f.type, o + 11, 'latin1'); dbf[o + 16] = f.size; dbf[o + 17] = f.dec })
dbf[headerSize - 1] = 0x0d
rows.forEach((row, r) => {
  let o = headerSize + r * recordSize
  dbf[o++] = 0x20
  for (const f of fields) {
    const v = row[f.name]
    const bytes = f.type === 'C' ? Buffer.from(String(v), 'utf8') : Buffer.from((f.dec ? Number(v).toFixed(f.dec) : String(v)).padStart(f.size, ' '), 'latin1')
    const cell = Buffer.alloc(f.size, 0x20); bytes.copy(cell, 0, 0, Math.min(bytes.length, f.size)); cell.copy(dbf, o); o += f.size
  }
})
dbf[dbf.length - 1] = 0x1a
const archive = await JSZip.loadAsync(zipped)
for (const [name, keepPrj] of [['parcels_wgs84.zip', true], ['parcels_noprj.zip', false]]) {
  const zip = new JSZip()
  for (const [entry, file] of Object.entries(archive.files)) {
    if (file.dir) continue
    const base = entry.split('/').pop()
    if (!keepPrj && base.toLowerCase().endsWith('.prj')) continue
    zip.file(base, base.endsWith('.dbf') ? dbf : await file.async('nodebuffer'))
  }
  zip.file('parcels.cpg', 'UTF-8')
  writeFileSync(`${out}/${name}`, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

// ---- KML (main-thread import path) ----
const kmlPlacemark = (n, x, y) => `<Placemark><name>${n}</name><Point><coordinates>${x},${y},0</coordinates></Point></Placemark>`
writeFileSync(`${out}/places.kml`, `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>places</name>${kmlPlacemark('مسجد الشاطئ', 34.45, 31.51)}${kmlPlacemark('Clinic A', 34.455, 31.512)}${kmlPlacemark('Clinic B', 34.46, 31.505)}</Document></kml>`)

// ---- XLSX (one sheet, inline strings) for Excel to Table ----
const xl = new JSZip()
xl.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
xl.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
xl.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>')
xl.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
const cell = (ref, v) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`)
const sheetRows = [['City', 'Population'], ['Nablus', 156000], ['Hebron', 215000], ['غزة', 590000]]
xl.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(`${String.fromCharCode(65 + c)}${r + 1}`, v)).join('')}</row>`).join('')}</sheetData></worksheet>`)
writeFileSync(`${out}/cities.xlsx`, await xl.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

// ---- Independent read-back validation (geotiff / shpjs) ----
globalThis.self ??= globalThis
const shpModule = await import(pathToFileURL(require.resolve('shpjs')).href)
const shp = typeof shpModule.default === 'function' ? shpModule.default : globalThis.shp
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
for (const name of ['dem_wgs84.tif', 'dem_utm36.tif']) {
  const buf = readFileSync(`${out}/${name}`)
  const image = await (await fromArrayBuffer(ab(buf))).getImage()
  const values = await image.readRasters({ samples: [0], interleave: true })
  const keys = image.getGeoKeys()
  console.log(name, `${image.getWidth()}x${image.getHeight()}`, 'origin', image.getOrigin().slice(0, 2), 'EPSG', keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey, 'min/max', Math.min(...values).toFixed(1), Math.max(...values).toFixed(1))
}
for (const name of ['parcels_wgs84.zip', 'parcels_noprj.zip']) {
  const fc = await shp(ab(readFileSync(`${out}/${name}`)))
  console.log(name, fc.features.length, 'features; names:', fc.features.map((f) => f.properties.name).join(' | '))
}
console.log('wrote places.kml, cities.xlsx to', out)
