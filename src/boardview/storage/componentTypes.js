import { DEFAULT_COMPONENT_TYPE_RULES, normalizeComponentTypeRules } from '../model/componentTypes.js'

const KEY = 'fixio.boardview.component-types.v1'

export function loadComponentTypeRules() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null')
    return normalizeComponentTypeRules(value || DEFAULT_COMPONENT_TYPE_RULES)
  } catch {
    return normalizeComponentTypeRules(DEFAULT_COMPONENT_TYPE_RULES)
  }
}

export function saveComponentTypeRules(rules) {
  try { localStorage.setItem(KEY, JSON.stringify(normalizeComponentTypeRules(rules))) } catch {}
}
