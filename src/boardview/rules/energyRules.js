export const defaultEnergyRules = {
  directPrefixes: ['FB', 'L', 'F'],
  lowResistancePrefix: 'R',
  lowResistanceOhms: 1,
  conditionalPrefixes: ['Q', 'D'],
  filterPrefixes: ['C'],
  sourcePatterns: ['DCIN', 'ADAPTER', 'VIN', 'VBUS', 'VBAT'],
  voltagePatterns: [
    { pattern: '(^|[^0-9])3V3([^0-9]|$)', voltage: 3.3 },
    { pattern: '(^|[^0-9])1V8([^0-9]|$)', voltage: 1.8 },
    { pattern: '(^|[^0-9])5V([^0-9]|$)', voltage: 5 },
    { pattern: '(^|[^0-9])12V([^0-9]|$)', voltage: 12 },
    { pattern: '(^|[^0-9])19V([^0-9]|$)', voltage: 19 },
  ],
}

export const normalizeEnergyRules = input => {
  const value = input || {}
  return {
    ...defaultEnergyRules,
    ...value,
    directPrefixes: Array.isArray(value.directPrefixes) ? value.directPrefixes.map(item => String(item).toUpperCase()).filter(Boolean) : defaultEnergyRules.directPrefixes,
    conditionalPrefixes: Array.isArray(value.conditionalPrefixes) ? value.conditionalPrefixes.map(item => String(item).toUpperCase()).filter(Boolean) : defaultEnergyRules.conditionalPrefixes,
    filterPrefixes: Array.isArray(value.filterPrefixes) ? value.filterPrefixes.map(item => String(item).toUpperCase()).filter(Boolean) : defaultEnergyRules.filterPrefixes,
    sourcePatterns: Array.isArray(value.sourcePatterns) ? value.sourcePatterns.map(item => String(item).trim()).filter(Boolean) : defaultEnergyRules.sourcePatterns,
    voltagePatterns: Array.isArray(value.voltagePatterns) ? value.voltagePatterns.map(item => ({ pattern: String(item.pattern || ''), voltage: Number(item.voltage) })).filter(item => item.pattern && Number.isFinite(item.voltage)) : defaultEnergyRules.voltagePatterns,
    lowResistancePrefix: String(value.lowResistancePrefix || defaultEnergyRules.lowResistancePrefix).toUpperCase(),
    lowResistanceOhms: Number.isFinite(Number(value.lowResistanceOhms)) ? Number(value.lowResistanceOhms) : defaultEnergyRules.lowResistanceOhms,
  }
}

const prefixOf = designator => String(designator || '').match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || ''

const valueInOhms = value => {
  const text = String(value || '').trim().toUpperCase().replace(/Ω/g, 'OHM').replace(/,/g, '.')
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([KM]?|OHM|R)?$/)
  if (!match) return null
  const base = Number(match[1])
  if (!Number.isFinite(base)) return null
  if (match[2] === 'K') return base * 1000
  if (match[2] === 'M') return base * 1000000
  return base
}

export function classifyComponent(component, annotations = {}, rules = defaultEnergyRules) {
  const normalizedRules = normalizeEnergyRules(rules)
  const designator = String(component?.designator || '').toUpperCase()
  const prefix = prefixOf(designator)
  const manualFunction = annotations.functions?.[component?.designator]
  const manualDirection = annotations.directions?.[component?.designator] || 'auto'
  let kind = 'unknown'
  let passage = 'none'
  let label = 'Componente'

  if (manualFunction) {
    kind = manualFunction
    label = manualFunction
    if (['fuse', 'inductor', 'switch', 'pass-through'].includes(manualFunction)) passage = 'direct'
    if (['mosfet', 'diode'].includes(manualFunction)) passage = 'conditional'
    if (manualFunction === 'regulator') passage = 'barrier'
  } else if (prefix === normalizedRules.lowResistancePrefix) {
    const resistance = valueInOhms(component?.value)
    kind = 'resistor'
    label = 'Resistor'
    passage = resistance !== null && resistance <= normalizedRules.lowResistanceOhms ? 'direct' : 'none'
  } else if (normalizedRules.directPrefixes.includes(prefix)) {
    kind = prefix === 'F' ? 'fuse' : prefix === 'FB' ? 'ferrite' : 'inductor'
    label = prefix === 'F' ? 'Fusível' : prefix === 'FB' ? 'Ferrite' : 'Indutor'
    passage = 'direct'
  } else if (normalizedRules.conditionalPrefixes.includes(prefix)) {
    kind = prefix === 'Q' ? 'mosfet' : 'diode'
    label = prefix === 'Q' ? 'MOSFET/transistor' : 'Diodo'
    passage = 'conditional'
  } else if (normalizedRules.filterPrefixes.includes(prefix)) {
    kind = 'capacitor'
    label = 'Capacitor'
    passage = 'none'
  } else if (prefix === 'U') {
    kind = 'ic'
    label = 'Circuito integrado'
    passage = 'barrier'
  } else if (prefix === 'J' || prefix === 'P' || prefix === 'CN') {
    kind = 'connector'
    label = 'Conector'
    passage = 'none'
  } else if (prefix === 'TP') {
    kind = 'test-point'
    label = 'Ponto de teste'
    passage = 'none'
  }

  if (manualDirection === 'blocked') passage = 'none'
  const internalLinks = (annotations.internalLinks || []).filter(link => link.component === component?.designator)
  if (kind === 'ic' && internalLinks.length) passage = 'linked'
  return { designator: component?.designator, prefix, kind, label, passage, manualFunction: manualFunction || '', manualDirection, internalLinks }
}

export function classifyNetName(name, rules = defaultEnergyRules) {
  const normalizedRules = normalizeEnergyRules(rules)
  const text = String(name || '').toUpperCase().replace(/^\/+/, '')
  const isSource = normalizedRules.sourcePatterns.some(pattern => {
    try { return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*'), 'i').test(text) } catch { return text.includes(pattern.toUpperCase()) }
  })
  const voltage = normalizedRules.voltagePatterns.find(item => {
    try { return new RegExp(item.pattern, 'i').test(text) } catch { return false }
  })?.voltage ?? null
  const type = /GND|GROUND|VSS|AGND/i.test(text) ? 'terra' : isSource || voltage !== null ? 'energia' : /USB|SATA|PCI|PCIE|HDMI|LVDS|RX|TX|CLK|DATA|SCL|SDA/i.test(text) ? 'sinal' : 'desconhecida'
  return { name, isSource, type, voltage }
}

export function detectSourceNets(board, rules = defaultEnergyRules, annotations = {}) {
  const normalizedRules = normalizeEnergyRules(rules)
  return (board?.nets || []).map(net => {
    const inferred = classifyNetName(net.name, normalizedRules)
    const override = annotations.sourceOverrides?.[net.name]
    return { ...net, ...inferred, source: override === 'source' ? true : override === 'not-source' ? false : inferred.isSource, sourceMode: override || (inferred.isSource ? 'inferred' : 'none') }
  }).filter(net => net.source)
}

export { prefixOf, valueInOhms }
