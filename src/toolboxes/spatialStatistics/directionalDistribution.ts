import { featureCollection } from '@turf/helpers'
import type { Feature, Polygon } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { caseProperties, distributionGroups, distributionNotes, localFrame, planarPolygon, projectSites, roundPosition, tidy } from './_stats'

export interface EllipseParameters {
  centerX: number
  centerY: number
  /** Standard distance along the rotated x-axis (metres, one standard deviation). */
  sigmaX: number
  /** Standard distance along the rotated y-axis (metres, one standard deviation). */
  sigmaY: number
  /** Clockwise angle from north to the ellipse's y-axis, degrees in [0, 180). */
  rotation: number
}

/**
 * Standard deviational ellipse, following Esri's "How Directional Distribution works":
 *   tan θ = (A + B) / C, A = Σx̃² − Σỹ², B = √(A² + 4(Σx̃ỹ)²), C = 2Σx̃ỹ
 *   σx = √2 · √(Σ(x̃ cos θ − ỹ sin θ)² / n),  σy = √2 · √(Σ(x̃ sin θ + ỹ cos θ)² / n)
 * θ is the clockwise rotation from north of the y-axis; weights replace n by Σw.
 */
export function standardDeviationalEllipse(points: { x: number; y: number; weight: number }[]): EllipseParameters {
  let total = 0
  let centerX = 0
  let centerY = 0
  for (const point of points) {
    total += point.weight
    centerX += point.weight * point.x
    centerY += point.weight * point.y
  }
  centerX /= total
  centerY /= total
  let xx = 0
  let yy = 0
  let xy = 0
  for (const point of points) {
    const dx = point.x - centerX
    const dy = point.y - centerY
    xx += point.weight * dx * dx
    yy += point.weight * dy * dy
    xy += point.weight * dx * dy
  }
  const scale = Math.max(xx, yy, 1e-12)
  const a = (xx - yy) / scale
  const c = (2 * xy) / scale
  const b = Math.sqrt(a * a + c * c)
  // atan2 keeps θ in [0, 180]: the numerator A + B is never negative.
  let theta = Math.atan2(Math.abs(a + b) < 1e-12 ? 0 : a + b, Math.abs(c) < 1e-12 ? 0 : c)
  if (theta >= Math.PI) theta -= Math.PI
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  let sx = 0
  let sy = 0
  for (const point of points) {
    const dx = point.x - centerX
    const dy = point.y - centerY
    sx += point.weight * (dx * cos - dy * sin) ** 2
    sy += point.weight * (dx * sin + dy * cos) ** 2
  }
  return {
    centerX,
    centerY,
    sigmaX: Math.SQRT2 * Math.sqrt(sx / total),
    sigmaY: Math.SQRT2 * Math.sqrt(sy / total),
    rotation: (theta * 180) / Math.PI,
  }
}

/** Directional Distribution: the standard deviational ellipse of the features. */
export const directionalDistributionTool: ToolboxTool = {
  id: 'directional-distribution',
  name: 'Directional Distribution (Standard Deviational Ellipse)',
  category: 'Spatial Statistics',
  subcategory: 'Measuring Geographic Distributions',
  description: 'Create standard deviational ellipses summarizing the central tendency, dispersion, and directional trend of features.',
  keywords: ['ellipse', 'standard deviational ellipse', 'sde', 'orientation', 'trend', 'dispersion', 'distribution'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    {
      id: 'size', label: 'Ellipse size', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '1 standard deviation' }, { value: '2', label: '2 standard deviations' }, { value: '3', label: '3 standard deviations' }],
    },
    { id: 'weightField', label: 'Weight field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'caseField', label: 'Case field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Directional distribution' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const weightField = getOptionalText(parameters, 'weightField')
    const caseField = getOptionalText(parameters, 'caseField')
    const size = Number(getOptionalText(parameters, 'size') || '1')
    if (![1, 2, 3].includes(size)) throw new Error('Choose an ellipse size of 1, 2, or 3 standard deviations.')
    const { groups, excluded, skippedCases } = distributionGroups(layer, { weightField, caseField, minimum: 3, toolName: 'Directional Distribution' })

    const ellipses: Feature<Polygon>[] = []
    for (const { caseValue, sites } of groups) {
      const frame = localFrame(sites)
      const ellipse = standardDeviationalEllipse(projectSites(sites, frame))
      if (!(ellipse.sigmaX > 0 || ellipse.sigmaY > 0)) continue
      const theta = (ellipse.rotation * Math.PI) / 180
      // Rotated axes: x-axis → (cos θ, −sin θ), y-axis → (sin θ, cos θ) (clockwise from north).
      const geometry = planarPolygon(frame, (angle) => {
        const u = size * ellipse.sigmaX * Math.cos(angle)
        const v = size * ellipse.sigmaY * Math.sin(angle)
        return [ellipse.centerX + u * Math.cos(theta) + v * Math.sin(theta), ellipse.centerY - u * Math.sin(theta) + v * Math.cos(theta)]
      })
      const [lon, lat] = roundPosition(frame.toLonLat(ellipse.centerX, ellipse.centerY))
      ellipses.push({
        type: 'Feature',
        geometry,
        properties: {
          ...caseProperties(caseField, caseValue),
          CenterX: lon,
          CenterY: lat,
          XStdDist: tidy(size * ellipse.sigmaX),
          YStdDist: tidy(size * ellipse.sigmaY),
          Rotation: tidy(ellipse.rotation),
        },
      })
    }
    if (!ellipses.length) throw new Error('All features share one location, so no ellipse can be drawn.')

    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Directional Distribution`, featureCollection(ellipses))
    output.opacity = 0.35
    const first = ellipses[0].properties!
    return {
      message: `${output.name}: ${ellipses.length === 1
        ? `ellipse (${size} std. dev.) with XStdDist ${first.XStdDist} m, YStdDist ${first.YStdDist} m, rotation ${first.Rotation}° clockwise from north`
        : `${ellipses.length} ellipses (one per case, ${size} std. dev.)`}.${distributionNotes(excluded, skippedCases, 3)}`,
      layers: [output],
    }
  },
}
