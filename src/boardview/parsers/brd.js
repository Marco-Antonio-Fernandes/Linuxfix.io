import { normalizeBoard } from '../model/normalizedBoard.js'

const ENCODED_HEADER = [0x23, 0xe2, 0x63, 0x28]

const stripQuotes = value => {
  const text = String(value ?? '')
  return text.startsWith('"') && text.endsWith('"') || text.startsWith("'") && text.endsWith("'")
    ? text.slice(1, -1)
    : text
}

const tokens = line => (line.match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'|\S+/g) || []).map(stripQuotes)

const numeric = value => {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

const isEncoded = bytes => ENCODED_HEADER.every((value, index) => bytes[index] === value)

export function decodeBoardContent(content) {
  const bytes = content instanceof Uint8Array
    ? content
    : content instanceof ArrayBuffer
      ? new Uint8Array(content)
      : null
  if (!bytes) return { text: String(content ?? ''), encoded: false }

  let decoded = bytes
  const encoded = isEncoded(bytes)
  if (encoded) {
    decoded = new Uint8Array(bytes.length)
    for (let index = 0; index < bytes.length; index += 1) {
      const value = bytes[index]
      decoded[index] = value === 0x0a || value === 0x0d || value === 0
        ? value
        : (~(((value >> 6) & 3) | (value << 2))) & 0xff
    }
  }

  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(decoded),
    encoded,
  }
}

const layerFromCode = code => {
  if (code === 1 || code >= 4 && code < 8) return 'top'
  if (code === 2 || code >= 8) return 'bottom'
  return 'both'
}

const typeFromCode = code => code !== null && (code & 0xc) ? 'smd' : 'through-hole'

export function emptyBoard(fileName, encoded, warnings = []) {
  const stem = String(fileName || 'board').replace(/\.[^.]+$/, '')
  return {
    id: stem || 'board',
    name: fileName || 'Boardview',
    model: stem || '',
    revision: '',
    sourceFormat: 'brd',
    encoded,
    contourSource: 'unknown',
    outlineSource: 'unknown',
    sourceUnits: 'boardview-internal',
    coordinateSystem: { originalUnit: 'boardview-internal', normalizedUnit: 'mil', factorToMil: 1, coordinatesAreNormalized: true },
    contourLabel: 'Contorno não informado',
    contour: [],
    components: [],
    nets: [],
    warnings,
    geometry: { primitives: { lines: 0, arcs: 0, polygons: 0, holes: 0, vias: 0, keepouts: 0, other: 0 }, notes: [] },
  }
}

function parseClassic(lines, fileName, encoded) {
  let section = ''
  let counts = { format: null, parts: null, pins: null, nails: null }
  const format = []
  const parts = []
  const pins = []
  const nails = []
  let recognized = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const lower = line.toLowerCase()

    if (lower === 'str_length:' || lower === 'str_length') { section = 'strings'; recognized = true; continue }
    if (lower === 'var_data:' || lower === 'var_data') { section = 'var_data'; recognized = true; continue }
    if (lower === 'format:' || lower === 'format') { section = 'format'; recognized = true; continue }
    if (lower === 'parts:' || lower === 'parts' || lower === 'pins1:') { section = 'parts'; recognized = true; continue }
    if (lower === 'pins:' || lower === 'pins2:') { section = 'pins'; recognized = true; continue }
    if (lower === 'nails:') { section = 'nails'; recognized = true; continue }

    const values = tokens(line)
    if (!values.length) continue

    if (section === 'var_data' && counts.format === null) {
      const parsed = values.slice(0, 4).map(numeric)
      if (parsed.every(value => value !== null && value >= 0)) {
        counts = { format: parsed[0], parts: parsed[1], pins: parsed[2], nails: parsed[3] }
      }
      continue
    }

    if (section === 'format' && (counts.format === null || format.length < counts.format)) {
      const x = numeric(values[0]); const y = numeric(values[1])
      if (x !== null && y !== null) format.push({ x, y })
      continue
    }

    if (section === 'parts' && (counts.parts === null || parts.length < counts.parts)) {
      if (values.length < 3) continue
      const code = numeric(values[1]); const endOfPins = numeric(values[2])
      if (code === null || endOfPins === null) continue
      parts.push({
        designator: values[0],
        code,
        endOfPins,
        side: layerFromCode(code),
        type: typeFromCode(code),
      })
      continue
    }

    if (section === 'pins' && (counts.pins === null || pins.length < counts.pins)) {
      if (values.length < 4) continue
      const x = numeric(values[0]); const y = numeric(values[1]); const probe = numeric(values[2]); const part = numeric(values[3])
      if (x === null || y === null || part === null) continue
      pins.push({ x, y, probe: probe ?? -1, part, netName: values[4] || '' })
      continue
    }

    if (section === 'nails' && (counts.nails === null || nails.length < counts.nails)) {
      if (values.length < 5) continue
      const probe = numeric(values[0]); const x = numeric(values[1]); const y = numeric(values[2]); const sideCode = numeric(values[3])
      if (probe === null || x === null || y === null || sideCode === null) continue
      nails.push({ probe, x, y, side: sideCode === 1 ? 'top' : 'bottom', netName: values[4] || '' })
    }
  }

  if (!recognized) return null

  if (!parts.length) throw new Error('O arquivo .brd foi reconhecido, mas o bloco Parts não contém componentes válidos.')
  if (!pins.length) throw new Error('O arquivo .brd foi reconhecido, mas o bloco Pins não contém pinos válidos.')

  const nailsByProbe = new Map(nails.map(nail => [String(nail.probe), nail.netName]).filter(([, net]) => net))
  for (const pin of pins) if (!pin.netName) pin.netName = nailsByProbe.get(String(pin.probe)) || ''

  const pinsByPart = new Map()
  for (const pin of pins) {
    if (!pinsByPart.has(pin.part)) pinsByPart.set(pin.part, [])
    pinsByPart.get(pin.part).push(pin)
  }

  const components = parts.map((part, index) => {
    const sourcePins = pinsByPart.get(index + 1) || []
    const componentPins = sourcePins.map((pin, pinIndex) => ({
      number: String(pinIndex + 1),
      x: pin.x,
      y: pin.y,
      netName: pin.netName || 'UNCONNECTED',
      probe: pin.probe,
      side: part.side,
    }))
    const x = componentPins.length ? componentPins.reduce((sum, pin) => sum + pin.x, 0) / componentPins.length : 0
    const y = componentPins.length ? componentPins.reduce((sum, pin) => sum + pin.y, 0) / componentPins.length : 0
    return {
      designator: part.designator,
      value: '',
      package: part.type === 'smd' ? 'SMD' : 'TH',
      side: part.side,
      x,
      y,
      rotation: 0,
      pins: componentPins,
    }
  })

  return finishBoard(emptyBoard(fileName, encoded), components, format, {
    counts,
    warnings: [
      ...(!format.length ? ['O arquivo não informou um contorno utilizável.'] : []),
      ...(components.some(component => !component.pins.length) ? ['Há componentes sem pinos posicionados; eles foram mantidos no mapa.'] : []),
    ],
  })
}

