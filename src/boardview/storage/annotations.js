const STORAGE_PREFIX = 'fixio.boardview.annotations.v1:'
const RULES_KEY = 'fixio.boardview.energy-rules.v1'

export const emptyAnnotations = () => ({
  version: 1,
  model: '',
  revision: '',
  componentStates: {},
  functions: {},
  directions: {},
  internalLinks: [],
  measurements: [],
  sourceOverrides: {},
  traceDepth: 12,
  outline: null,
})

export const normalizeAnnotations = input => {
  const value = input || {}
  return {
    ...emptyAnnotations(),
    ...value,
    version: 1,
    componentStates: { ...(value.componentStates || {}) },
    functions: { ...(value.functions || {}) },
    directions: { ...(value.directions || {}) },
    internalLinks: Array.isArray(value.internalLinks) ? value.internalLinks : [],
    measurements: Array.isArray(value.measurements) ? value.measurements : [],
    sourceOverrides: { ...(value.sourceOverrides || {}) },
    traceDepth: Math.max(1, Math.min(100, Number(value.traceDepth) || 12)),
    outline: Array.isArray(value.outline) ? value.outline : null,
  }
}

const storageKey = (model, revision) => `${STORAGE_PREFIX}${encodeURIComponent(String(model || 'board'))}:${encodeURIComponent(String(revision || ''))}`

export function loadAnnotations(model, revision) {
  try {
    const stored = localStorage.getItem(storageKey(model, revision))
    return normalizeAnnotations(stored ? JSON.parse(stored) : { model, revision })
  } catch {
    return normalizeAnnotations({ model, revision })
  }
}

export function saveAnnotations(model, revision, annotations) {
  try { localStorage.setItem(storageKey(model, revision), JSON.stringify(normalizeAnnotations({ ...annotations, model, revision }))) } catch {}
}

export function loadEnergyRules(defaultRules) {
  try {
    const stored = localStorage.getItem(RULES_KEY)
    return stored ? { ...defaultRules, ...JSON.parse(stored) } : defaultRules
  } catch {
    return defaultRules
  }
}

export function saveEnergyRules(rules) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)) } catch {}
}

export function annotationBackup({ board, fileName, fileHash, model, revision, annotations, rules }) {
  return {
    kind: 'fixio-boardview-annotations',
    version: 1,
    exportedAt: new Date().toISOString(),
    board: { name: board?.name || fileName || '', model: model || board?.model || '', revision: revision || board?.revision || '', hash: fileHash || '' },
    annotations: normalizeAnnotations({ ...annotations, model, revision }),
    rules: rules || undefined,
  }
}

export function parseAnnotationBackup(text) {
  const value = JSON.parse(String(text || ''))
  if (value?.kind !== 'fixio-boardview-annotations' || !value.annotations) throw new Error('Este arquivo não é um backup de anotações do Fix.io.')
  return { ...value, annotations: normalizeAnnotations(value.annotations) }
}
