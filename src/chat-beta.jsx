import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCheck, ChevronDown, ClipboardList, Clock, Image, MessageCircle, MoreHorizontal, Paperclip, Phone, Pin, PinOff, RefreshCw, Search, Send, Smile, UserPlus, UserRound, Volume2 } from 'lucide-react'
import './chat-beta.css'

const API = (import.meta.env.VITE_API_URL || 'https://backfixio.rotatix.com.br').replace(/\/$/, '')

async function chatApi(path, options = {}) {
  const token = localStorage.getItem('fixio_token')
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw Error(data?.error || 'Não foi possível conectar ao chat.')
  return data
}

const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(item => item[0]).join('').toUpperCase()
const avatarColors = ['mint', 'blue', 'purple', 'orange']
const avatarColor = id => avatarColors[Math.abs(Number(id) || String(id || '').length) % avatarColors.length]
const displayPhone = value => {
  const raw = String(value || '')
  if (raw.endsWith('@g.us')) return 'Grupo do WhatsApp'
  return raw.replace(/@s\.whatsapp\.net$/, '') || 'Telefone não informado'
}
const formatOrder = conversation => conversation?.service_order_number ? `#${conversation.service_order_number}` : 'Sem OS vinculada'
const FIXIO_TIME_ZONE = 'America/Sao_Paulo'
const parseFixioDate = value => {
  if (!value) return null
  const raw = String(value).trim()
  const localDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(raw)
  const date = new Date(localDateTime ? `${localDateTime[1]}T${localDateTime[2]}-03:00` : raw)
  return Number.isNaN(date.getTime()) ? null : date
}
const formatTime = value => {
  if (!value) return '—'
  const date = parseFixioDate(value)
  if (!date) return String(value)
  const dateOptions = { timeZone: FIXIO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }
  const todayKey = new Intl.DateTimeFormat('en-CA', dateOptions).format(new Date())
  const dateKey = new Intl.DateTimeFormat('en-CA', dateOptions).format(date)
  if (dateKey === todayKey) return new Intl.DateTimeFormat('pt-BR', { timeZone: FIXIO_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date)
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FIXIO_TIME_ZONE, day: '2-digit', month: '2-digit' }).format(date)
}

