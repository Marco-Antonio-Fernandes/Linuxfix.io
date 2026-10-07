import { decodeBoardContent, emptyBoard, finishBoard } from './brd.js'

const tokens = line => (line.match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'|\S+/g) || []).map(value => {
  const text = String(value)
  return text.startsWith('"') && text.endsWith('"') || text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text
})

const number = value => {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

const cleanNet = value => String(value || '').replace(/^\/+/, '') || 'UNCONNECTED'

const detectCad = text => /###Panel Added Part Information/i.test(text) && /\bC_PIN\b/.test(text)
const unitScale = units => /millimeter|millimetre|mm/i.test(String(units || '')) ? 39.37007874015748 : /mil|thou/i.test(String(units || '')) ? 1 : /inch|inches|polegada/i.test(String(units || '')) ? 1000 : 1
const isOutlineRecord = kind => /^(?:BOARD_OUTLINE|B_OUTLINE|BOARD_EDGE|EDGE|CONTOUR|OUTLINE|POLYGON)$/i.test(String(kind || ''))

export function parseCad(content, options = {}) {
  const { text } = decodeBoardContent(content)
  if (!text.trim()) throw new Error('O arquivo .cad está vazio.')
  if (!detectCad(text)) throw new Error('Formato .cad não reconhecido. Este arquivo não parece ser o neutral file de boardview aceito pelo OpenBoardView.')

  const components = []
  const componentsByName = new Map()
  const testPoints = []
  let currentNet = ''
  let units = 'unknown'
  let coordinateScale = unitScale(units)
  let boardName = ''
  let boardBounds = []
  const outlinePoints = []
  const physicalPoints = []
  let holeCount = 0
  const primitiveCounts = { lines: 0, arcs: 0, polygons: 0, holes: 0, vias: 0, keepouts: 0, other: 0 }
  const primitiveNotes = []

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const values = tokens(line)
    const kind = values[0]
    const upperKind = String(kind || '').toUpperCase()
    if (kind === 'BOARD') {
      boardName = values[1] || ''
      continue
    }
    if (kind === 'B_UNITS') {
      units = values[1] || 'unknown'
      coordinateScale = unitScale(units)
      continue
    }
    if (kind === 'NET') {
      currentNet = cleanNet(values[1])
      continue
    }
    if (kind === 'COMP' && values.length >= 9) {
      const x = number(values[5]); const y = number(values[6]); const sideCode = number(values[7]); const rotation = number(values[8])
      if (x === null || y === null || sideCode === null) continue
      const component = {
        designator: values[1],
        value: values[2] || '',
        package: values[4] || values[3] || '',
        side: sideCode === 1 ? 'top' : 'bottom',
        x: x * coordinateScale,
        y: y * coordinateScale,
        rotation: rotation ?? 0,
        pins: [],
      }
      components.push(component)
      componentsByName.set(component.designator, component)
      continue
    }
    if (kind === 'C_PIN' && values.length >= 9) {
      const fullPinName = values[1]
      const separator = fullPinName.lastIndexOf('-')
      const designator = separator > 0 ? fullPinName.slice(0, separator) : fullPinName
      const numberValue = separator > 0 ? fullPinName.slice(separator + 1) : String(componentsByName.get(designator)?.pins.length + 1 || 1)
      const x = number(values[2]); const y = number(values[3])
      if (x === null || y === null) continue
      const component = componentsByName.get(designator)
      if (!component) continue
      component.pins.push({ number: numberValue, x: x * coordinateScale, y: y * coordinateScale, netName: cleanNet(values[8]), side: component.side, shape: values[7] || '' })
      continue
    }
    if (kind === 'N_VIA' && values.length >= 6 && currentNet) {
      const x = number(values[1]); const y = number(values[2]); const sideCode = number(values[4])
      if (x !== null && y !== null) {
        testPoints.push({ designator: `TP${testPoints.length + 1}`, x: x * coordinateScale, y: y * coordinateScale, netName: currentNet, side: sideCode === 1 ? 'top' : 'bottom' })
        physicalPoints.push({ x, y })
        primitiveCounts.vias += 1
      }
      continue
    }
    if (kind === 'HOLE' && values.length >= 4) {
      const x = number(values[2]); const y = number(values[3])
      if (x !== null && y !== null) {
        physicalPoints.push({ x, y })
        holeCount += 1
        primitiveCounts.holes += 1
      }
      continue
    }
    if (/^(?:LINE|SEGMENT|EDGE|BOARD_EDGE|B_EDGE)$/i.test(upperKind)) primitiveCounts.lines += 1
    else if (/^(?:ARC|CIRCLE|ROUND)$/i.test(upperKind)) primitiveCounts.arcs += 1
    else if (/^(?:POLY|POLYGON|OUTLINE|CONTOUR|BOARD_OUTLINE|B_OUTLINE)$/i.test(upperKind)) primitiveCounts.polygons += 1
    else if (/KEEP.?OUT/i.test(line)) primitiveCounts.keepouts += 1
    else if (/^(?:G_ATTR|P_SHAPE|P_ADDP|B_ADDP|GEOM|G_PIN)$/i.test(upperKind)) primitiveCounts.other += 1
    if (isOutlineRecord(kind)) {
      const valuesAfterKind = values.slice(1).map(number)
      if (valuesAfterKind.length >= 2 && valuesAfterKind.every(value => value !== null)) {
        if (valuesAfterKind.length === 4) boardBounds = valuesAfterKind
        else if (valuesAfterKind.length % 2 === 0) {
          for (let index = 0; index < valuesAfterKind.length; index += 2) outlinePoints.push({ x: valuesAfterKind[index], y: valuesAfterKind[index + 1] })
        }
      }
    }
  }

  if (!components.length) throw new Error('CAD reconhecido, mas nenhuma linha COMP válida foi encontrada.')
  const allPoints = components.flatMap(component => component.pins.length ? component.pins : [{ x: component.x, y: component.y }])
  if (!allPoints.length) throw new Error('CAD reconhecido, mas nenhuma posição de componente ou pino foi encontrada.')
  const explicitContour = outlinePoints.length >= 3
    ? outlinePoints.map(point => ({ x: point.x * coordinateScale, y: point.y * coordinateScale }))
    : boardBounds.length >= 4
      ? [{ x: Math.min(boardBounds[0], boardBounds[2]) * coordinateScale, y: Math.min(boardBounds[1], boardBounds[3]) * coordinateScale }, { x: Math.max(boardBounds[0], boardBounds[2]) * coordinateScale, y: Math.min(boardBounds[1], boardBounds[3]) * coordinateScale }, { x: Math.max(boardBounds[0], boardBounds[2]) * coordinateScale, y: Math.max(boardBounds[1], boardBounds[3]) * coordinateScale }, { x: Math.min(boardBounds[0], boardBounds[2]) * coordinateScale, y: Math.max(boardBounds[1], boardBounds[3]) * coordinateScale }]
      : []
  const contourSource = explicitContour.length >= 3 ? 'original' : 'estimated'
  const evidencePoints = [...allPoints, ...physicalPoints.map(point => ({ x: point.x * coordinateScale, y: point.y * coordinateScale }))]
  const xs = evidencePoints.map(point => point.x); const ys = evidencePoints.map(point => point.y)
  const margin = physicalPoints.length ? 100 : 20
  const minX = Math.min(...xs) - margin; const maxX = Math.max(...xs) + margin
  const minY = Math.min(...ys) - margin; const maxY = Math.max(...ys) + margin
  const contour = explicitContour.length >= 3 ? explicitContour : []
  const board = {
    ...emptyBoard(options.fileName, false),
    name: boardName || options.fileName || 'Boardview CAD',
    model: boardName || String(options.fileName || '').replace(/\.[^.]+$/, ''),
    sourceFormat: 'cad-neutral',
    units,
    sourceUnits: units,
    coordinateSystem: { originalUnit: units, normalizedUnit: 'mil', factorToMil: coordinateScale, coordinatesAreNormalized: true },
    testPoints,
    contourSource,
    outlineSource: contourSource,
    outlineEvidencePoints: physicalPoints.map(point => ({ x: point.x * coordinateScale, y: point.y * coordinateScale })),
    originalBoundingBox: { minX: Math.min(...physicalPoints.map(point => point.x)), maxX: Math.max(...physicalPoints.map(point => point.x)), minY: Math.min(...physicalPoints.map(point => point.y)), maxY: Math.max(...physicalPoints.map(point => point.y)) },
    geometry: { primitives: primitiveCounts, notes: primitiveNotes },
    contourEvidence: { holes: holeCount, vias: testPoints.length, pins: allPoints.length },
  }
  return finishBoard(board, components, contour, {
    warnings: [
      `Neutral file CAD detectado (${units}). A geometria detalhada do componente não é necessária para o mapa; valor e encapsulamento vêm da linha COMP.`,
      contourSource === 'original' ? 'Contorno original encontrado no arquivo.' : `Contorno estimado por pinos, vias e ${holeCount} furos físicos; o CAD não forneceu uma borda explícita da PCB.`,
    ],
  })
}
