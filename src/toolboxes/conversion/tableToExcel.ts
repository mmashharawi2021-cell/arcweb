import { isolate } from '../../bidi'
import JSZip from 'jszip'
import { getLayer, getOptionalText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import { exportableFeatures, layerFields, safeName, scalar, xmlEscape } from './_utils'

function columnName(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

function cell(reference: string, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`
  if (value === null || value === undefined || value === '') return `<c r="${reference}"/>`
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(scalar(value))}</t></is></c>`
}

/** Create a standards-compliant minimal XLSX workbook with one worksheet and inline cell strings. */
export async function buildXlsx(layer: Parameters<typeof exportableFeatures>[0], fileName?: string): Promise<ToolDownload> {
  const fields = layerFields(layer)
  if (fields.length > 16_384) throw new Error('Excel supports at most 16,384 columns.')
  const rows = exportableFeatures(layer).map((feature) => feature.properties ?? {})
  if (rows.length + 1 > 1_048_576) throw new Error('Excel supports at most 1,048,576 rows per worksheet.')
  const xmlRows = [fields.map((field, index) => cell(`${columnName(index)}1`, field)).join('')]
  rows.forEach((row, rowIndex) => {
    xmlRows.push(fields.map((field, columnIndex) => cell(`${columnName(columnIndex)}${rowIndex + 2}`, row[field])).join(''))
  })
  const lastColumn = columnName(Math.max(0, fields.length - 1))
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.map((row, index) => `<row r="${index + 1}">${row}</row>`).join('')}</sheetData>${fields.length ? `<autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>` : ''}</worksheet>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Table" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', sheet)
  return {
    fileName: `${safeName(fileName || layer.name)}.xlsx`,
    blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' }),
  }
}

export const tableToExcelTool: ToolboxTool = {
  id: 'table-to-excel',
  name: 'Table To Excel',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export layer attributes to an Excel .xlsx worksheet.',
  keywords: ['excel', 'xlsx', 'spreadsheet', 'table', 'export', 'download'],
  parameters: [
    { id: 'target', label: 'Input table / layer', kind: 'layer', required: true },
    { id: 'fileName', label: 'Output file name', kind: 'text', placeholder: 'Table name' },
  ],
  execute: async (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const result = await buildXlsx(layer, getOptionalText(parameters, 'fileName'))
    return { message: `Prepared ${isolate(result.fileName)} (${layer.data.features.length.toLocaleString()} rows).`, downloads: [result] }
  },
}
