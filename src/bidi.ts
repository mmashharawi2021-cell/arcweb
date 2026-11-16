const FIRST_STRONG_ISOLATE = '\u2068'
const POP_DIRECTIONAL_ISOLATE = '\u2069'

/**
 * Wraps user-supplied text (layer, file, field, project or bookmark names) in
 * Unicode isolates so RTL or mixed-direction names keep their order inside an
 * LTR English sentence. Apply only to interpolated names, never whole messages.
 */
export function isolate(text: string): string {
  return FIRST_STRONG_ISOLATE + text + POP_DIRECTIONAL_ISOLATE
}
