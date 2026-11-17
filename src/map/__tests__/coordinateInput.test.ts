// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { parseAngle } from '../coordinateInput'
import GoToXY from '../GoToXY'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

describe('parseAngle', () => {
  it('reads decimal degrees, DMS and space-separated forms', () => {
    expect(parseAngle('31.5', 'lat')).toBe(31.5)
    expect(parseAngle(`31°30'00"N`, 'lat')).toBeCloseTo(31.5)
    expect(parseAngle('34 27 0 E', 'lon')).toBeCloseTo(34.45)
    expect(parseAngle(`35°12.258' E`, 'lon')).toBeCloseTo(35.2043, 4)
    expect(parseAngle('  -73.9857 ', 'lon')).toBe(-73.9857)
  })

  it('lets a hemisphere letter set the sign', () => {
    expect(parseAngle('12.5 S', 'lat')).toBe(-12.5)
    expect(parseAngle('-12.5 N', 'lat')).toBe(12.5)
    expect(parseAngle('W 77 2 1', 'lon')).toBeCloseTo(-77.0336, 4)
  })

  it('rejects out-of-range and malformed input', () => {
    expect(parseAngle('95', 'lat')).toBeNull()
    expect(parseAngle('181', 'lon')).toBeNull()
    expect(parseAngle('abc', 'lon')).toBeNull()
    expect(parseAngle('', 'lat')).toBeNull()
    expect(parseAngle('31 60 0', 'lat')).toBeNull()
    expect(parseAngle('31 30 75', 'lat')).toBeNull()
  })

  it('rejects a hemisphere letter on the wrong axis', () => {
    expect(parseAngle('31 E', 'lat')).toBeNull()
    expect(parseAngle('34 N', 'lon')).toBeNull()
  })
})

describe('GoToXY', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const field = (label: string) => document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
  const type = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label) as HTMLButtonElement

  it('goes to valid coordinates with the chosen action', () => {
    const onGo = vi.fn()
    renderComponent(createElement(GoToXY, { onGo, onClose: vi.fn() }))
    type(field('Longitude'), '34 27 0 E')
    type(field('Latitude'), `31°30'00"N`)
    act(() => button('Flash').click())
    expect(onGo).toHaveBeenCalledWith([expect.closeTo(34.45, 6), expect.closeTo(31.5, 6)], 'flash')
    act(() => button('Add Marker').click())
    expect(onGo).toHaveBeenLastCalledWith(expect.any(Array), 'marker')
  })

  it('pans when Enter is pressed in a field', () => {
    const onGo = vi.fn()
    renderComponent(createElement(GoToXY, { onGo, onClose: vi.fn() }))
    type(field('Longitude'), '35.2')
    type(field('Latitude'), '31.9')
    act(() => { field('Latitude').form!.requestSubmit() })
    expect(onGo).toHaveBeenCalledWith([35.2, 31.9], 'pan')
  })

  it('explains invalid input instead of moving the map', () => {
    const onGo = vi.fn()
    renderComponent(createElement(GoToXY, { onGo, onClose: vi.fn() }))
    type(field('Longitude'), '200')
    type(field('Latitude'), '31.5')
    act(() => button('Pan To').click())
    expect(onGo).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Longitude')
    expect(field('Longitude').getAttribute('aria-invalid')).toBe('true')
  })

  it('closes with Escape without reaching window handlers', () => {
    const onClose = vi.fn()
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    renderComponent(createElement(GoToXY, { onGo: vi.fn(), onClose }))
    act(() => { field('Longitude').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    window.removeEventListener('keydown', spy)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('focuses Longitude when it opens', () => {
    renderComponent(createElement(GoToXY, { onGo: vi.fn(), onClose: vi.fn() }))
    expect(document.activeElement).toBe(field('Longitude'))
  })
})
