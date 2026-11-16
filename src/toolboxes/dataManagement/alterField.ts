import { isolate } from '../../bidi'
import { fieldNames, getLayer, getOptionalText, getText } from '../shared'
import type { ToolboxTool } from '../types'

const FIELD_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u

/** Alter Field: rename an attribute key and optionally set, clear, or preserve its display alias. */
export const alterFieldTool: ToolboxTool = {
  id: 'alter-field',
  name: 'Alter Field',
  category: 'Data Management',
  subcategory: 'Fields',
  description: 'Rename a field and optionally set or clear its display alias.',
  keywords: ['field', 'rename', 'alias', 'attributes', 'schema'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'field', label: 'Field to rename', kind: 'field', layerParameter: 'target', required: true },
    { id: 'newName', label: 'New field name', kind: 'text', required: true },
    {
      id: 'aliasAction', label: 'Field alias', kind: 'select', defaultValue: 'keep',
      options: [
        { value: 'keep', label: 'Keep existing alias' },
        { value: 'set', label: 'Set alias' },
        { value: 'clear', label: 'Clear alias' },
      ],
    },
    { id: 'alias', label: 'Alias', kind: 'text', placeholder: 'Display name for this field' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const oldName = getText(parameters, 'field', 'a field')
    const field = fieldNames(layer).find((name) => name === oldName || name.toLowerCase() === oldName.toLowerCase())
    if (!field) throw new Error(`Field "${isolate(oldName)}" was not found in ${isolate(layer.name)}.`)
    const newName = getText(parameters, 'newName', 'a new field name')
    if (!FIELD_NAME.test(newName)) throw new Error(`"${isolate(newName)}" is not a valid field name.`)
    if (field !== newName && fieldNames(layer).some((name) => name.toLowerCase() === newName.toLowerCase())) {
      throw new Error(`A field named "${isolate(newName)}" already exists.`)
    }
    const aliasAction = getOptionalText(parameters, 'aliasAction') || 'keep'
    if (!['keep', 'set', 'clear'].includes(aliasAction)) throw new Error(`Unknown alias action: ${aliasAction}.`)
    const aliasValue = getOptionalText(parameters, 'alias')
    if (aliasAction === 'set' && !aliasValue) throw new Error('Enter an alias to set.')
    const data = {
      ...layer.data,
      features: layer.data.features.map((feature) => {
        const properties = { ...(feature.properties ?? {}) }
        if (field !== newName && Object.prototype.hasOwnProperty.call(properties, field)) {
          properties[newName] = properties[field]
          delete properties[field]
        }
        return { ...feature, properties }
      }),
    }
    const customFields = (layer.customFields ?? []).map((name) => name === field ? newName : name)
    const renderer = layer.renderer.type === 'unique' || layer.renderer.type === 'graduated'
      ? { ...layer.renderer, field: layer.renderer.field === field ? newName : layer.renderer.field }
      : layer.renderer
    const renameToken = (text: string) => text.replace(/\{([^{}]+)\}/g, (token, name: string) => name.trim() === field ? `{${newName}}` : token)
    const labelStyle = { ...layer.labelStyle, expression: renameToken(layer.labelStyle.expression) }
    const extrusion = layer.extrusion && layer.extrusion.field === field ? { ...layer.extrusion, field: newName } : layer.extrusion
    const fieldAliases = { ...(layer.fieldAliases ?? {}) }
    const previousAlias = fieldAliases[field]
    if (field !== newName) {
      delete fieldAliases[field]
      if (previousAlias !== undefined) fieldAliases[newName] = previousAlias
    }
    if (aliasAction === 'set') fieldAliases[newName] = aliasValue
    else if (aliasAction === 'clear') delete fieldAliases[newName]
    return {
      message: field !== newName
        ? `Renamed "${isolate(field)}" to "${isolate(newName)}"${aliasAction === 'set' ? ' and set its alias' : aliasAction === 'clear' ? ' and cleared its alias' : ''}.`
        : aliasAction === 'set' ? `Set the alias for "${isolate(field)}".`
          : aliasAction === 'clear' ? `Cleared the alias for "${isolate(field)}".`
            : `Field "${isolate(field)}" is already named "${isolate(newName)}".`,
      updates: [{ layerId: layer.id, updates: {
        data, customFields,
        labelField: layer.labelField === field ? newName : layer.labelField,
        renderer,
        labelStyle, extrusion,
        fieldAliases,
      } }],
    }
  },
}
