import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnergyGraph, traceEnergy } from '../src/boardview/graph/energyGraph.js'

const component = (designator, pins, value = '') => ({ designator, value, package: '', side: 'top', x: 0, y: 0, rotation: 0, pins: pins.map((netName, index) => ({ number: String(index + 1), x: index, y: 0, netName })) })
const makeBoard = () => {
  const components = [
    component('J1', ['DCIN']),
    component('F1', ['DCIN', 'VIN']),
    component('L1', ['VIN', 'SW_IN']),
    component('Q5', ['SW_IN', '19V']),
    component('U7', ['19V', '3V3']),
    component('C10', ['3V3']),
    component('C11', ['3V3']),
    component('C12', ['3V3']),
  ]
  return {
    model: 'fixture', revision: 'A', components,
    nets: [...new Set(components.flatMap(item => item.pins.map(pin => pin.netName)))].map(name => ({ name, pins: components.flatMap(item => item.pins.filter(pin => pin.netName === name).map(pin => ({ component: item.designator, pin: pin.number, x: pin.x, y: pin.y }))) })),
  }
}

test('rastreia energia pelo grafo e separa capacitores da mesma net como possível curto', () => {
  const board = makeBoard()
  const annotations = {
    internalLinks: [{ component: 'U7', inputPin: '1', outputPin: '2' }],
    sourceOverrides: { VIN: 'not-source' },
    measurements: [{ id: 'm1', componentDesignator: 'C10', status: 'no-power', date: '2026-01-01' }],
  }
  const graph = buildEnergyGraph(board, annotations)
  const trace = traceEnergy(graph, annotations, { depth: 20 })
  assert.deepEqual([...trace.redComponents].sort(), ['C10', 'F1', 'J1', 'L1', 'Q5', 'U7'].sort())
  assert.deepEqual([...trace.orangeComponents].sort(), ['C11', 'C12'])
  assert.ok(trace.redNets.has('19V'))
  assert.ok(trace.redNets.has('3V3'))
})

test('medição boa na net anterior remove a montante e marca como provavelmente OK', () => {
  const board = makeBoard()
  const annotations = {
    internalLinks: [{ component: 'U7', inputPin: '1', outputPin: '2' }],
    sourceOverrides: { VIN: 'not-source' },
    measurements: [
      { id: 'm1', componentDesignator: 'C10', status: 'no-power', date: '2026-01-01' },
      { id: 'm2', netName: '19V', status: 'voltage', volts: 19, date: '2026-01-01' },
    ],
  }
  const trace = traceEnergy(buildEnergyGraph(board, annotations), annotations, { depth: 20 })
  assert.deepEqual([...trace.redComponents].sort(), ['C10', 'U7'].sort())
  assert.deepEqual([...trace.orangeComponents].sort(), ['C11', 'C12'])
  assert.ok(trace.probablyOkComponents.has('F1'))
  assert.ok(trace.probablyOkComponents.has('Q5'))
  assert.ok(!trace.redComponents.has('Q5'))
})