const sideFromCode = code => code === 1 ? 'top' : code === 2 ? 'bottom' : 'both'

function parseBrd2(lines, fileName) {
  let section = ''
  let counts = { format: null, nets: null, parts: null, pins: null, nails: null }
  let maxY = 0
  let recognized = false
  const contour = []
  const netsById = new Map()
  const parts = []
  const pins = []
  const testPoints = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const values = tokens(line)
    if (!values.length) continue
    const upper = line.toUpperCase()

    if (upper.startsWith('BRDOUT:')) {
      const header = tokens(line.slice(line.indexOf(':') + 1)).map(numeric)
      if (header.length >= 3 && header[0] !== null && header[1] !== null && header[2] !== null) {
        counts.format = header[0]; maxY = header[2]
        recognized = true; section = 'format'
      }
      continue
    }
    if (upper.startsWith('NETS:')) {
      const count = numeric(tokens(line.slice(line.indexOf(':') + 1))[0])
      if (count !== null) { counts.nets = count; recognized = true; section = 'nets' }
      continue
    }
    if (upper.startsWith('PARTS:')) {
      const count = numeric(tokens(line.slice(line.indexOf(':') + 1))[0])
      if (count !== null) { counts.parts = count; recognized = true; section = 'parts' }
      continue
    }
    if (upper.startsWith('PINS:')) {
      const count = numeric(tokens(line.slice(line.indexOf(':') + 1))[0])
      if (count !== null) { counts.pins = count; recognized = true; section = 'pins' }
      continue
    }
    if (upper.startsWith('NAILS:')) {
      const count = numeric(tokens(line.slice(line.indexOf(':') + 1))[0])
      if (count !== null) { counts.nails = count; recognized = true; section = 'nails' }
      continue
    }

    if (section === 'format' && (counts.format === null || contour.length < counts.format)) {
      const x = numeric(values[0]); const y = numeric(values[1])
      if (x !== null && y !== null) contour.push({ x, y })
      continue
    }
    if (section === 'nets' && (counts.nets === null || netsById.size < counts.nets)) {
      const id = numeric(values[0]); const name = values[1]
      if (id !== null && name !== undefined) netsById.set(id, name || 'UNCONNECTED')
      continue
    }
    if (section === 'parts' && (counts.parts === null || parts.length < counts.parts)) {
      if (values.length < 7) continue
      const x1 = numeric(values[1]); const y1 = numeric(values[2]); const x2 = numeric(values[3]); const y2 = numeric(values[4]); const pinStart = numeric(values[5]); const sideCode = numeric(values[6])
      if (x1 === null || y1 === null || x2 === null || y2 === null || pinStart === null || sideCode === null) continue
      parts.push({ designator: values[0], x1, y1, x2, y2, pinStart, side: sideFromCode(sideCode) })
      continue
    }
    if (section === 'pins' && (counts.pins === null || pins.length < counts.pins)) {
      if (values.length < 4) continue
      const x = numeric(values[0]); const y = numeric(values[1]); const netId = numeric(values[2]); const sideCode = numeric(values[3])
      if (x === null || y === null || netId === null || sideCode === null) continue
      pins.push({ x, y: sideCode === 1 ? y : maxY - y, netName: netsById.get(netId) || 'UNCONNECTED', side: sideFromCode(sideCode) })
      continue
    }
    if (section === 'nails' && (counts.nails === null || testPoints.length < counts.nails)) {
      if (values.length < 5) continue
      const probe = numeric(values[0]); const x = numeric(values[1]); const y = numeric(values[2]); const netId = numeric(values[3]); const sideCode = numeric(values[4])
      if (probe === null || x === null || y === null || netId === null || sideCode === null) continue
      testPoints.push({ designator: `TP${testPoints.length + 1}`, probe, x, y: sideCode === 1 ? y : maxY - y, netName: netsById.get(netId) || 'UNCONNECTED', side: sideFromCode(sideCode) })
    }
  }

  if (!recognized) return null
  if (!parts.length) throw new Error('BRD2 reconhecido, mas o bloco PARTS não contém componentes válidos.')
  if (!pins.length) throw new Error('BRD2 reconhecido, mas o bloco PINS não contém pinos válidos.')

  const components = parts.map((part, index) => {
    const start = Math.max(0, part.pinStart)
    const end = index + 1 < parts.length ? Math.max(start, parts[index + 1].pinStart) : pins.length
    const sourcePins = pins.slice(start, end)
    const sameSidePin = part.side === 'top' ? sourcePins.some(pin => pin.side === 'top') : part.side === 'bottom' ? sourcePins.some(pin => pin.side === 'bottom') : true
    const throughHole = part.side !== 'both' && !sameSidePin
    const componentSide = throughHole ? 'both' : part.side
    const componentPins = sourcePins.map((pin, pinIndex) => ({
      number: String(pinIndex + 1), x: pin.x, y: pin.y, netName: pin.netName, side: pin.side,
    }))
    return {
      designator: part.designator,
      value: '',
      package: throughHole ? 'TH' : 'SMD',
      side: componentSide,
      x: (part.x1 + part.x2) / 2,
      y: (part.y1 + part.y2) / 2,
      rotation: 0,
      pins: componentPins,
    }
  })

  return finishBoard({
    ...emptyBoard(fileName, false),
    sourceFormat: 'brd2',
    sourceUnits: 'boardview-internal (mil)',
    coordinateSystem: { originalUnit: 'mil', normalizedUnit: 'mil', factorToMil: 1, coordinatesAreNormalized: true },
    geometry: { primitives: { lines: contour.length, arcs: 0, polygons: contour.length >= 3 ? 1 : 0, holes: 0, vias: testPoints.length, keepouts: 0, other: 0 }, notes: ['BRDOUT foi usado como contorno explícito.'] },
    testPoints,
  }, components, contour, {
    counts,
    warnings: ['Variante BRD2 detectada; valor e encapsulamento detalhados não são fornecidos por este formato.'],
  })
}

