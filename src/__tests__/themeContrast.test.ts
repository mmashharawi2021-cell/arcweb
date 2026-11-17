import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Reads `--name: #rrggbb` custom properties from one CSS block. */
function tokensOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No ${selector} block in index.css`)
  const block = css.slice(start, css.indexOf('\n}', start))
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2]]))
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const dark = tokensOf(css, ':root')
// The light block only overrides; anything it omits falls back to the dark value.
const light = { ...dark, ...tokensOf(css, ':root[data-theme="light"]') }
const themes = { dark, light }

const pairs: [string, string][] = [
  ['--text', '--bg'], ['--text', '--panel'], ['--text', '--panel-raised'], ['--text-secondary', '--panel'],
  ['--muted', '--panel-raised'], ['--accent-ink', '--accent'], ['--accent-text', '--panel'], ['--accent-text', '--panel-raised'],
]

describe('theme contrast', () => {
  it.each(['dark', 'light'] as const)('%s theme meets 4.5:1 for text pairs', (theme) => {
    for (const [foreground, background] of pairs) {
      const tokens = themes[theme]
      expect(tokens[foreground], `${foreground} defined`).toBeDefined()
      expect(contrast(tokens[foreground], tokens[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['dark', 'light'] as const)('%s theme uses a blue accent', (theme) => {
    const hex = themes[theme]['--accent']
    const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })
})
