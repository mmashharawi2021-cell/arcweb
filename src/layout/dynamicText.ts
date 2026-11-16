import { formatRatio } from './scaleBar'

/**
 * Dynamic text for layout text, titles and title blocks: tokens such as {date} or {scale} are
 * replaced when the sheet is drawn and exported, so metadata stays current without retyping.
 */

export interface DynamicTextContext {
  now: Date
  projectName: string
  crsName: string
  crsCode: string
  /** Map frame scale denominator (25 000 for 1:25,000), or null without a map frame. */
  scaleDenominator: number | null
  layerCount: number
  paper: string
}

export const DYNAMIC_TOKENS: { token: string; description: string }[] = [
  { token: '{date}', description: 'Today’s date' },
  { token: '{datetime}', description: 'Date and time' },
  { token: '{year}', description: 'Current year' },
  { token: '{project}', description: 'Project name' },
  { token: '{crs}', description: 'Coordinate system name' },
  { token: '{crsCode}', description: 'EPSG code' },
  { token: '{scale}', description: 'Map frame scale (1:n)' },
  { token: '{layers}', description: 'Number of layers' },
  { token: '{paper}', description: 'Paper size' },
]

export function resolveDynamicText(text: string, context: DynamicTextContext): string {
  const values: Record<string, string> = {
    date: context.now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    datetime: context.now.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    year: String(context.now.getFullYear()),
    project: context.projectName,
    crs: context.crsName,
    crscode: context.crsCode,
    scale: context.scaleDenominator && Number.isFinite(context.scaleDenominator) ? formatRatio(context.scaleDenominator) : '—',
    layers: String(context.layerCount),
    paper: context.paper,
  }
  // Unknown tokens are left untouched so literal braces in a label still print.
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) => values[name.toLowerCase()] ?? match)
}
