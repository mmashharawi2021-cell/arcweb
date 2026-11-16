import { describe, expect, it } from 'vitest'
import { isolate } from '../bidi'

describe('isolate', () => {
  it('wraps text in first-strong isolates', () => { expect(isolate('طبقة QA')).toBe('\u2068طبقة QA\u2069') })
  it('keeps surrounding text unchanged', () => { expect(`Removed ${isolate('طبقة')} from the map.`).toMatch(/^Removed \u2068طبقة\u2069 from the map\.$/) })
})
