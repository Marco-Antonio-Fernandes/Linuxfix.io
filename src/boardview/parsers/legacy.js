import { emptyBoard, finishBoard } from './brd.js'

const number = value => {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

const tokens = line => String(line || '').trim().split(/\s+/).filter(Boolean)
const exclamationFields = line => String(line || '').split('!').slice(1)

const sideFromLocation = value => /\(?t(?:op)?\)?/i.test(String(value || '')) ? 'top' : 'bottom'

const parsePoint = line => {
  const values = tokens(line)
  if (values.length !== 2) return null
  const x = number(values[0]); const y = number(values[1])
  return x === null || y === null ? null : { x, y }
}

const looksLikePin = values => values.length >= 7 && number(values[0]) !== null && number(values[2]) !== null && number(values[3]) !== null

const looksLikeNail = values => values.length >= 8 && number(values[1]) !== null && number(values[2]) !== null && number(values[3]) !== null

/**
 * Parser comum das tabelas usadas por ASC e pelo conteúdo decodificado de BDV.
 * O OpenBoardView lê ASC como um conjunto de format.asc, pins.asc e nails.asc;
 * aqui aceitamos também o pacote concatenado que alguns distribuidores geram.
 */
export function parseLegacyBoardText(text, options = {}) {
  const {
    fileName = 'board.asc',
    sourceFormat = 'asc',
    encoded = false,
    scale = 1000,
    allowSingleFile = true,
  } = options
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const parts = []
  const pins = []
  const nails = []
  const contour = []
  let section = ''
  let sawSection = false
  let currentPart = null

  const setSection = value => {
    section = value
    sawSection = true
    currentPart = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const lower = line.toLowerCase()
    const values = tokens(line)

    if (lower === '<<format.asc>>') { setSection('format'); continue }
    if (lower === '<<pins.asc>>' || lower === '<<parts.asc>>') { setSection('pins'); continue }
    if (lower === '<<nails.asc>>') { setSection('nails'); continue }
    if (/^(?:format|outline)\s*:/i.test(line)) { setSection('format'); continue }
    if (/^(?:pins|parts)\s*:/i.test(line)) { setSection('pins'); continue }
    if (/^nails\s*:/i.test(line)) { setSection('nails'); continue }

    if (/^Part\b/i.test(line)) {
      const partValues = values.slice(1)
      if (partValues.length) {
        const component = {
          designator: partValues[0],
          value: '',
          package: 'SMD',
          side: sideFromLocation(partValues.at(-1)),
          x: 0,
          y: 0,
          rotation: 0,
          pins: [],
        }
        parts.push(component)
        currentPart = component
        section = 'pins'
        sawSection = true
      }
      continue
    }

    if (section === 'format') {
      const point = parsePoint(line)
      if (point) contour.push({ x: point.x * scale, y: point.y * scale })
      continue
    }

    if (section === 'pins' && currentPart) {
      if (line.startsWith('Part')) continue
      if (values.length < 6) continue
      const x = number(values[2]); const y = number(values[3])
      if (x === null || y === null) continue
      const layer = number(values[4])
      const pin = {
        number: String(values[1] || currentPart.pins.length + 1),
        x: x * scale,
        y: y * scale,
        netName: values[5] || 'UNCONNECTED',
        side: layer === 2 ? 'bottom' : currentPart.side,
        probe: number(values[6]),
      }
      currentPart.pins.push(pin)
      continue
    }

    if (section === 'nails') {
      if (line.startsWith('Y!')) {
        const viaValues = exclamationFields(line)
        const x = number(viaValues[4]); const y = number(viaValues[5])
        if (x !== null && y !== null) {
          nails.push({ designator: `TP${nails.length + 1}`, probe: null, x: x * scale, y: y * scale, side: viaValues[6] === 'T' ? 'top' : 'bottom', netName: viaValues[0] || 'UNCONNECTED' })
        }
        continue
      }
      const nailValues = line.includes('!') ? exclamationFields(line) : values
      if (!looksLikeNail(nailValues)) continue
      const probe = number(nailValues[0]) ?? number(nailValues[1])
      const x = number(nailValues[1]); const y = number(nailValues[2])
      if (x === null || y === null) continue
      const side = sideFromLocation(nailValues.at(-3) || nailValues.at(-2))
      const netName = nailValues.at(-1) || 'UNCONNECTED'
      nails.push({ designator: `TP${nails.length + 1}`, probe, x: x * scale, y: y * scale, side, netName })
      continue
    }

    if (!allowSingleFile || sawSection) continue

    // A standalone pins.asc does not carry the section marker.
    if (/^Part\b/i.test(line)) continue
    if (!currentPart && looksLikePin(values)) {
      continue
    }
  }

  if (!parts.length && allowSingleFile) {
    // Some ASC variants use "Part" records without a section marker but have
    // no useful header. Re-run only the part/pin records through a small state
    // machine; this also keeps malformed headers from becoming components.
    currentPart = null
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      const values = tokens(line)
      if (/^Part\b/i.test(line) && values[1]) {
        currentPart = { designator: values[1], value: '', package: 'SMD', side: sideFromLocation(values.at(-1)), x: 0, y: 0, rotation: 0, pins: [] }
        parts.push(currentPart)
        continue
      }
      if (!currentPart || values.length < 6) continue
      const x = number(values[2]); const y = number(values[3])
      if (x === null || y === null) continue
      currentPart.pins.push({ number: String(values[1] || currentPart.pins.length + 1), x: x * scale, y: y * scale, netName: values[5] || 'UNCONNECTED', side: currentPart.side, probe: number(values[6]) })
    }
  }

  const usableParts = parts.filter(component => component.pins.length > 0)
  if (!usableParts.length) {
    throw new Error(sourceFormat === 'asc'
      ? 'ASC reconhecido, mas não foram encontrados registros Part/pinos. O ASC do OpenBoardView normalmente precisa vir junto com pins.asc e nails.asc.'
      : 'BDV reconhecido, mas não foram encontrados componentes e pinos válidos.')
  }

  const allPoints = usableParts.flatMap(component => component.pins)
  if (contour.length < 3) {
    const xs = allPoints.map(point => point.x); const ys = allPoints.map(point => point.y)
    const minX = Math.min(...xs) - 20; const maxX = Math.max(...xs) + 20
    const minY = Math.min(...ys) - 20; const maxY = Math.max(...ys) + 20
    contour.push({ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY })
  }

  for (const component of usableParts) {
    component.x = component.pins.reduce((sum, pin) => sum + pin.x, 0) / component.pins.length
    component.y = component.pins.reduce((sum, pin) => sum + pin.y, 0) / component.pins.length
  }

  const testPoints = nails
  const board = {
    ...emptyBoard(fileName, encoded),
    sourceFormat,
    units: 'legacy-boardview',
    sourceUnits: 'legacy-boardview',
    coordinateSystem: { originalUnit: 'mil', normalizedUnit: 'mil', factorToMil: 1, coordinatesAreNormalized: true },
    outlineSource: contour.length >= 3 ? 'original' : 'estimated',
    contourSource: contour.length >= 3 ? 'original' : 'estimated',
    testPoints,
  }
  return finishBoard(board, usableParts, contour, {
    outlineSource: contour.length >= 3 ? 'original' : 'estimated',
    warnings: [
      ...(contour.length === 4 && !sawSection ? ['O arquivo não forneceu contorno; ele foi estimado pela extensão dos pinos.'] : []),
      ...(sourceFormat === 'asc' ? ['ASC é um conjunto de arquivos no OpenBoardView; se o fornecedor separou format.asc, pins.asc e nails.asc, importe o arquivo combinado ou forneça os três para uma leitura completa.'] : []),
    ],
  })
}
