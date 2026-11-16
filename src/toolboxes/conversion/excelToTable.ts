import { getFile, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { readTableFile, recordsToTable } from './_utils'

export const excelToTableTool: ToolboxTool = {
  id: 'excel-to-table',
  runsOnMainThread: true,
  name: 'Excel/CSV To Table',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Import an Excel workbook sheet (.xlsx) or a CSV file as a stand-alone attribute table (no geometry). The first row supplies field names.',
  keywords: ['excel', 'xlsx', 'csv', 'spreadsheet', 'table', 'import', 'standalone table', 'sheet'],
  parameters: [
    { id: 'file', label: 'Input Excel or CSV file', kind: 'file', required: true, accept: '.xlsx,.csv,.txt' },
    { id: 'sheet', label: 'Sheet name (Excel only)', kind: 'text', placeholder: 'First sheet' },
    { id: 'outputName', label: 'Output table name', kind: 'text', placeholder: 'File name' },
  ],
  execute: async (_context, parameters) => {
    const file = getFile(parameters, 'file', 'Excel or CSV')
    const { fields, records, sheetName } = await readTableFile(file, getOptionalText(parameters, 'sheet') || undefined)
    if (!records.length) throw new Error('The table has a header row but no data rows.')
    const name = getOptionalText(parameters, 'outputName') || `${file.name.replace(/\.[^.]+$/, '')}${sheetName ? ` ${sheetName}` : ''}`
    const layer = outputLayer(name, recordsToTable(records))
    layer.customFields = fields
    return {
      message: `${layer.name}: imported ${records.length.toLocaleString()} rows and ${fields.length} fields as a table without geometry.`,
      layers: [layer],
    }
  },
}
