import type { ToolboxTool } from '../types'
import { geocodeAddressesTool } from './geocodeAddresses'
import { reverseGeocodeTool } from './reverseGeocode'

export const geocodingTools: ToolboxTool[] = [geocodeAddressesTool, reverseGeocodeTool]

export { geocodeAddressesTool, reverseGeocodeTool }
