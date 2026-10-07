import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { parseBrd } from '../src/boardview/parsers/brd.js'
import { parseCad } from '../src/boardview/parsers/cad.js'
import { parseAsc } from '../src/boardview/parsers/asc.js'
import { parseBdv } from '../src/boardview/parsers/bdv.js'
import { parseFz } from '../src/boardview/parsers/fz.js'

test('interpreta BRD clássico com contorno, componentes, pinos e nets', () => {
  const source = `#e2c(
str_length:
1 1 1 1
var_data:
4 2 5 0
Format:
0 0
1000 0
1000 600
0 600
Parts:
F1 1 2
U7 4 5
Pins:
100 100 1 1 DCIN
250 100 2 1 VIN
500 300 3 2 VIN
650 300 4 2 V3_3
500 400 5 2 GND
`
  const board = parseBrd(new TextEncoder().encode(source), { fileName: 'teste.brd' })
  assert.equal(board.components.length, 2)
  assert.equal(board.stats.pins, 5)
  assert.equal(board.nets.length, 4)
  assert.deepEqual(board.contour[2], { x: 1000, y: 600 })
  assert.equal(board.components[0].designator, 'F1')
  assert.equal(board.components[1].pins[1].netName, 'V3_3')
})

test('recusa BRD vazio ou sem blocos utilizáveis com erro claro', () => {
  assert.throws(() => parseBrd('arquivo sem estrutura', { fileName: 'ruim.brd' }), /Formato \.brd não suportado ou corrompido/)
  assert.throws(() => parseBrd('', { fileName: 'vazio.brd' }), /arquivo \.brd está vazio/)
})

test('interpreta a variante BRD2 com BRDOUT, NETS, PARTS, PINS e NAILS', () => {
  const source = `BRDOUT: 4 1000 600
0 0
1000 0
1000 600
0 600
NETS: 3
1 DCIN
2 VIN
3 GND
PARTS: 2
F1 100 100 180 140 0 1
U7 500 300 650 420 2 1
PINS: 4
110 110 1 1
160 120 2 1
520 320 2 1
560 390 3 1
NAILS: 1
7 110 110 1 1
`
  const board = parseBrd(source, { fileName: 'brd2.brd' })
  assert.equal(board.sourceFormat, 'brd2')
  assert.equal(board.components.length, 2)
  assert.equal(board.stats.pins, 4)
  assert.equal(board.testPoints.length, 1)
  assert.equal(board.components[1].pins[0].netName, 'VIN')
  assert.equal(board.nets.find(net => net.name === 'DCIN').pins.length, 2)
})

test('interpreta a variante CAD neutral file com COMP, C_PIN, NET e N_VIA', () => {
  const source = `###Panel Added Part Information
BOARD TestBoard OFFSET x:0.0 y:0.0 ORIENTATION 0
B_UNITS Inches
NET /VIN
N_VIA 1.0 2.0 via10 1 12
COMP Q5 1234 mosfet sot23 1.0 2.0 1 90
C_PIN Q5-1 0.9 2.0 12 1 90 s010x020 VIN
C_PIN Q5-2 1.1 2.0 12 1 90 s010x020 GROUND
COMP C10 5678 capacitor c0402 3.0 4.0 2 0
C_PIN C10-1 3.0 4.0 12 1 0 c010x020 V3_3
`
  const board = parseCad(source, { fileName: 'teste.cad' })
  assert.equal(board.sourceFormat, 'cad-neutral')
  assert.equal(board.components.length, 2)
  assert.equal(board.stats.pins, 3)
  assert.equal(board.stats.testPoints, 1)
  assert.equal(board.components[0].value, '1234')
  assert.equal(board.components[0].pins[0].netName, 'VIN')
})

test('estima o contorno CAD quando o arquivo só fornece furos físicos e pads', () => {
  const source = `###Panel Added Part Information
BOARD TestBoard
B_UNITS Inches
HOLE NPTH 0 0 0.1
HOLE NPTH 10 5 0.1
NET /VIN
N_VIA 1 1 via10 1 12
COMP Q5 1234 mosfet sot23 2 2 1 90
C_PIN Q5-1 2 2 12 1 90 s010x020 VIN
`
  const board = parseCad(source, { fileName: 'estimado.cad' })
  assert.equal(board.contourSource, 'estimated')
  assert.equal(board.contourLabel, 'Contorno estimado')
  assert.deepEqual(board.contourEvidence, { holes: 2, vias: 1, pins: 1 })
  assert.ok(board.contour[0].x < 0)
  assert.ok(board.contour[2].x > 10 * 1000)
  assert.match(board.warnings.at(-1), /Contorno estimado/) 
})

test('interpreta ASC concatenado com contorno, Part/pinos e nail', () => {
  const source = `<<format.asc>>
0 0
10 0
10 5
0 5
<<pins.asc>>
Part R1 (T)
1 1 1.0 1.0 1 VIN 10
2 2 2.0 1.0 1 GND 11
<<nails.asc>>
? 12 1.0 1.0 0 1 (T) 1 VIN
`
  const board = parseAsc(source, { fileName: 'sample.asc' })
  assert.equal(board.sourceFormat, 'asc')
  assert.equal(board.stats.components, 1)
  assert.equal(board.stats.pins, 2)
  assert.equal(board.stats.testPoints, 1)
  assert.equal(board.contour.length, 4)
})

test('interpreta BDV textual já decodificado com os blocos do OpenBoardView', () => {
  const source = `<<format.asc>>
0 0
10 0
10 5
0 5
<<pins.asc>>
Part U7 (B)
1 A1 1.0 1.0 2 V3_3 10
<<nails.asc>>
Y!V3_3!U7!1!A1!1.0!1.0!B!0.5!
`
  const board = parseBdv(source, { fileName: 'sample.bdv' })
  assert.equal(board.sourceFormat, 'bdv')
  assert.equal(board.components[0].side, 'bottom')
  assert.equal(board.components[0].pins[0].netName, 'V3_3')
  assert.equal(board.stats.testPoints, 1)
})

test('interpreta FZ zlib legível e recusa FZ criptografado sem chave', async () => {
  const content = Buffer.from(`A!REFDES!\nS!R1!x!0402!NO!0!\nA!NET_NAME!\nS!VIN!R1!1!1!1.0!2.0!0!1!\n`)
  const description = Buffer.from('header\n')
  const compressedContent = deflateSync(content)
  const compressedDescription = deflateSync(description)
  const descriptorLength = compressedDescription.length + 4
  const suffix = Buffer.from([(descriptorLength >>> 24) & 255, (descriptorLength >>> 16) & 255, (descriptorLength >>> 8) & 255, descriptorLength & 255])
  const source = Buffer.concat([Buffer.from([0, 0, 0, 0]), compressedContent, compressedDescription, suffix])
  const board = await parseFz(source, { fileName: 'sample.fz' })
  assert.equal(board.sourceFormat, 'fz-zlib')
  assert.equal(board.stats.components, 1)
  assert.equal(board.components[0].pins[0].netName, 'VIN')
  await assert.rejects(() => parseFz(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { fileName: 'locked.fz' }), /criptografado.*RC6.*chave/i)
})
