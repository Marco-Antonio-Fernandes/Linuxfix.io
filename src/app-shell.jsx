import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, BellRing, Boxes, ChevronRight, CircleDollarSign, ClipboardList, FileCode2, LayoutDashboard, Laptop, LogOut, Menu, MessageCircle, MonitorPlay, PanelLeftClose, PanelLeftOpen, Plus, Share2, ShoppingCart, Users, Wrench, X } from 'lucide-react'
import './app-shell.css'

const navigation = [
  ['dashboard', LayoutDashboard, 'Dashboard'],
  ['clients', Users, 'Clientes'],
  ['devices', Laptop, 'Equipamentos'],
  ['orders', ClipboardList, 'Ordens de serviço'],
  ['finance', CircleDollarSign, 'Financeiro'],
  ['inventory', Boxes, 'Estoque'],
  ['whatsapp', MessageCircle, 'WhatsApp'],
  ['chat-beta', MessageCircle, 'Chat (beta)'],
  ['techunion', MonitorPlay, 'Bancada'],
  ['autounattend', FileCode2, 'Auto Atende'],
]

export function AppShell({ page, setPage, children, notifications, financeNotifications, onOpenWhatsApp, onOpenFinance, onShareOrder, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const desktop = Boolean(window.chrome?.webview)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fixio.sidebar.collapsed') === '1')
  const [applicationStatus, setApplicationStatus] = useState({ state: 'idle', message: '' })
  const [pixToast, setPixToast] = useState(null)
  const lastPixNotification = useRef(null)

  useEffect(() => {
    const webview = window.chrome?.webview
    if (!webview) return undefined
    const receive = event => {
      const status = event.data
      if (status?.type !== 'desktop-status' || status.target !== 'application') return
      setApplicationStatus(status)
    }
    webview.addEventListener('message', receive)
    return () => {
      webview.removeEventListener('message', receive)
    }
  }, [])

  const shareOrder = async () => {
    if (!onShareOrder) return
    try { setApplicationStatus({ state: 'success', message: await onShareOrder() }) }
    catch (error) { setApplicationStatus({ state: 'error', message: error.message }) }
  }

  useEffect(() => {
    localStorage.setItem('fixio.sidebar.collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    const latest = financeNotifications?.latest
    if (!latest?.id || latest.id === lastPixNotification.current) return undefined
    lastPixNotification.current = latest.id
    setPixToast(latest)
    const timer = window.setTimeout(() => setPixToast(null), 9000)
    return () => window.clearTimeout(timer)
  }, [financeNotifications?.latest?.id])

  useLayoutEffect(() => {
    const webview = window.chrome?.webview
    if (!webview || typeof ResizeObserver === 'undefined') return undefined
    let frame = null
    let lastBounds = ''
    const area = document.querySelector('.main-area')
    const header = area?.querySelector('header')
    if (!area || !header) return undefined
    const reportContentBounds = () => {
      frame = null
      const rect = area.getBoundingClientRect()
      const top = Math.max(0, header.getBoundingClientRect().bottom)
      const left = Math.max(0, rect.left)
      const bounds = {
        type: 'content-bounds',
        left,
        top,
        width: Math.max(0, Math.min(rect.right, window.innerWidth) - left),
        height: Math.max(0, window.innerHeight - top),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        obscured: mobileOpen,
      }
      const serialized = JSON.stringify(bounds)
      if (serialized === lastBounds) return
      lastBounds = serialized
      webview.postMessage(bounds)
    }
    const scheduleContentBounds = () => {
      if (frame === null) frame = window.requestAnimationFrame(reportContentBounds)
    }
    const observer = new ResizeObserver(scheduleContentBounds)
    observer.observe(area)
    observer.observe(header)
    window.addEventListener('resize', scheduleContentBounds)
    window.addEventListener('scroll', scheduleContentBounds, true)
    reportContentBounds()
    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleContentBounds)
      window.removeEventListener('scroll', scheduleContentBounds, true)
    }
  }, [collapsed, page, mobileOpen])

  useEffect(() => {
    window.chrome?.webview?.postMessage({ type: 'navigate', page })
  }, [page])

  useEffect(() => () => {
    window.chrome?.webview?.postMessage({ type: 'navigate', page: '' })
  }, [])

  const go = nextPage => {
    setPage(nextPage)
    setMobileOpen(false)
  }
  const breadcrumbLabel = navigation.find(([id]) => id === page)?.[2] ?? page

  return <div className={`app app-shell${collapsed ? ' app-shell-collapsed' : ''}`}>
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`}>
      <div className="brand">
        <div className="brand-mark"><Wrench size={19}/></div>
        <b className="brand-label">fix<span>.io</span></b>
        <button className="sidebar-collapse" onClick={() => setCollapsed(value => !value)} title={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          {collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>} 
        </button>
        <button className="close-menu" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={18}/></button>
      </div>
      <div className="sidebar-quick-actions">
        <button className="quick-order" onClick={() => go('new-order')}><Plus size={16}/><span>Nova OS</span></button>
        <button className="quick-sale" onClick={() => go('sale')}><ShoppingCart size={16}/><span>Venda</span></button>
      </div>
      <nav>
        <div className="nav-group">
          <p>GESTÃO</p>
          {navigation.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)} title={label}>
            <Icon size={18}/><span className="nav-label">{label}</span>{id === 'finance' && financeNotifications?.pending_count > 0 && <i className="nav-alert-dot" aria-label={`${financeNotifications.pending_count} Pix pendente(s)`} />}
          </button>)}
        </div>
      </nav>
      {onLogout && <div className="sidebar-bottom"><button type="button" className="sidebar-logout" onClick={onLogout} title="Sair do sistema"><LogOut size={18}/><span className="nav-label">Sair</span></button></div>}
    </aside>
    <div className={`main-area${collapsed ? ' sidebar-collapsed' : ''}`}>
      <header>
        <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={22}/></button>
        <div className="breadcrumb"><b>fix.io</b><ChevronRight size={15}/><span>{breadcrumbLabel}</span></div>
        <div className="topbar-actions">
          {page === 'detail' && <button type="button" className="outline topbar-share" onClick={shareOrder} title="Compartilhar OS com o cliente"><Share2 size={16}/><span>Compartilhar OS</span></button>}
          <button type="button" className="application-shortcut" disabled={!desktop}
            title="Ir para a bancada"
            aria-label="Ir para a bancada"
            onClick={() => go('techunion')}>
            <MonitorPlay size={20}/>
          </button>
          <button type="button" className={notifications?.unread_count ? 'topbar-message has-unread' : 'topbar-message'} onClick={() => { go('whatsapp'); onOpenWhatsApp() }} title="Abrir WhatsApp">
            <Bell size={17}/><span>WhatsApp</span>{notifications?.unread_count > 0 && <b>{notifications.unread_count > 99 ? '99+' : notifications.unread_count}</b>}
          </button>
          {financeNotifications?.pending_count > 0 && <button type="button" className="topbar-message finance-alert-message has-unread" onClick={() => { go('finance'); onOpenFinance?.() }} title="Abrir Pix pendentes">
            <BellRing size={17}/><span>Pix pendente</span><b>{financeNotifications.pending_count > 99 ? '99+' : financeNotifications.pending_count}</b>
          </button>}
          {onLogout && <button type="button" className="topbar-logout outline" onClick={onLogout} title="Sair do sistema"><LogOut size={16}/><span>Sair</span></button>}
        </div>
        {applicationStatus.message && <div className={`application-status ${applicationStatus.state}`} role="status">
          <span>{applicationStatus.message}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setApplicationStatus(current => ({ ...current, message: '' }))}><X size={16}/></button>
        </div>}
        {pixToast && <button type="button" className="pix-toast" onClick={() => { setPixToast(null); go('finance'); onOpenFinance?.() }}>
          <span className="pix-toast-icon"><BellRing size={17} /></span><span><b>Novo Pix identificado</b><small>{pixToast.direction === 'in' ? 'Entrada' : 'Saída'} de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(pixToast.amount_cents) || 0) / 100)} · classifique no Financeiro</small></span><X size={15} onClick={event => { event.stopPropagation(); setPixToast(null) }} />
        </button>}
      </header>
      <main className={`content${page === 'whatsapp' ? ' whatsapp-content' : page === 'chat-beta' ? ' chat-beta-content' : page === 'techunion' ? ' tech-union-content' : ''}`}>{children}</main>
    </div>
  </div>
}
