import { describe, expect, it } from 'vitest'
import { testLayer } from '../../toolboxes/testUtils'
import { selectToolInputLayers } from '../toolInputs'

describe('worker tool input scope', () => {
  it('transports only explicitly referenced layer parameters, retaining workspace order and references', () => {
    const layers = ['unrelated', 'target', 'mask'].map((name) => testLayer(name, []))
    const tool = { parameters: [
      { id: 'target', label: 'Target', kind: 'layer' as const },
      { id: 'masks', label: 'Masks', kind: 'layers' as const },
      { id: 'text', label: 'Text', kind: 'text' as const },
    ] }
    const result = selectToolInputLayers(tool, layers, { target: layers[1].id, masks: `${layers[2].id},${layers[1].id}`, text: layers[0].id })
    expect(result).toEqual([layers[1], layers[2]])
    expect(result[0]).toBe(layers[1])
    expect(selectToolInputLayers(tool, layers, {})).toEqual([])
  })
})
