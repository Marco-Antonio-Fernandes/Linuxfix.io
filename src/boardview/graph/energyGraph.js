import { classifyComponent, classifyNetName, detectSourceNets, normalizeEnergyRules } from '../rules/energyRules.js'

const componentNode = designator => `c:${designator}`
const netNode = name => `n:${name}`

const addEdge = (adjacency, from, to, meta = {}) => {
  if (!adjacency.has(from)) adjacency.set(from, [])
  adjacency.get(from).push({ node: to, ...meta })
}

const unique = values => [...new Set(values.filter(Boolean))]

function transitionsFor(component, classification) {
  const pinNets = component.pins.map(pin => ({ pin, netName: pin.netName || 'UNCONNECTED' })).filter(item => item.netName !== 'UNCONNECTED')
  const links = classification.internalLinks
  if (classification.passage === 'linked' && links.length) {
    return links.flatMap(link => {
      const input = pinNets.find(item => String(item.pin.number) === String(link.inputPin))
      const output = pinNets.find(item => String(item.pin.number) === String(link.outputPin))
      return input && output && input.netName !== output.netName ? [{ from: input.netName, to: output.netName, inputPin: input.pin.number, outputPin: output.pin.number }] : []
    })
  }
  if (!['direct', 'conditional'].includes(classification.passage)) return []
  const direction = classification.manualDirection
  if (direction === 'forward' || direction === 'reverse') {
    const ordered = direction === 'reverse' ? [...pinNets].reverse() : pinNets
    const input = ordered[0]
    return input ? ordered.slice(1).filter(item => item.netName !== input.netName).map(item => ({ from: input.netName, to: item.netName, inputPin: input.pin.number, outputPin: item.pin.number })) : []
  }
  return pinNets.flatMap(input => pinNets.filter(output => output.netName !== input.netName).map(output => ({ from: input.netName, to: output.netName, inputPin: input.pin.number, outputPin: output.pin.number })))
}

export function buildEnergyGraph(board, annotations = {}, rules = {}) {
  const normalizedRules = normalizeEnergyRules(rules)
  const classifications = new Map((board?.components || []).map(component => [component.designator, classifyComponent(component, annotations, normalizedRules)]))
  const componentsByName = new Map((board?.components || []).map(component => [component.designator, component]))
  const netsByName = new Map((board?.nets || []).map(net => [net.name, net]))
  const adjacency = new Map()
  const reverseAdjacency = new Map()
  const transitions = []
  const ensureNode = node => { if (!adjacency.has(node)) adjacency.set(node, []); if (!reverseAdjacency.has(node)) reverseAdjacency.set(node, []) }
  for (const net of board?.nets || []) ensureNode(netNode(net.name))
  for (const component of board?.components || []) {
    const cNode = componentNode(component.designator)
    ensureNode(cNode)
    for (const pin of component.pins) {
      const nNode = netNode(pin.netName || 'UNCONNECTED')
      ensureNode(nNode)
      addEdge(adjacency, nNode, cNode, { type: 'pin', component: component.designator, pin: pin.number })
      addEdge(reverseAdjacency, cNode, nNode, { type: 'pin', component: component.designator, pin: pin.number })
    }
    for (const transition of transitionsFor(component, classifications.get(component.designator))) {
      const fromNode = netNode(transition.from); const toNode = netNode(transition.to)
      transitions.push({ ...transition, component: component.designator })
      addEdge(adjacency, cNode, toNode, { type: 'component', component: component.designator, ...transition })
      addEdge(reverseAdjacency, toNode, cNode, { type: 'component', component: component.designator, ...transition })
      addEdge(reverseAdjacency, cNode, fromNode, { type: 'upstream', component: component.designator, ...transition })
    }
  }
  const sourceNets = detectSourceNets(board, normalizedRules, annotations)
  const distances = new Map()
  const predecessors = new Map()
  const queue = []
  for (const source of sourceNets) {
    const node = netNode(source.name)
    if (!adjacency.has(node)) continue
    if (!distances.has(node)) { distances.set(node, 0); predecessors.set(node, new Set()); queue.push(node) }
  }
  while (queue.length) {
    const current = queue.shift()
    const currentDistance = distances.get(current)
    for (const edge of adjacency.get(current) || []) {
      const nextDistance = currentDistance + 1
      if (!distances.has(edge.node)) {
        distances.set(edge.node, nextDistance); predecessors.set(edge.node, new Set([current])); queue.push(edge.node)
      } else if (distances.get(edge.node) === nextDistance) predecessors.get(edge.node).add(current)
    }
  }
  const componentDistances = new Map(); const netDistances = new Map()
  for (const [node, distance] of distances) (node.startsWith('c:') ? componentDistances : netDistances).set(node.slice(2), distance)
  return { board, rules: normalizedRules, classifications, componentsByName, netsByName, adjacency, reverseAdjacency, transitions, sourceNets, distances, predecessors, componentDistances, netDistances }
}

