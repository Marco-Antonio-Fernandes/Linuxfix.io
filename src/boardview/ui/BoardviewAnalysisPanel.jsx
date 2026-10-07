import { useMemo, useState } from 'react'
import { Download, Link2, Save, Upload, Zap } from 'lucide-react'

const functionOptions = [
  ['', 'Automático'], ['source', 'Entrada de energia'], ['connector', 'Conector'], ['fuse', 'Fusível'], ['inductor', 'Indutor'], ['switch', 'Chave'], ['mosfet', 'MOSFET'], ['diode', 'Diodo'], ['regulator', 'Regulador'], ['filter', 'Filtro'], ['pass-through', 'Passagem direta'], ['consumer', 'Consumidor'],
]
const directionOptions = [['auto', 'Automática'], ['forward', 'Pino 1 → demais'], ['reverse', 'Demais → pino 1'], ['bidirectional', 'Bidirecional'], ['blocked', 'Bloqueada']]
const measurementLabel = status => status === 'no-power' ? 'Sem energia' : status === 'voltage' ? 'Medição' : status === 'ok' ? 'OK' : 'Sem marcação'

function AnnotationPanel({ target, selectedComponent, annotations, onUpdate }) {
  const [volts, setVolts] = useState('')
  const [inputPin, setInputPin] = useState('')
  const [outputPin, setOutputPin] = useState('')
  const targetMeasurement = useMemo(() => (annotations.measurements || []).find(measurement => measurement.componentDesignator === target?.componentDesignator && String(measurement.pinNumber || '') === String(target?.pinNumber || '') && (!target?.netName || measurement.netName === target.netName)), [annotations.measurements, target])
  if (!target && !selectedComponent) return null
  const saveMeasurement = status => {
    const now = new Date().toISOString()
    const current = annotations.measurements || []
    const match = item => item.componentDesignator === target?.componentDesignator && String(item.pinNumber || '') === String(target?.pinNumber || '') && (!target?.netName || item.netName === target.netName)
    const next = current.filter(item => !match(item))
    if (status) next.push({ id: targetMeasurement?.id || `measurement-${Date.now()}`, ...target, status, volts: status === 'voltage' ? Number(volts) : null, date: now })
    onUpdate({ measurements: next })
    setVolts('')
  }
  const component = selectedComponent
  const componentFunction = component ? annotations.functions?.[component.designator] || '' : ''
  const componentDirection = component ? annotations.directions?.[component.designator] || 'auto' : 'auto'
  const links = component ? (annotations.internalLinks || []).filter(link => link.component === component.designator) : []
  const addLink = () => {
    if (!component || !inputPin || !outputPin || inputPin === outputPin) return
    const duplicate = links.some(link => String(link.inputPin) === String(inputPin) && String(link.outputPin) === String(outputPin))
    if (duplicate) return
    onUpdate({ internalLinks: [...(annotations.internalLinks || []), { component: component.designator, inputPin, outputPin }] })
    setInputPin(''); setOutputPin('')
  }
  return <section className="boardview-annotation-panel">
    <div className="boardview-analysis-heading"><div><span className="boardview-kicker">ANOTAÇÕES LOCAIS</span><h3>{target?.netName || component?.designator || 'Ponto selecionado'}</h3></div><small>não altera o arquivo</small></div>
    <div className="boardview-measurement-box"><div><b>Marcação do ponto</b><small>{target?.pinNumber ? `Pino ${target.pinNumber}` : target?.netName ? 'Net selecionada' : 'Componente selecionado'}</small></div><div className="boardview-measurement-actions"><button type="button" className={targetMeasurement?.status === 'ok' ? 'active ok' : ''} onClick={() => saveMeasurement('ok')}>OK</button><button type="button" className={targetMeasurement?.status === 'no-power' ? 'active no-power' : ''} onClick={() => saveMeasurement('no-power')}>Sem energia</button></div><div className="boardview-voltage-row"><input type="number" min="0" step="0.01" placeholder="Volts" value={volts} onChange={event => setVolts(event.target.value)} /><button type="button" className={targetMeasurement?.status === 'voltage' ? 'active voltage' : ''} disabled={!volts} onClick={() => saveMeasurement('voltage')}>Medi X volts</button><button type="button" className="clear" disabled={!targetMeasurement} onClick={() => saveMeasurement('')}>Limpar</button></div>{targetMeasurement && <small className="boardview-measurement-current">Atual: {measurementLabel(targetMeasurement.status)}{targetMeasurement.volts ? ` · ${targetMeasurement.volts} V` : ''} · {new Date(targetMeasurement.date).toLocaleString('pt-BR')}</small>}</div>
    {component && <>
      <label className="boardview-form-field"><span>Estado do componente</span><select value={annotations.componentStates?.[component.designator] || ''} onChange={event => onUpdate({ componentStates: { ...annotations.componentStates, [component.designator]: event.target.value } })}><option value="">Sem marcar</option><option value="suspect">Suspeito</option><option value="verified">Verificado OK</option><option value="defective">Defeituoso</option></select></label>
      <div className="boardview-form-grid"><label className="boardview-form-field"><span>Função manual</span><select value={componentFunction} onChange={event => onUpdate({ functions: { ...annotations.functions, [component.designator]: event.target.value } })}>{functionOptions.map(([value, label]) => <option value={value} key={value || 'auto'}>{label}</option>)}</select></label><label className="boardview-form-field"><span>Direção manual</span><select value={componentDirection} onChange={event => onUpdate({ directions: { ...annotations.directions, [component.designator]: event.target.value } })}>{directionOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      {component.pins.length > 1 && <div className="boardview-links-box"><div className="boardview-subheading"><b>Ligação interna do CI</b><small>permite atravessar barreiras</small></div><div className="boardview-link-form"><select value={inputPin} onChange={event => setInputPin(event.target.value)}><option value="">Entrada</option>{component.pins.map(pin => <option value={pin.number} key={`in-${pin.number}`}>{pin.number} · {pin.netName}</option>)}</select><span>→</span><select value={outputPin} onChange={event => setOutputPin(event.target.value)}><option value="">Saída</option>{component.pins.map(pin => <option value={pin.number} key={`out-${pin.number}`}>{pin.number} · {pin.netName}</option>)}</select><button type="button" onClick={addLink} disabled={!inputPin || !outputPin}><Link2 size={14} /></button></div>{links.length ? <div className="boardview-link-list">{links.map(link => <div key={`${link.component}-${link.inputPin}-${link.outputPin}`}><span>Pino {link.inputPin} → pino {link.outputPin}</span><button type="button" onClick={() => onUpdate({ internalLinks: (annotations.internalLinks || []).filter(item => item !== link) })}>×</button></div>)}</div> : <small className="boardview-muted">Nenhuma ligação interna cadastrada. CIs continuam como barreira.</small>}</div>}
    </>}
  </section>
}

export function BoardviewLocalAnnotationsPanel({ target, selectedComponent, annotations, onUpdate }) {
  return <AnnotationPanel target={target} selectedComponent={selectedComponent} annotations={annotations} onUpdate={onUpdate} />
}

function RulesEditor({ rules, onChange }) {
  const listField = (key, label) => <label className="boardview-form-field"><span>{label}</span><input value={(rules[key] || []).join(', ')} onChange={event => onChange({ [key]: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} /></label>
  return <details className="boardview-rules"><summary>Regras editáveis de classificação</summary><div className="boardview-form-grid">{listField('directPrefixes', 'Passagem direta')}{listField('conditionalPrefixes', 'Passagem condicional')}{listField('filterPrefixes', 'Filtros que ficam na net')}{listField('sourcePatterns', 'Nomes que podem ser fontes')}</div><label className="boardview-form-field"><span>Resistência máxima para R passar (Ω)</span><input type="number" min="0" step="0.1" value={rules.lowResistanceOhms} onChange={event => onChange({ lowResistanceOhms: Number(event.target.value) })} /></label><small className="boardview-muted">Os padrões de fonte são tratados como texto. Confirme manualmente ou troque qualquer fonte detectada.</small></details>
}

export function BoardviewAnalysisPanel({ board, model, revision, fileHash, annotations, rules, graph, trace, target, selectedComponent, onUpdateAnnotations, onUpdateRules, onIdentityChange, onIdentityFocus, onIdentityCommit, onExport, onImport }) {
  const [sourceNet, setSourceNet] = useState('')
  const allNets = board?.nets || []
  const inferredSources = graph.sourceNets || []
  const exportBackup = () => onExport()
  return <section className="boardview-analysis-panel panel">
    <div className="boardview-analysis-top"><div><span className="boardview-kicker">FASES 2 E 3</span><h2>Rastreio e anotações da placa</h2><p>O sistema aponta caminhos e suspeitos; a decisão de defeito continua sendo sua.</p></div><div className="boardview-backup-actions"><button type="button" className="outline" onClick={exportBackup}><Download size={15} />Exportar JSON</button><label className="outline"><Upload size={15} />Importar JSON<input type="file" accept="application/json,.json" onChange={event => { void onImport(event.target.files?.[0]); event.target.value = '' }} /></label></div></div>
    <div className="boardview-analysis-grid"><div className="boardview-analysis-column"><div className="boardview-identity"><label className="boardview-form-field"><span>Modelo</span><input value={model} onFocus={onIdentityFocus} onChange={event => onIdentityChange('model', event.target.value)} onBlur={onIdentityCommit} /></label><label className="boardview-form-field"><span>Revisão</span><input value={revision} onFocus={onIdentityFocus} onChange={event => onIdentityChange('revision', event.target.value)} onBlur={onIdentityCommit} /></label><span className="boardview-hash">Arquivo original: {fileHash.slice(0, 12)}…</span></div><div className="boardview-source-box"><div className="boardview-subheading"><b><Zap size={14} /> Fontes de energia</b><small>detectadas pelo nome da net</small></div>{inferredSources.length ? inferredSources.map(source => <div className="boardview-source-row" key={source.name}><span><b>{source.name}</b><small>{source.sourceMode === 'inferred' ? 'Provável fonte' : 'Confirmada manualmente'}{source.voltage ? ` · ${source.voltage} V pelo nome` : ''}</small></span><select value={annotations.sourceOverrides?.[source.name] || (source.sourceMode === 'inferred' ? 'auto' : 'source')} onChange={event => onUpdateAnnotations({ sourceOverrides: { ...annotations.sourceOverrides, [source.name]: event.target.value === 'auto' ? undefined : event.target.value } })}><option value="auto">Automática</option><option value="source">Confirmar fonte</option><option value="not-source">Não é fonte</option></select></div>) : <small className="boardview-muted">Nenhuma fonte foi detectada pelas regras atuais.</small>}<div className="boardview-add-source"><select value={sourceNet} onChange={event => setSourceNet(event.target.value)}><option value="">Escolher outra net…</option>{allNets.filter(net => !inferredSources.some(source => source.name === net.name)).map(net => <option value={net.name} key={net.name}>{net.name}</option>)}</select><button type="button" className="outline" disabled={!sourceNet} onClick={() => { onUpdateAnnotations({ sourceOverrides: { ...annotations.sourceOverrides, [sourceNet]: 'source' } }); setSourceNet('') }}>Usar como fonte</button></div></div><RulesEditor rules={rules} onChange={onUpdateRules} /></div><div className="boardview-analysis-column"><div className="boardview-trace-box"><div className="boardview-subheading"><b>Resultado do rastreio</b><label>Profundidade <input type="number" min="1" max="100" value={annotations.traceDepth} onChange={event => onUpdateAnnotations({ traceDepth: Number(event.target.value) })} /></label></div>{trace.active ? <><div className="boardview-trace-counts"><span className="red"><i />{trace.redComponents.size} trecho(s) vermelho(s)</span><span className="orange"><i />{trace.orangeComponents.size} possível(is) curto(s)</span><span className="gray"><i />{trace.probablyOkComponents.size} provavelmente OK</span></div><div className="boardview-test-order"><b>Lista de teste, do ponto para a fonte</b>{trace.testOrder.length ? trace.testOrder.map(item => <div key={item.designator}><span><strong>{item.designator}</strong><small>{item.reason}</small></span><em>{item.state ? item.state : `${item.distance} níveis`}</em></div>) : <small className="boardview-muted">Nenhum componente no caminho dentro do limite.</small>}</div></> : <p className="boardview-muted">Marque um ponto como “Sem energia” no painel do componente para iniciar o rastreio.</p>}</div><AnnotationPanel target={target} selectedComponent={selectedComponent} annotations={annotations} onUpdate={onUpdateAnnotations} /></div></div>
  </section>
}
