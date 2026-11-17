import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const lineAt = (css: string, index: number) => css.slice(0, index).split('\n').length

/** Structural problems that make browsers silently drop part of a stylesheet. */
function stylesheetProblems(css: string): string[] {
  const problems: string[] = []
  let depth = 0
  let index = 0
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2)
      if (end < 0) {
        problems.push(`unclosed comment at line ${lineAt(css, index)}`)
        break
      }
      // CSS comments do not nest: an inner "/*" means an earlier "*/" was lost, and the
      // comment now swallows real rules up to the next comment's end.
      if (css.slice(index + 2, end).includes('/*')) problems.push(`comment swallows code from line ${lineAt(css, index)}`)
      index = end + 2
      continue
    }
    const char = css[index]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth < 0) problems.push(`unexpected } at line ${lineAt(css, index)}`)
    }
    index += 1
  }
  if (depth > 0) problems.push(`${depth} unclosed block(s)`)
  return problems
}

describe('stylesheet integrity', () => {
  it.each(['../App.css', '../index.css'])('%s has balanced comments and blocks', (path) => {
    expect(stylesheetProblems(readFileSync(new URL(path, import.meta.url), 'utf8'))).toEqual([])
  })

  it('detects a comment left open at the end of a file', () => {
    expect(stylesheetProblems('/* Phase 4: selection, bookmarks { cursor: text; }\n.a { color: red; }')).toEqual(['unclosed comment at line 1'])
  })

  it('detects a comment that swallows rules up to the next comment', () => {
    // The shape of a real regression: a comment lost its "*/" along with a removed rule.
    const css = '/* Phase 4: selection, bookmarks { cursor: text; }\n.a { color: red; }\n/* Phase 5 */\n.b { color: blue; }'
    expect(stylesheetProblems(css)).toEqual(['comment swallows code from line 1'])
  })
})