const nodeForTarget = target => target?.netName ? netNode(target.netName) : target?.componentDesignator ? componentNode(target.componentDesignator) : null

function ancestors(graph, startNode, maxDepth = 12) {
  if (!startNode || !graph.distances.has(startNode)) return new Set(startNode ? [startNode] : [])
  const result = new Set([startNode]); const queue = [{ node: startNode, depth: 0 }]
  while (queue.length) {
    const { node, depth } = queue.shift()
    if (depth >= maxDepth) continue
    for (const previous of graph.predecessors.get(node) || []) {
      if (graph.distances.get(previous) >= graph.distances.get(node)) continue
      if (!result.has(previous)) { result.add(previous); queue.push({ node: previous, depth: depth + 1 }) }
    }
  }
  return result
}

export function traceEnergy(graph, annotations = {}, options = {}) {
  const depth = Math.max(1, Math.min(100, Number(options.depth || annotations.traceDepth || 12)))
  const noPower = (annotations.measurements || []).filter(measurement => measurement.status === 'no-power')
  const good = (annotations.measurements || []).filter(measurement => measurement.status === 'ok' || measurement.status === 'voltage' && Number(measurement.volts) > 0)
  const redNodes = new Set(); const probablyOkNodes = new Set(); const targetNodes = []
  for (const measurement of noPower) {
    const node = nodeForTarget(measurement)
    if (!node) continue
    targetNodes.push(node)
    for (const ancestor of ancestors(graph, node, depth)) redNodes.add(ancestor)
  }
  for (const measurement of good) {
    const node = nodeForTarget(measurement)
    for (const ancestor of ancestors(graph, node, depth)) probablyOkNodes.add(ancestor)
  }
  for (const node of probablyOkNodes) redNodes.delete(node)
  const redComponents = new Set([...redNodes].filter(node => node.startsWith('c:')).map(node => node.slice(2)))
  const redNets = new Set([...redNodes].filter(node => node.startsWith('n:')).map(node => node.slice(2)))
  for (const source of graph.sourceNets) {
    if (!redNets.has(source.name)) continue
    for (const pin of source.pins || []) if (graph.classifications.get(pin.component)?.kind === 'connector') redComponents.add(pin.component)
  }
  const probablyOkComponents = new Set([...probablyOkNodes].filter(node => node.startsWith('c:')).map(node => node.slice(2)))
  const probablyOkNets = new Set([...probablyOkNodes].filter(node => node.startsWith('n:')).map(node => node.slice(2)))
  const orangeComponents = new Set()
  for (const netName of redNets) {
    const net = graph.netsByName.get(netName)
    for (const pin of net?.pins || []) if (!redComponents.has(pin.component) && !probablyOkComponents.has(pin.component)) orangeComponents.add(pin.component)
  }
  const targetDistance = new Map(); const targetQueue = targetNodes.map(node => ({ node, distance: 0 }))
  while (targetQueue.length) {
    const current = targetQueue.shift()
    if (targetDistance.has(current.node) && targetDistance.get(current.node) <= current.distance) continue
    targetDistance.set(current.node, current.distance)
    for (const previous of graph.predecessors.get(current.node) || []) targetQueue.push({ node: previous, distance: current.distance + 1 })
  }
  const testOrder = [...new Set([...redComponents, ...orangeComponents])].map(designator => {
    const node = componentNode(designator)
    const component = graph.componentsByName.get(designator)
    const sameNetDistance = Math.min(...(component?.pins || []).map(pin => (targetDistance.get(netNode(pin.netName)) ?? depth) + 1))
    return { designator, reason: redComponents.has(designator) ? 'Trecho de energia' : 'Possível curto na mesma net', distance: targetDistance.get(node) ?? sameNetDistance ?? depth + 1, state: annotations.componentStates?.[designator] || '' }
  }).sort((left, right) => left.distance - right.distance || left.designator.localeCompare(right.designator, 'pt-BR', { numeric: true }))
  return { depth, targetNodes, redComponents, redNets, orangeComponents, probablyOkComponents, probablyOkNets, redNodes, probablyOkNodes, testOrder, active: noPower.length > 0 }
}

export { componentNode, netNode, ancestors, transitionsFor, classifyNetName }
