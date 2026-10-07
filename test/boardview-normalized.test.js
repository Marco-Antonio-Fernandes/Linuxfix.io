import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBrd } from '../src/boardview/parsers/brd.js'
import { parseCad } from '../src/boardview/parsers/cad.js'

test('parsers BRD e CAD entregam o mesmo contrato normalizado', () => {
  const brd = parseBrd(`BRDOUT: 4 1000 600\n0 0\n1000 0\n1000 600\n0 600\nNETS: 1\n1 GND\nPARTS: 1\nC1 100 100 130 130 0 1\nPINS: 2\n105 110 1 1\n125 120 1 1\n`, { fileName: 'sample.brd' })
  const cad = parseCad(`###Panel Added Part Information\nBOARD Sample\nB_UNITS Inches\nNET /GND\nN_VIA 1 1 via10 1 12\nCOMP C1 1 capacitor c0402 1 1 1 0\nC_PIN C1-1 1 1 12 1 0 r016x020 GND\n`, { fileName: 'sample.cad' })
  for (const board of [brd, cad]) {
    assert.ok(Array.isArray(board.boardOutline))
    assert.ok(Array.isArray(board.components))
    assert.ok(Array.isArray(board.pads))
    assert.ok(Array.isArray(board.nets))
    assert.equal(board.units, 'mil')
    assert.ok(board.debug?.counts?.pins >= 1)
    assert.ok(board.components[0].componentType)
    assert.ok(board.components[0].dataConfidence)
  }
  assert.equal(brd.outlineSource, 'original')
  assert.equal(cad.outlineSource, 'estimated')
  assert.equal(cad.debug.originalUnit, 'Inches')
  assert.equal(cad.debug.conversionFactor, 1000)
})
