import { classifyDesignator, COMPONENT_TYPE_DESCRIPTIONS, COMPONENT_TYPE_LABELS, DEFAULT_COMPONENT_TYPE_RULES } from './componentTypes.js'

export const MIL_PER_INCH = 1000
export const MIL_PER_MM = 39.37007874015748

export function normalizeUnit(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return 'internal'
  if (/^(?:mil|mils|thou|thousandth)/.test(text)) return 'mil'
  if (/^(?:in|inch|inches|polegada|pol)/.test(text)) return 'inch'
  if (/^(?:mm|millimeter|millimetre|milímetro|milimetro)/.test(text)) return 'mm'
  return 'internal'
}

export function unitFactorToMil(value) {
  const unit = normalizeUnit(value)
  return unit === 'inch' ? MIL_PER_INCH : unit === 'mm' ? MIL_PER_MM : 1
}

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null
const point = value => ({ x: Number(value?.x || 0), y: Number(value?.y || 0) })
const samePoint = (left, right) => Math.abs(left.x - right.x) < 0.00001 && Math.abs(left.y - right.y) < 0.00001

function dedupePoints(points) {
  const seen = new Set()
  return (points || []).map(point).filter(value => {
    const key = `${Math.round(value.x * 1000)}:${Math.round(value.y * 1000)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function cross(origin, left, right) {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x)
}

export function convexHull(points) {
  const sorted = dedupePoints(points).sort((left, right) => left.x - right.x || left.y - right.y)
  if (sorted.length < 4) return sorted
  const lower = []
  for (const value of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), value) <= 0) lower.pop()
    lower.push(value)
  }
  const upper = []
  for (const value of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), value) <= 0) upper.pop()
    upper.push(value)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

const distanceSquared = (left, right) => (left.x - right.x) ** 2 + (left.y - right.y) ** 2
const orientation = (a, b, c) => Math.sign(cross(a, b, c))
const onSegment = (a, b, c) => Math.min(a.x, c.x) <= b.x + 0.00001 && b.x <= Math.max(a.x, c.x) + 0.00001 && Math.min(a.y, c.y) <= b.y + 0.00001 && b.y <= Math.max(a.y, c.y) + 0.00001
const segmentsCross = (a, b, c, d) => {
  const ab1 = orientation(a, b, c); const ab2 = orientation(a, b, d); const cd1 = orientation(c, d, a); const cd2 = orientation(c, d, b)
  if (ab1 !== ab2 && cd1 !== cd2) return true
  return (ab1 === 0 && onSegment(a, c, b)) || (ab2 === 0 && onSegment(a, d, b)) || (cd1 === 0 && onSegment(c, a, d)) || (cd2 === 0 && onSegment(c, b, d))
}

function reduceEvidence(points, limit = 1100) {
  const unique = dedupePoints(points)
  if (unique.length <= limit) return unique
  const xs = unique.map(value => value.x); const ys = unique.map(value => value.y)
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const cellSize = Math.max((maxX - minX), (maxY - minY)) / Math.sqrt(limit)
  if (!Number.isFinite(cellSize) || cellSize <= 0) return unique.slice(0, limit)
  const cells = new Map()
  for (const value of unique) {
    const key = `${Math.floor((value.x - minX) / cellSize)}:${Math.floor((value.y - minY) / cellSize)}`
    const current = cells.get(key)
    if (!current || value.x <= minX + cellSize || value.x >= maxX - cellSize || value.y <= minY + cellSize || value.y >= maxY - cellSize) cells.set(key, value)
  }
  return [...cells.values()].slice(0, limit)
}

/**
 * Concave hull by boundary walking. It is deliberately conservative: when the
 * point cloud is too sparse or a valid walk cannot be closed, convexHull is used.
 */
export function concaveHull(points, options = {}) {
  const input = reduceEvidence(points, options.limit || 1100)
  if (input.length < 4) return convexHull(input)
  const start = input.reduce((best, value) => value.x < best.x || value.x === best.x && value.y < best.y ? value : best, input[0])
  const unused = new Set(input.filter(value => value !== start))
  const hull = [start]
  let current = start
  let previousAngle = 0
  const neighborCount = Math.max(8, Math.min(28, Number(options.neighbors || 14)))
  for (let step = 0; step < input.length + 4; step += 1) {
    const candidates = [...unused].sort((left, right) => distanceSquared(current, left) - distanceSquared(current, right)).slice(0, neighborCount)
    const ranked = candidates.sort((left, right) => {
      const leftAngle = (Math.atan2(left.y - current.y, left.x - current.x) - previousAngle + Math.PI * 2) % (Math.PI * 2)
      const rightAngle = (Math.atan2(right.y - current.y, right.x - current.x) - previousAngle + Math.PI * 2) % (Math.PI * 2)
      return rightAngle - leftAngle || distanceSquared(current, left) - distanceSquared(current, right)
    })
    let next = null
    for (const candidate of ranked) {
      if (candidate === start && hull.length < 4) continue
      const intersects = hull.some((value, index) => {
        if (index === hull.length - 1 || index === 0 && hull.length < 3) return false
        const nextValue = hull[(index + 1) % hull.length]
        return segmentsCross(current, candidate, value, nextValue)
      })
      if (!intersects) { next = candidate; break }
    }
    if (!next) break
    if (next === start) {
      if (hull.length >= 4) return hull
      break
    }
    hull.push(next); unused.delete(next)
    previousAngle = Math.atan2(current.y - next.y, current.x - next.x)
    current = next
  }
  const fallback = convexHull(input)
  return hull.length >= 4 ? hull : fallback
}

function boxOf(points) {
  const values = (points || []).map(point)
  if (!values.length) return null
  const xs = values.map(value => value.x); const ys = values.map(value => value.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

function transformedPoint(value, coordinateSystem) {
  if (coordinateSystem?.coordinatesAreNormalized) return point(value)
  const factor = Number(coordinateSystem?.factorToMil) || unitFactorToMil(coordinateSystem?.originalUnit)
  return { x: Number(value?.x || 0) * factor, y: Number(value?.y || 0) * factor }
}

function transformedDimensions(value, coordinateSystem) {
  if (!value || value.width == null && value.height == null) return null
  const factor = coordinateSystem?.coordinatesAreNormalized ? 1 : Number(coordinateSystem?.factorToMil) || unitFactorToMil(coordinateSystem?.originalUnit)
  return { width: finite(value.width) == null ? null : finite(value.width) * factor, height: finite(value.height) == null ? null : finite(value.height) * factor, source: value.source || 'file' }
}

function packageDimensions(text) {
  const value = String(text || '').toLowerCase()
  const match = value.match(/(?:^|[^0-9])([0-9]{2,4})x([0-9]{2,4})(?:[^0-9]|$)/)
  if (!match) return null
  const toMil = raw => raw.length === 3 ? Number(raw) : Number(raw) / 10
  return { width: toMil(match[1]), height: toMil(match[2]), source: 'package-token' }
}

function dimensionsForComponent(component, pins) {
  const direct = transformedDimensions(component.dimensions, { coordinatesAreNormalized: true })
  if (direct) return direct
  const packageSize = packageDimensions(component.package)
  if (packageSize) return packageSize
  if (pins.length > 1) {
    const bounds = boxOf(pins)
    if (bounds && bounds.width > 0 && bounds.height > 0) return { width: Math.max(bounds.width + 12, 18), height: Math.max(bounds.height + 12, 18), source: 'pin-spread' }
  }
  return { width: null, height: null, source: 'not-provided' }
}

const systemEvidence = [
  ['energia', /(?:VIN|VCC|VDD|VBAT|VBUS|DCIN|ADAPTER|3V3|5V|1V8|1D05|19V)/i],
  ['memória', /(?:DDR|DRAM|MEM|SODIMM|DIMM)/i],
  ['CPU', /(?:CPU|SOC|APU|PCH|VRM)/i],
  ['USB', /USB/i],
  ['SATA', /SATA/i],
  ['PCIe', /PCIe|PCIE/i],
  ['áudio', /AUDIO|MIC|SPK|HP_/i],
  ['rede', /LAN|ETH|WLAN|WIFI|BT_/i],
  ['carregamento', /CHG|CHARG|BATT|BAT_/i],
]

function systemCategory(nets) {
  const matches = systemEvidence.filter(([, pattern]) => nets.some(net => pattern.test(String(net?.name || '')))).map(([label]) => label)
  return matches.length === 1 ? { value: matches[0], confidence: 'inferred' } : { value: 'outros', confidence: 'unknown' }
}

export function normalizeBoard(board, rawComponents = [], rawContour = [], extra = {}) {
  const coordinateSystem = {
    originalUnit: board.coordinateSystem?.originalUnit || board.sourceUnits || board.units || 'boardview-internal',
    normalizedUnit: 'mil',
    factorToMil: Number(board.coordinateSystem?.factorToMil) || unitFactorToMil(board.coordinateSystem?.originalUnit || board.sourceUnits || board.units),
    coordinatesAreNormalized: board.coordinateSystem?.coordinatesAreNormalized !== false,
  }
  const toPoint = value => transformedPoint(value, coordinateSystem)
  const normalizedComponents = rawComponents.map(raw => {
    const pins = (raw.pins || []).map(pinValue => ({
      ...pinValue,
      number: String(pinValue.number ?? ''),
      x: toPoint(pinValue).x,
      y: toPoint(pinValue).y,
      netName: String(pinValue.netName || 'UNCONNECTED'),
      side: pinValue.side || raw.side || 'both',
      dimensions: transformedDimensions(pinValue.dimensions, coordinateSystem),
    }))
    const position = toPoint(raw)
    const typeData = raw.componentType ? { type: raw.componentType, label: COMPONENT_TYPE_LABELS[raw.componentType] || raw.componentType, description: COMPONENT_TYPE_DESCRIPTIONS[raw.componentType] || COMPONENT_TYPE_DESCRIPTIONS.unknown, confidence: 'source', prefix: '' } : classifyDesignator(raw.designator, board.componentTypeRules || DEFAULT_COMPONENT_TYPE_RULES)
    const dimensions = dimensionsForComponent(raw, pins)
    return {
      ...raw,
      designator: String(raw.designator || '').trim(),
      value: raw.value == null ? '' : String(raw.value),
      package: raw.package == null ? '' : String(raw.package),
      side: raw.side || 'both',
      x: position.x,
      y: position.y,
      position: { x: position.x, y: position.y },
      rotation: Number(raw.rotation) || 0,
      dimensions,
      componentType: typeData.type,
      typeLabel: typeData.label,
      typeDescription: typeData.description,
      typeConfidence: typeData.confidence,
      dataConfidence: { type: typeData.confidence, value: raw.value ? 'source' : 'unknown', package: raw.package ? 'source' : 'unknown', position: 'source', pins: pins.length ? 'source' : 'unknown' },
      systemCategory: raw.systemCategory || 'outros',
      systemCategoryConfidence: raw.systemCategoryConfidence || 'unknown',
      pins,
    }
  })
  const explicit = board.outlineSource === 'estimated' || board.contourSource === 'estimated' || extra.outlineSource === 'estimated' ? [] : dedupePoints(rawContour).map(toPoint)
  const evidence = (extra.outlineEvidencePoints || board.outlineEvidencePoints || normalizedComponents.flatMap(component => component.pins.length ? component.pins : [component])).map(toPoint)
  const estimated = evidence.length < 6 ? (() => {
    const bounds = boxOf(evidence)
    if (!bounds) return []
    const margin = 20
    return [{ x: bounds.minX - margin, y: bounds.minY - margin }, { x: bounds.maxX + margin, y: bounds.minY - margin }, { x: bounds.maxX + margin, y: bounds.maxY + margin }, { x: bounds.minX - margin, y: bounds.maxY + margin }]
  })() : concaveHull(evidence, { neighbors: 16 })
  const outline = explicit.length >= 3 ? explicit : estimated
  const outlineSource = explicit.length >= 3 ? 'original' : 'estimated'
  const netsByName = new Map()
  for (const component of normalizedComponents) for (const pin of component.pins) {
    if (!netsByName.has(pin.netName)) netsByName.set(pin.netName, { name: pin.netName, pins: [], type: 'desconhecida', voltage: null })
    netsByName.get(pin.netName).pins.push({ component: component.designator, pin: pin.number, x: pin.x, y: pin.y, side: pin.side })
  }
  const normalizedTestPoints = (board.testPoints || []).map(testPoint => ({ ...testPoint, ...toPoint(testPoint) }))
  for (const normalized of normalizedTestPoints) {
    const name = normalized.netName || 'UNCONNECTED'
    if (!netsByName.has(name)) netsByName.set(name, { name, pins: [], type: 'desconhecida', voltage: null })
    netsByName.get(name).pins.push({ component: normalized.designator, pin: 'TP', x: normalized.x, y: normalized.y, side: normalized.side || 'both' })
  }
  const nets = [...netsByName.values()]
  const pads = normalizedComponents.flatMap(component => component.pins.map(pin => ({ id: `${component.designator}:${pin.number}`, component: component.designator, pin: pin.number, x: pin.x, y: pin.y, side: pin.side, netName: pin.netName, shape: pin.shape || '', dimensions: pin.dimensions || null, dataConfidence: pin.dimensions ? 'source' : 'unknown' })))
  const normalizedPoints = normalizedComponents.flatMap(component => component.pins.length ? component.pins : [component])
  const originalBox = extra.originalBoundingBox || board.originalBoundingBox || boxOf(rawContour) || boxOf(normalizedPoints)
  const normalizedBox = boxOf([...outline, ...normalizedPoints]) || originalBox
  const primitives = { lines: 0, arcs: 0, polygons: 0, holes: 0, vias: 0, keepouts: 0, other: 0, ...(board.geometry?.primitives || extra.geometry?.primitives || {}) }
  const debug = {
    formatDetected: board.sourceFormat || extra.sourceFormat || 'unknown',
    originalUnit: coordinateSystem.originalUnit,
    normalizedUnit: coordinateSystem.normalizedUnit,
    conversionFactor: coordinateSystem.factorToMil,
    counts: { components: normalizedComponents.length, pads: pads.length, pins: normalizedComponents.reduce((sum, component) => sum + component.pins.length, 0), nets: nets.length },
    primitives,
    primitiveTotal: Object.values(primitives).reduce((sum, value) => sum + Number(value || 0), 0),
    explicitOutline: explicit.length >= 3,
    outlineSource,
    originalBoundingBox: originalBox,
    normalizedBoundingBox: normalizedBox,
    outlineAlgorithm: explicit.length >= 3 ? 'arquivo' : 'concave-hull',
    notes: board.geometry?.notes || extra.geometry?.notes || [],
  }
  const categorizedComponents = normalizedComponents.map(component => {
    const localCategory = systemCategory(component.pins.map(pin => ({ name: pin.netName })))
    return { ...component, systemCategory: component.systemCategory === 'outros' ? localCategory.value : component.systemCategory, systemCategoryConfidence: component.systemCategoryConfidence === 'unknown' ? localCategory.confidence : component.systemCategoryConfidence }
  })
  return {
    ...board,
    ...extra,
    units: coordinateSystem.normalizedUnit,
    sourceUnits: coordinateSystem.originalUnit,
    coordinateSystem,
    boardOutline: outline,
    contour: outline,
    outlineSource,
    contourSource: outlineSource,
    contourLabel: outlineSource === 'original' ? 'Contorno original do arquivo' : 'Contorno estimado',
    components: categorizedComponents,
    pads,
    testPoints: normalizedTestPoints,
    nets,
    debug,
    stats: { components: categorizedComponents.length, pads: pads.length, pins: categorizedComponents.reduce((sum, item) => sum + item.pins.length, 0), testPoints: (board.testPoints || []).length, nets: nets.length, contourPoints: outline.length, primitives: debug.primitiveTotal },
  }
}
