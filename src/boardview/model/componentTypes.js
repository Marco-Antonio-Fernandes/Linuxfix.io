export const DEFAULT_COMPONENT_TYPE_RULES = {
  prefixes: {
    R: 'resistor',
    C: 'capacitor',
    L: 'inductor',
    FB: 'ferrite',
    F: 'fuse',
    Q: 'mosfet',
    D: 'diode',
    ZD: 'diode',
    U: 'ic',
    J: 'connector',
    CN: 'connector',
    P: 'connector',
    X: 'connector',
    TP: 'test-point',
    SW: 'switch',
    S: 'switch',
    Y: 'crystal',
    XTL: 'crystal',
    B: 'battery',
    BT: 'battery',
    VR: 'potentiometer',
    RV: 'potentiometer',
  },
}

export const COMPONENT_TYPE_LABELS = {
  resistor: 'Resistor',
  capacitor: 'Capacitor',
  inductor: 'Indutor',
  ferrite: 'Ferrite',
  fuse: 'Fusível',
  mosfet: 'MOSFET/transistor',
  diode: 'Diodo',
  ic: 'Circuito integrado',
  connector: 'Conector',
  'test-point': 'Ponto de teste',
  switch: 'Chave',
  crystal: 'Cristal/oscilador',
  battery: 'Bateria',
  potentiometer: 'Potenciômetro',
  unknown: 'Tipo desconhecido',
}

export const COMPONENT_TYPE_DESCRIPTIONS = {
  resistor: 'Limita ou condiciona a passagem de sinal. A função específica nesta placa não foi determinada.',
  capacitor: 'Armazena carga temporariamente e pode participar de filtragem ou desacoplamento. A função específica nesta placa não foi determinada.',
  inductor: 'Armazena energia em campo magnético e pode participar de filtros ou conversores. A função específica nesta placa não foi determinada.',
  ferrite: 'Elemento de filtragem de alta frequência. A função específica nesta placa não foi determinada.',
  fuse: 'Elemento de proteção que pode interromper a alimentação quando há uma condição anormal.',
  mosfet: 'Transistor usado para chaveamento ou controle. O modo de uso nesta placa não foi determinado.',
  diode: 'Permite condução preferencial em uma direção. O uso específico nesta placa não foi determinado.',
  ic: 'Circuito integrado. A função e as ligações internas precisam de dados do CI ou anotação manual.',
  connector: 'Conector ou ponto de interface com outra parte do equipamento.',
  'test-point': 'Ponto destinado a medição ou teste.',
  switch: 'Chave ou elemento de comutação. A função específica não foi determinada.',
  crystal: 'Elemento oscilador ou ressonador. A função específica não foi determinada.',
  battery: 'Fonte ou acumulador de energia identificado pelo designador.',
  potentiometer: 'Resistor ajustável. A função específica não foi determinada.',
  unknown: 'O arquivo não fornece evidência suficiente para identificar o tipo.',
}

const normalizeRules = rules => {
  const prefixes = { ...DEFAULT_COMPONENT_TYPE_RULES.prefixes, ...(rules?.prefixes || {}) }
  return {
    prefixes: Object.fromEntries(Object.entries(prefixes).map(([prefix, type]) => [String(prefix).toUpperCase(), String(type || 'unknown')]))
  }
}

export function classifyDesignator(designator, rules = DEFAULT_COMPONENT_TYPE_RULES) {
  const value = String(designator || '').trim().toUpperCase()
  const prefixes = normalizeRules(rules).prefixes
  const prefix = Object.keys(prefixes).sort((left, right) => right.length - left.length).find(item => value.startsWith(item)) || ''
  const type = prefix ? prefixes[prefix] : 'unknown'
  return { prefix, type, label: COMPONENT_TYPE_LABELS[type] || COMPONENT_TYPE_LABELS.unknown, description: COMPONENT_TYPE_DESCRIPTIONS[type] || COMPONENT_TYPE_DESCRIPTIONS.unknown, confidence: prefix ? 'inferred' : 'unknown' }
}

export function normalizeComponentTypeRules(rules) {
  return normalizeRules(rules)
}

export function typeRuleEntries(rules = DEFAULT_COMPONENT_TYPE_RULES) {
  return Object.entries(normalizeRules(rules).prefixes).sort(([left], [right]) => left.localeCompare(right, 'pt-BR', { numeric: true }))
}
