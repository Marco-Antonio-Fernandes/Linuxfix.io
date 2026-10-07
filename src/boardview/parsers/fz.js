import { emptyBoard, finishBoard } from './brd.js'

const number = value => {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

const fields = line => String(line || '').split('!').slice(1)

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('Este ambiente não oferece descompressão zlib para arquivos .fz.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function zlibAt(bytes, offset) {
  return bytes[offset] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[offset + 1])
}

function descriptorLength(bytes) {
  const offset = bytes.length - 4
  if (offset < 0) return 0
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

async function inflateContentCandidates(bytes) {
  const declared = descriptorLength(bytes)
  const end = bytes.length - declared
  const candidates = [bytes.slice(4, Math.max(4, end)), bytes.slice(4, Math.min(bytes.length, end + 4))]
  let lastError = null
  for (const candidate of candidates) {
    try {
      return await inflate(candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Conteúdo zlib do FZ inválido.')
}

export async function parseFz(content, options = {}) {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
  if (bytes.length < 8) throw new Error('O arquivo .fz está vazio ou incompleto.')
  if (!zlibAt(bytes, 4)) {
    throw new Error('Este .fz está criptografado. O formato usa RC6 e exige a chave do boardview; sem essa chave o arquivo não pode ser interpretado com segurança.')
  }

  const contentBytes = await inflateContentCandidates(bytes)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(contentBytes).replace(/\r/g, '')
  const lines = text.split('\n')
  const parts = []
  const partsByName = new Map()
  const testPoints = []
  let section = ''
  let multiplier = 1

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line === 'UNIT:millimeters') { multiplier = 39.37007874015748; continue }
    if (line.startsWith('A!')) {
      const name = line.slice(2).split('!')[0]
      section = name === 'REFDES' ? 'parts' : name === 'NET_NAME' ? 'pins' : name === 'TESTVIA' ? 'nails' : ''
      continue
    }
    if (!line.startsWith('S!') && !line.startsWith('Y!')) continue
    const values = fields(line)
    if (section === 'parts' && line.startsWith('S!') && values.length >= 5) {
      const component = {
        designator: values[0],
        value: '',
        package: values[2] || 'SMD',
        side: /^yes$/i.test(values[3]) ? 'bottom' : 'top',
        x: 0,
        y: 0,
        rotation: number(values[4]) || 0,
        pins: [],
      }
      parts.push(component)
      partsByName.set(component.designator, component)
      continue
    }
    if (section === 'pins' && line.startsWith('S!') && values.length >= 7) {
      const component = partsByName.get(values[1])
      const x = number(values[4]); const y = number(values[5])
      if (!component || x === null || y === null) continue
      component.pins.push({ number: values[2] && values[2] !== '0' ? values[2] : values[3], x: x * multiplier, y: y * multiplier, netName: values[0] || 'UNCONNECTED', side: component.side, probe: number(values[6]) })
      continue
    }
    if (section === 'nails' && line.startsWith('Y!') && values.length >= 7) {
      const x = number(values[4]); const y = number(values[5])
      if (x === null || y === null) continue
      testPoints.push({ designator: `TP${testPoints.length + 1}`, x: x * multiplier, y: y * multiplier, netName: values[0] || 'UNCONNECTED', side: values[6] === 'T' ? 'top' : 'bottom' })
    }
  }

  const usableParts = parts.filter(component => component.pins.length)
  if (!usableParts.length) throw new Error('FZ descompactado, mas sem blocos REFDES/NET_NAME com pinos válidos.')
  const points = usableParts.flatMap(component => component.pins)
  const xs = points.map(point => point.x); const ys = points.map(point => point.y)
  const minX = Math.min(...xs) - 20; const maxX = Math.max(...xs) + 20
  const minY = Math.min(...ys) - 20; const maxY = Math.max(...ys) + 20
  for (const component of usableParts) {
    component.x = component.pins.reduce((sum, pin) => sum + pin.x, 0) / component.pins.length
    component.y = component.pins.reduce((sum, pin) => sum + pin.y, 0) / component.pins.length
  }
  return finishBoard({ ...emptyBoard(options.fileName, false), sourceFormat: 'fz-zlib', testPoints, outlineSource: 'estimated', contourSource: 'estimated', coordinateSystem: { originalUnit: 'mil', normalizedUnit: 'mil', factorToMil: 1, coordinatesAreNormalized: true } }, usableParts, [], {
    outlineSource: 'estimated',
    warnings: ['FZ zlib legível detectado. O contorno foi estimado pelos pinos, como no OpenBoardView.'],
  })
}