function parseTagged(lines, fileName) {
  const components = []
  const pins = []
  const contour = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const values = tokens(line)
    const kind = values[0]?.toLowerCase()
    if (['component', 'part'].includes(kind) && values.length >= 2 && !/^parts?$/i.test(values[1])) {
      const [, designator, value = '', packageName = '', sideValue = 'top', xValue, yValue, rotationValue = '0'] = values
      const x = numeric(xValue); const y = numeric(yValue)
      if (x === null || y === null) continue
      components.push({ designator, value, package: packageName, side: /bottom|bot|b/i.test(sideValue) ? 'bottom' : 'top', x, y, rotation: numeric(rotationValue) ?? 0, pins: [] })
      continue
    }
    if (kind === 'pin' && values.length >= 6) {
      const [, designator, number, xValue, yValue, netName, sideValue = 'top'] = values
      const x = numeric(xValue); const y = numeric(yValue)
      if (x === null || y === null) continue
      pins.push({ designator, number, x, y, netName: netName || 'UNCONNECTED', side: /bottom|bot|b/i.test(sideValue) ? 'bottom' : 'top' })
      continue
    }
    if (['outline', 'point', 'format'].includes(kind) && values.length >= 3) {
      const x = numeric(values[1]); const y = numeric(values[2])
      if (x !== null && y !== null) contour.push({ x, y })
    }
  }

  if (!components.length || !pins.length) return null
  for (const pin of pins) {
    const component = components.find(item => item.designator === pin.designator)
    if (component) component.pins.push({ number: String(pin.number), x: pin.x, y: pin.y, netName: pin.netName, side: pin.side })
  }
  return finishBoard(emptyBoard(fileName, false, ['Variante textual etiquetada detectada; confirme os dados contra o arquivo original.']), components, contour, {})
}

export function finishBoard(board, components, contour, extra = {}) {
  const normalizedContour = Array.isArray(contour) && contour.length > 2 && contour[0].x === contour.at(-1).x && contour[0].y === contour.at(-1).y ? contour.slice(0, -1) : (contour || [])
  return normalizeBoard({ ...board, ...extra }, components, normalizedContour, extra)
}

export function parseBrd(content, options = {}) {
  const { text, encoded } = decodeBoardContent(content)
  if (!text.trim()) throw new Error('O arquivo .brd está vazio.')
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const brd2 = parseBrd2(lines, options.fileName)
  if (brd2) return brd2
  const classic = parseClassic(lines, options.fileName, encoded)
  if (classic) return classic
  const tagged = parseTagged(lines, options.fileName)
  if (tagged) return tagged
  throw new Error('Formato .brd não suportado ou corrompido. O arquivo não apresentou os blocos Parts/Pins esperados pelo OpenBoardView.')
}
