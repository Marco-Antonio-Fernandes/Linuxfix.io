import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MonitorPlay, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import './tech-union.css'

export function TechUnionWorkspace() {
  const desktop = Boolean(window.chrome?.webview)
  const viewport = useRef(null)
  const [status, setStatus] = useState({ state: 'starting', message: 'Preparando a bancada…' })
  const [layoutVersion, setLayoutVersion] = useState(0)
  useEffect(() => {
    const bridge = window.chrome?.webview
    if (!bridge) return undefined
    const receive = event => {
      if (event.data?.type !== 'desktop-status' || event.data.target !== 'techunion') return
      setStatus(event.data)
      setLayoutVersion(value => value + 1)
    }
    bridge.addEventListener('message', receive)
    return () => bridge.removeEventListener('message', receive)
  }, [])

  useLayoutEffect(() => {
    if (!desktop || !viewport.current) return undefined
    const element = viewport.current
    let frame = 0
    const report = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        window.chrome.webview.postMessage({ type: 'techunion-bounds', left: rect.left, top: rect.top,
          width: rect.width, height: rect.height, viewportWidth: window.innerWidth })
      })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    // Also observe the shell: collapsing the sidebar may move the viewport.
    const shell = element.closest('.main-area')
    if (shell) observer.observe(shell)
    window.addEventListener('resize', report)
    window.addEventListener('scroll', report, true)
    report()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', report)
      window.removeEventListener('scroll', report, true)
    }
  }, [desktop, layoutVersion])

  const command = type => window.chrome?.webview?.postMessage({ type })
  const starting = status.state === 'starting'
  return <section className="tech-union-workspace">
    <div className="tech-union-toolbar">
      <div><h1><MonitorPlay size={22}/>Bancada</h1><p role="status">{desktop ? status.message : 'Disponível no cliente Fix.io Linux.'}</p></div>
      <div className="tech-union-actions">
        <button className="outline" disabled={!desktop || starting} onClick={() => command('techunion-open')}><RefreshCw size={15}/>Usar nesta tela</button>
        <button className="outline" disabled={!desktop || starting} onClick={() => command('techunion-external')}><ExternalLink size={15}/>Abrir em janela própria</button>
        <button className="outline" disabled={!desktop || starting} onClick={() => command('techunion-choose')} title="Escolher outro executável"><FolderOpen size={15}/><span>Escolher executável</span></button>
      </div>
    </div>
    <div ref={viewport} className="tech-union-viewport">
      <div className="tech-union-placeholder">
        <MonitorPlay size={40}/>
        <h2>{status.state === 'error' ? 'Não foi possível executar o programa' : status.state === 'external' ? 'Programa aberto em janela própria' : 'Área da bancada'}</h2>
        <p>{desktop ? status.message : 'Abra o cliente Fix.io Linux para utilizar o executável via Wine.'}</p>
        {status.state === 'waiting' && <small>O programa selecionado será iniciado pelo Wine em uma janela própria.</small>}
      </div>
    </div>
  </section>
}
