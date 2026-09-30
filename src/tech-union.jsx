import { useEffect, useRef, useState } from 'react'
import { MonitorPlay, FolderOpen, Play, Square } from 'lucide-react'
import { useNativeViewport } from './use-native-viewport.js'
import './tech-union.css'

export function TechUnionWorkspace() {
  const desktop = Boolean(window.chrome?.webview)
  const viewport = useRef(null)
  const [status, setStatus] = useState({ state: 'ready', message: 'Escolha o executável e abra na bancada.' })
  const [choosing, setChoosing] = useState(false)
  useNativeViewport(viewport, 'techunion-bounds')
  useEffect(() => {
    const bridge = window.chrome?.webview
    if (!bridge) return undefined
    const receive = event => {
      if (event.data?.type === 'desktop-status' && event.data.target === 'techunion') setStatus(event.data)
    }
    bridge.addEventListener('message', receive)
    return () => bridge.removeEventListener('message', receive)
  }, [])

  const active = ['starting', 'embedded', 'stopping'].includes(status.state)
  const command = async type => {
    if (type === 'techunion-stop' && !window.confirm('Encerrar o programa da bancada? Salve seu trabalho antes de continuar.')) return
    if (type === 'techunion-open') setStatus({ state: 'starting', message: 'Preparando a área interna…' })
    if (type === 'techunion-choose') setChoosing(true)
    await window.chrome?.webview?.postMessage({ type })
    setChoosing(false)
  }
  return <section className="tech-union-workspace">
    <div className="tech-union-toolbar">
      <div><h1><MonitorPlay size={22}/>Bancada</h1><p role="status">{desktop ? status.message : 'Disponível no cliente Fix.io Linux.'}</p></div>
      <div className="tech-union-actions">
        <button className="outline" disabled={!desktop || active || choosing} onClick={() => command('techunion-open')}><Play size={15}/>Abrir na bancada</button>
        <button className="outline" disabled={!desktop || active || choosing} onClick={() => command('techunion-choose')}><FolderOpen size={15}/>Escolher executável</button>
        <button className="outline" disabled={!desktop || !active || status.state === 'stopping'} onClick={() => command('techunion-stop')}><Square size={15}/>Encerrar</button>
      </div>
    </div>
    <div ref={viewport} className="tech-union-viewport">
      <div className="tech-union-placeholder">
        <MonitorPlay size={40}/>
        <h2>{status.state === 'error' ? 'Não foi possível abrir dentro da bancada' : 'Área da bancada'}</h2>
        <p>{desktop ? status.message : 'Abra o cliente Fix.io Linux para utilizar a bancada.'}</p>
        {!active && <small>O programa será aberto somente nesta área. Escolher o arquivo não inicia a execução.</small>}
      </div>
    </div>
  </section>
}