function ChatAvatar({ conversation, large = false }) {
  const [src, setSrc] = useState('')
  const profilePath = String(conversation?.whatsapp_profile_pic || '').trim()

  useEffect(() => {
    if (!profilePath) {
      setSrc('')
      return undefined
    }
    const controller = new AbortController()
    let objectUrl = ''
    const token = localStorage.getItem('fixio_token')
    fetch(`${API}/api/integrations/whatsapp/media?path=${encodeURIComponent(profilePath)}`, {
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(response => {
      if (!response.ok) throw new Error('Foto indisponível')
      return response.blob()
    }).then(blob => {
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    }).catch(() => {})
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [conversation?.id, profilePath])

  return <span className={`chat-beta-avatar ${avatarColor(conversation?.id)}${large ? ' large' : ''}`}>{src ? <img src={src} alt="" /> : initials(conversation?.client_name)}</span>
}

function WhatsAppMedia({ message }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const mediaPath = String(message?.media_url || '').trim()

  useEffect(() => {
    if (!mediaPath) return undefined
    setSrc('')
    setFailed(false)
    const controller = new AbortController()
    let objectUrl = ''
    const token = localStorage.getItem('fixio_token')
    fetch(`${API}/api/integrations/whatsapp/media?path=${encodeURIComponent(mediaPath)}`, {
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(response => {
      if (!response.ok) throw new Error('Mídia indisponível')
      return response.blob()
    }).then(blob => {
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    }).catch(error => {
      if (error?.name !== 'AbortError') setFailed(true)
    })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [message?.id, mediaPath])

  if (!src) return <div className="chat-beta-media-loading">{failed ? 'Mídia não disponível no WhatsApp' : 'Carregando mídia...'}</div>
  const type = String(message?.media_type || '').toLowerCase()
  if (type.includes('audio') || type.includes('voice')) return <div className="chat-beta-audio-card"><div className="chat-beta-media-heading"><span className="chat-beta-media-icon"><Volume2 size={17} /></span><span><b>Áudio recebido</b><small>Mensagem de voz do WhatsApp</small></span></div><audio className="chat-beta-audio" controls src={src} /></div>
  if (type.includes('image') || type.includes('sticker')) return <div className="chat-beta-media-card"><div className="chat-beta-media-heading"><span className="chat-beta-media-icon"><Image size={16} /></span><b>Imagem recebida</b></div><img className="chat-beta-image" src={src} alt={message.media_name || 'Imagem recebida'} /></div>
  if (type.includes('video')) return <div className="chat-beta-media-card"><div className="chat-beta-media-heading"><span className="chat-beta-media-icon"><MessageCircle size={16} /></span><b>Vídeo recebido</b></div><video className="chat-beta-video" controls src={src} /></div>
  return <a className="chat-beta-media-link" href={src} target="_blank" rel="noreferrer" download={message.media_name || undefined}>Abrir arquivo recebido</a>
}

function MessageContent({ message }) {
  const body = String(message?.body || '')
  const mediaType = String(message?.media_type || '').toLowerCase()
  const isViewOnce = /visualiza(?:ção|cao) única|view[ _-]?once|single[ _-]?view/i.test(body) || /view[ _-]?once|single[ _-]?view/i.test(mediaType)
  const viewOnceBody = isViewOnce ? (mediaType.includes('video') ? 'Vídeo de visualização única' : 'Foto de visualização única') : body
  const isMediaPlaceholder = !isViewOnce && /^\[(image|audio|voice|video|sticker|document|contact|location) recebido\]$/i.test(body)
  const placeholderBody = isMediaPlaceholder ? ({ image: 'Imagem recebida', audio: 'Áudio recebido', voice: 'Áudio recebido', video: 'Vídeo recebido', sticker: 'Figurinha recebida', document: 'Documento recebido', contact: 'Contato recebido', location: 'Localização recebida' }[body.slice(1, body.indexOf(' ')).toLowerCase()] || 'Mídia recebida') : ''
  return <>
    {!isViewOnce && message?.media_url && <WhatsAppMedia message={message} />}
    {(viewOnceBody || placeholderBody) && <p>{viewOnceBody || placeholderBody}</p>}
  </>
}

function ChatBetaWorkspace({ openOrder }) {
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState('')
  const [apiState, setApiState] = useState('loading')
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [messageError, setMessageError] = useState('')
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [clients, setClients] = useState([])
  const [orders, setOrders] = useState([])
  const [newClientId, setNewClientId] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newOrderId, setNewOrderId] = useState('')
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [syncingWhatsApp, setSyncingWhatsApp] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerName, setRegisterName] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerDocument, setRegisterDocument] = useState('')
  const [registering, setRegistering] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const messagesContainerRef = useRef(null)

  const loadConversations = async ({ silent = false } = {}) => {
    if (!silent) setApiState('loading')
    try {
      const result = await chatApi('/api/conversations')
      const rows = Array.isArray(result) ? result : []
      setConversations(rows)
      setSelectedId(current => current && rows.some(item => String(item.id) === String(current)) ? current : rows[0]?.id || null)
      setError('')
      setApiState('ready')
      return rows
    } catch (exception) {
      setError(exception.message)
      setApiState('error')
      return []
    }
  }

  const syncProgressLabel = state => {
    const progress = state?.progress || {}
    const done = Number(progress.chatsDone || 0)
    const total = Number(progress.chatsTotal || 0)
    const imported = Number(progress.messagesImported || 0)
    const found = Number(progress.messagesFound || 0)
    const current = progress.currentChat ? ` · ${progress.currentChat}` : ''
    return total ? `Importando ${done}/${total} conversa(s) · ${imported}/${found} mensagem(ns)${current}` : 'Preparando importação completa do WhatsApp...'
  }

  const waitForWhatsAppSync = async () => {
    for (let attempt = 0; attempt < 1800; attempt++) {
      await new Promise(resolve => window.setTimeout(resolve, 1000))
      const state = await chatApi('/api/integrations/whatsapp/sync')
      if (state.status === 'running') setSyncMessage(syncProgressLabel(state))
      if (state.status === 'finished') return state.result || {}
      if (state.status === 'error') throw Error(state.error || 'A sincronização do WhatsApp falhou.')
    }
    throw Error('A sincronização continua no servidor. Ela pode importar um histórico grande; atualize as conversas novamente em alguns minutos.')
  }

  const syncWhatsApp = async ({ silent = false } = {}) => {
    if (syncingWhatsApp) return
    try {
      setSyncingWhatsApp(true)
      if (!silent) setSyncMessage('Sincronizando conversas do WA-AKG...')
      const started = await chatApi('/api/integrations/whatsapp/sync', { method: 'POST' })
      const result = started.status === 'started' || started.status === 'running' ? await waitForWhatsAppSync() : started.result || started
      await loadConversations({ silent: true })
      const errors = Number(result.errors?.length || 0)
      const errorDetails = result.errors?.slice?.(0, 2).join(' | ')
      setSyncMessage(`${result.chats || 0} conversa(s) sincronizada(s), ${result.messages || 0} mensagem(ns) importada(s)${result.media ? ` · ${result.media} mídia(s)` : ''}${result.duplicates ? ` · ${result.duplicates} já existente(s)` : ''}${result.unregistered ? ` · ${result.unregistered} contato(s) ainda não cadastrado(s)` : ''}${result.skippedGroups ? ` · ${result.skippedGroups} grupo(s) ignorado(s)` : ''}${errors ? ` · ${errors} erro(s): ${errorDetails}` : ''}.`)
    } catch (exception) {
      setSyncMessage(exception.message)
    } finally {
      setSyncingWhatsApp(false)
    }
  }

  useEffect(() => {
    let syncTimer
    void loadConversations().then(rows => {
      if (!rows.length) syncTimer = window.setTimeout(() => { void syncWhatsApp({ silent: true }) }, 350)
    })
    const interval = window.setInterval(() => { void loadConversations({ silent: true }) }, 5000)
    return () => {
      if (syncTimer) window.clearTimeout(syncTimer)
      window.clearInterval(interval)
    }
  }, [])

  const selected = conversations.find(item => String(item.id) === String(selectedId)) || null

  useEffect(() => {
    if (!selected) {
      setMessages([])
      return undefined
    }
    let active = true
    const loadMessages = async (showLoading = false) => {
      if (showLoading) setLoadingMessages(true)
      setMessageError('')
      try {
        const result = await chatApi(`/api/conversations/${selected.id}/messages`)
        if (!active) return
        setMessages(Array.isArray(result) ? result : [])
        setConversations(current => current.map(item => String(item.id) === String(selected.id) ? { ...item, unread_count: 0 } : item))
      } catch (exception) {
        if (active) setMessageError(exception.message)
      } finally {
        if (active && showLoading) setLoadingMessages(false)
      }
    }
    void loadMessages(true)
    const interval = window.setInterval(() => { void loadMessages() }, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [selectedId])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || loadingMessages) return undefined
    const scrollToLatest = () => { container.scrollTop = container.scrollHeight }
    scrollToLatest()
    const timer = window.setTimeout(scrollToLatest, 250)
    return () => window.clearTimeout(timer)
  }, [selectedId, messages.length, loadingMessages])

  const unreadCount = conversations.reduce((total, item) => total + Number(item.unread_count || 0), 0)
  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return conversations.filter(item => {
      const matchesFilter = filter === 'all' || (filter === 'unread' && Number(item.unread_count) > 0) || (filter === 'active' && item.status !== 'closed')
      const matchesQuery = !normalized || `${item.client_name || ''} ${item.client_phone || ''} ${item.client_document || ''} ${item.service_order_number || ''} ${item.last_message || ''}`.toLowerCase().includes(normalized)
      return matchesFilter && matchesQuery
    })
  }, [conversations, filter, query])

  const togglePin = async conversation => {
    try {
      const result = await chatApi(`/api/conversations/${conversation.id}/pin`, { method: 'PATCH', body: JSON.stringify({ pinned: !Number(conversation.is_pinned) }) })
      const updated = result?.conversation || {}
      setConversations(current => current.map(item => String(item.id) === String(conversation.id) ? { ...item, ...updated, is_pinned: result?.pinned ? 1 : 0 } : item))
    } catch (exception) {
      setError(exception.message)
    }
  }

  const markAllRead = async () => {
    if (markingAllRead) return
    try {
      setMarkingAllRead(true)
      const result = await chatApi('/api/conversations/mark-all-read', { method: 'POST' })
      setConversations(current => current.map(item => ({ ...item, unread_count: 0 })))
      setSyncMessage(`${Number(result?.count || 0)} mensagem(ns) marcada(s) como lida(s).`)
    } catch (exception) {
      setError(exception.message)
    } finally {
      setMarkingAllRead(false)
    }
  }

  const sendMessage = async event => {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selected || sending) return
    try {
      setSending(true)
      setMessageError('')
      const result = await chatApi(`/api/conversations/${selected.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, senderName: localStorage.getItem('fixio.technician') || 'Assistência Fix.io' }),
      })
      setMessages(current => [...current, result])
      setConversations(current => current.map(item => String(item.id) === String(selected.id) ? { ...item, last_message: result.body, last_message_at: result.created_at, status: 'open', unread_count: 0 } : item))
      setDraft('')
    } catch (exception) {
      setMessageError(exception.message)
    } finally {
      setSending(false)
    }
  }

  const openNewConversation = async () => {
    setNewConversationOpen(true)
    if (clients.length || orders.length) return
    try {
      const [clientRows, orderRows] = await Promise.all([chatApi('/api/clients'), chatApi('/api/service-orders')])
      setClients(Array.isArray(clientRows) ? clientRows : [])
      setOrders(Array.isArray(orderRows) ? orderRows : [])
    } catch (exception) {
      setError(exception.message)
    }
  }

  const createConversation = async event => {
    event.preventDefault()
    if ((!newClientId && !newContactPhone.trim()) || creatingConversation) return
    try {
      setCreatingConversation(true)
      const result = await chatApi('/api/conversations', { method: 'POST', body: JSON.stringify({ clientId: newClientId ? Number(newClientId) : undefined, clientName: newContactName.trim(), clientPhone: newContactPhone.trim(), serviceOrderId: newOrderId ? Number(newOrderId) : null }) })
      const conversation = { ...result, unread_count: 0, last_message: null }
      setConversations(current => [conversation, ...current.filter(item => String(item.id) !== String(conversation.id))])
      setSelectedId(conversation.id)
      setNewConversationOpen(false)
      setNewClientId('')
      setNewContactName('')
      setNewContactPhone('')
      setNewOrderId('')
      setError('')
    } catch (exception) {
      setError(exception.message)
    } finally {
      setCreatingConversation(false)
    }
  }

  const openRegisterClient = () => {
    if (!selected || String(selected.client_phone || '').endsWith('@g.us')) return
    setRegisterName(selected.client_name || '')
    setRegisterEmail(selected.client_email || '')
    setRegisterDocument(selected.client_document || '')
    setRegisterOpen(true)
  }

  const registerClient = async event => {
    event.preventDefault()
    if (!selected || !registerName.trim() || registering) return
    try {
      setRegistering(true)
      const result = await chatApi(`/api/conversations/${selected.id}/register-client`, {
        method: 'POST',
        body: JSON.stringify({ name: registerName.trim(), email: registerEmail.trim() || null, document: registerDocument.trim() || null }),
      })
      setConversations(current => current.map(item => String(item.id) === String(selected.id) ? { ...item, ...result, is_registered_client: 1 } : item))
      setRegisterOpen(false)
      setSyncMessage(`${registerName.trim()} foi cadastrado como cliente.`)
      setError('')
    } catch (exception) {
      setError(exception.message)
    } finally {
      setRegistering(false)
    }
  }

  const connectionLabel = apiState === 'ready' ? 'API conectada' : apiState === 'error' ? 'API indisponível' : 'Conectando à API'

  return <section className="chat-beta-workspace">
    <div className="chat-beta-titlebar">
      <div>
        <div className="chat-beta-kicker"><MessageCircle size={15} /> WHATSAPP <span>FIX.IO</span></div>
        <h1>WhatsApp</h1>
        <p>Converse com seus clientes e mantenha cada mensagem ligada à ordem de serviço.</p>
      </div>
      <div className="chat-beta-title-actions">
        <span className={`chat-beta-connection ${apiState}`}><i />{connectionLabel}</span>
        <button type="button" className="outline" onClick={() => void syncWhatsApp()} disabled={syncingWhatsApp}><RefreshCw size={16} className={syncingWhatsApp ? 'spin' : ''} />{syncingWhatsApp ? 'Sincronizando...' : 'Sincronizar WhatsApp'}</button>
        <button type="button" className="outline" onClick={() => void markAllRead()} disabled={markingAllRead}><CheckCheck size={16} />{markingAllRead ? 'Marcando...' : 'Marcar todas como lidas'}</button>
        <button type="button" className="outline" onClick={() => void openNewConversation()}><MessageCircle size={16} />Nova conversa</button>
      </div>
    </div>

    <div className="chat-beta-layout">
      <aside className="chat-beta-list panel">
        <div className="chat-beta-list-head">
          <div><h2>Conversas</h2><span>{conversations.length} atendimento(s)</span></div>
          <div className="chat-beta-more-wrap">
            <button type="button" className="chat-beta-icon-button" title="Mais opções" aria-label="Mais opções" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen(current => !current)}><MoreHorizontal size={18} /></button>
            {conversationMenuOpen && <div className="chat-beta-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setConversationMenuOpen(false); void markAllRead() }} disabled={markingAllRead}><CheckCheck size={15} />{markingAllRead ? 'Marcando...' : 'Marcar tudo como lido'}{unreadCount > 0 && <b>{unreadCount}</b>}</button>
              <button type="button" role="menuitem" onClick={() => { setConversationMenuOpen(false); void loadConversations() }}><RefreshCw size={15} />Atualizar conversas</button>
            </div>}
          </div>
        </div>
        <label className="chat-beta-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar conversa..." /></label>
        <div className="chat-beta-filters" role="tablist" aria-label="Filtros de conversa">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <b>{conversations.length}</b></button>
          <button type="button" className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Não lidas <b>{unreadCount}</b></button>
          <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Abertas</button>
        </div>
        <div className="chat-beta-conversation-list">
          {apiState === 'loading' && !conversations.length ? <div className="chat-beta-empty-list"><Clock size={24} /><b>Carregando conversas...</b><span>Consultando o backend do Fix.io.</span></div> : visibleConversations.length ? visibleConversations.map(conversation => <div key={conversation.id} className={`chat-beta-conversation ${String(selected?.id) === String(conversation.id) ? 'selected' : ''}${Number(conversation.is_pinned) ? ' pinned' : ''}`}>
            <button type="button" className="chat-beta-conversation-main" onClick={() => setSelectedId(conversation.id)}><ChatAvatar conversation={conversation} /><span className="chat-beta-conversation-copy"><b>{conversation.client_name}</b><small>{conversation.last_message || 'Nenhuma mensagem ainda.'}</small><em>{formatOrder(conversation)} · {conversation.status === 'closed' ? 'encerrada' : 'aberta'}</em></span><span className="chat-beta-conversation-meta"><small>{formatTime(conversation.last_message_at || conversation.created_at)}</small>{Number(conversation.unread_count) > 0 && <b>{conversation.unread_count}</b>}</span></button>
            <button type="button" className="chat-beta-pin-button" title={Number(conversation.is_pinned) ? 'Desafixar conversa' : 'Fixar conversa'} onClick={() => void togglePin(conversation)}>{Number(conversation.is_pinned) ? <PinOff size={14} /> : <Pin size={14} />}</button>
          </div>) : <div className="chat-beta-empty-list"><Search size={24} /><b>{error || 'Nenhuma conversa encontrada'}</b><span>{error ? 'Verifique a API e tente atualizar.' : 'As conversas criadas no backend aparecerão aqui.'}</span></div>}
        </div>
      </aside>

      <section className="chat-beta-thread panel">
        {selected ? <>
          <header className="chat-beta-thread-head">
            <div className="chat-beta-thread-person"><ChatAvatar conversation={selected} large /><div><h2>{selected.client_name}</h2><span><i className={`chat-beta-status-dot ${selected.status === 'closed' ? 'offline' : 'online'}`} />{selected.status === 'closed' ? 'Atendimento encerrado' : 'Atendimento aberto'} · {displayPhone(selected.client_phone)}</span></div></div>
            <div className="chat-beta-thread-actions">{!Number(selected.is_registered_client) && !String(selected.client_phone || '').endsWith('@g.us') && <button type="button" className="chat-beta-register-button" onClick={openRegisterClient}><UserPlus size={15} />Cadastrar cliente</button>}<button type="button" className="chat-beta-icon-button" title="Ligar para cliente" disabled={!selected.client_phone}><Phone size={17} /></button><button type="button" className="chat-beta-icon-button" title="Mais opções"><MoreHorizontal size={18} /></button></div>
          </header>
          <div className="chat-beta-thread-context"><ClipboardList size={16} /><span><b>OS {formatOrder(selected)}</b><small>{selected.service_order_status || 'Conversa sem OS vinculada'}</small></span><button type="button" className="text-button" disabled={!selected.service_order_number} onClick={() => openOrder?.(selected.service_order_number)}>Abrir OS <ChevronDown size={14} /></button></div>
          <div className="chat-beta-messages" ref={messagesContainerRef}>
            <div className="chat-beta-day-divider"><span>Histórico</span></div>
            {loadingMessages ? <div className="chat-beta-message-loading"><Clock size={18} />Carregando mensagens...</div> : messages.length ? messages.map(message => <div key={message.id} className={`chat-beta-message-row ${message.sender_type === 'admin' ? 'outgoing' : 'incoming'}`}><div className="chat-beta-message"><MessageContent message={message} /><small>{formatTime(message.created_at)}{message.sender_type === 'admin' && <CheckCheck size={13} className="read" />}</small></div></div>) : <div className="chat-beta-message-loading"><MessageCircle size={22} />Nenhuma mensagem nesta conversa ainda.</div>}
            {messageError && <div className="chat-beta-message-error"><AlertTriangle size={15} />{messageError}</div>}
          </div>
          <form className="chat-beta-composer" onSubmit={sendMessage}>
            <div className="chat-beta-composer-tools"><button type="button" className="chat-beta-icon-button" title="Anexar arquivo" disabled><Paperclip size={18} /></button><button type="button" className="chat-beta-icon-button" title="Adicionar imagem" disabled><Image size={18} /></button></div>
            <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder={selected.status === 'closed' ? 'Reabra a conversa para responder...' : 'Escreva uma mensagem...'} rows="1" disabled={selected.status === 'closed' || sending} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event) } }} />
            <button type="button" className="chat-beta-icon-button" title="Emojis" disabled><Smile size={18} /></button><button className="primary chat-beta-send" disabled={!draft.trim() || selected.status === 'closed' || sending} title="Enviar mensagem">{sending ? <Clock size={16} /> : <Send size={16} />}</button>
          </form>
        </> : <div className="chat-beta-empty-thread"><MessageCircle size={38} /><h2>Selecione uma conversa</h2><p>Escolha um atendimento à esquerda para visualizar as mensagens.</p></div>}
      </section>

      <aside className="chat-beta-details panel">
        {selected ? <>
          <div className="chat-beta-details-head"><h2>Detalhes</h2><button type="button" className="chat-beta-icon-button" title="Mais opções"><MoreHorizontal size={18} /></button></div>
          <div className="chat-beta-contact"><ChatAvatar conversation={selected} large /><h3>{selected.client_name}</h3><span>{displayPhone(selected.client_phone)}</span><small><i className={`chat-beta-status-dot ${selected.status === 'closed' ? 'offline' : 'online'}`} />{Number(selected.is_registered_client) ? 'Cliente cadastrado' : 'Contato do WhatsApp'}</small>{!Number(selected.is_registered_client) && !String(selected.client_phone || '').endsWith('@g.us') && <button type="button" className="primary chat-beta-register-wide" onClick={openRegisterClient}><UserPlus size={15} />Cadastrar cliente</button>}</div>
          <div className="chat-beta-detail-section"><div className="chat-beta-section-label"><ClipboardList size={15} /><span>Ordem vinculada</span></div><div className="chat-beta-order-card"><div><b>{formatOrder(selected)}</b><small>{selected.service_order_status || 'Sem ordem vinculada'}</small></div><button type="button" className="chat-beta-link-button" disabled={!selected.service_order_number} onClick={() => openOrder?.(selected.service_order_number)}>Ver OS</button></div></div>
          <div className="chat-beta-detail-section"><div className="chat-beta-section-label"><UserRound size={15} /><span>{Number(selected.is_registered_client) ? 'Dados do cliente' : 'Dados do contato'}</span></div><dl><div><dt>Telefone</dt><dd>{displayPhone(selected.client_phone)}</dd></div><div><dt>E-mail</dt><dd>{selected.client_email || 'Não informado'}</dd></div><div><dt>Documento</dt><dd>{selected.client_document || 'Não informado'}</dd></div></dl></div>
          <div className="chat-beta-detail-section"><div className="chat-beta-section-label"><Clock size={15} /><span>Integração</span></div><div className="chat-beta-next-step"><span>{Number(selected.is_registered_client) ? 'Cliente vinculado' : 'Contato não cadastrado'}</span><small>{Number(selected.is_registered_client) ? 'Este contato já está vinculado ao cadastro de clientes.' : 'As mensagens ficam disponíveis no WhatsApp sem criar cliente.'}</small></div></div>
        </> : <div className="chat-beta-empty-details"><UserRound size={24} /><span>Os dados do cliente aparecerão aqui.</span></div>}
      </aside>
    </div>
    {newConversationOpen && <div className="chat-beta-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNewConversationOpen(false) }}>
      <form className="panel chat-beta-new-conversation" onSubmit={createConversation}>
        <div className="chat-beta-new-conversation-head"><div><p className="eyebrow">ATENDIMENTO</p><h2>Nova conversa</h2><p>Escolha o cliente e, opcionalmente, associe uma OS.</p></div><button type="button" className="chat-beta-icon-button" onClick={() => setNewConversationOpen(false)}><span aria-hidden="true">×</span></button></div>
        <label className="chat-beta-form-field"><span>Cliente cadastrado <small>(opcional)</small></span><select value={newClientId} onChange={event => { setNewClientId(event.target.value); setNewOrderId('') }}><option value="">Novo número do WhatsApp</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` · ${client.phone}` : ''}</option>)}</select></label>
        {!newClientId && <><label className="chat-beta-form-field"><span>Nome do contato</span><input value={newContactName} onChange={event => setNewContactName(event.target.value)} placeholder="Ex.: João da Silva" /></label><label className="chat-beta-form-field"><span>Telefone WhatsApp</span><input value={newContactPhone} onChange={event => setNewContactPhone(event.target.value)} placeholder="Ex.: 44999999999" inputMode="tel" required /></label></>}
        <label className="chat-beta-form-field"><span>OS vinculada <small>(opcional)</small></span><select value={newOrderId} onChange={event => setNewOrderId(event.target.value)} disabled={!newClientId}><option value="">Sem OS vinculada</option>{orders.filter(order => String(order.client_id) === String(newClientId)).map(order => <option key={order.id} value={order.id}>#{order.id} · {order.problem_description}</option>)}</select></label>
        {error && <p className="chat-beta-modal-error"><AlertTriangle size={15} />{error}</p>}
        <div className="chat-beta-new-conversation-footer"><button type="button" className="outline" onClick={() => setNewConversationOpen(false)}>Cancelar</button><button className="primary" disabled={(!newClientId && !newContactPhone.trim()) || creatingConversation}>{creatingConversation ? 'Criando...' : 'Criar conversa'}</button></div>
      </form>
    </div>}
    {registerOpen && selected && <div className="chat-beta-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setRegisterOpen(false) }}>
      <form className="panel chat-beta-new-conversation" onSubmit={registerClient}>
        <div className="chat-beta-new-conversation-head"><div><p className="eyebrow">CLIENTE</p><h2>Cadastrar cliente</h2><p>O contato do WhatsApp será vinculado ao cadastro do Fix.io.</p></div><button type="button" className="chat-beta-icon-button" onClick={() => setRegisterOpen(false)}><span aria-hidden="true">×</span></button></div>
        <label className="chat-beta-form-field"><span>Nome</span><input value={registerName} onChange={event => setRegisterName(event.target.value)} placeholder="Nome do cliente" required /></label>
        <label className="chat-beta-form-field"><span>Telefone WhatsApp</span><input value={displayPhone(selected.client_phone)} readOnly /></label>
        <label className="chat-beta-form-field"><span>E-mail <small>(opcional)</small></span><input type="email" value={registerEmail} onChange={event => setRegisterEmail(event.target.value)} placeholder="cliente@email.com" /></label>
        <label className="chat-beta-form-field"><span>CPF/CNPJ <small>(opcional)</small></span><input value={registerDocument} onChange={event => setRegisterDocument(event.target.value)} placeholder="Documento do cliente" /></label>
        {error && <p className="chat-beta-modal-error"><AlertTriangle size={15} />{error}</p>}
        <div className="chat-beta-new-conversation-footer"><button type="button" className="outline" onClick={() => setRegisterOpen(false)}>Cancelar</button><button className="primary" disabled={!registerName.trim() || registering}>{registering ? 'Cadastrando...' : 'Cadastrar cliente'}</button></div>
      </form>
    </div>}
  </section>
}

export { ChatBetaWorkspace }
