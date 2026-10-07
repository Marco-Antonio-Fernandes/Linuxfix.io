import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCheck, ChevronDown, ClipboardList, Clock, Download, Image, MessageCircle, MoreHorizontal, Paperclip, Phone, Pin, PinOff, RefreshCw, Search, Send, Smile, Trash2, UserPlus, UserRound, Volume2, VolumeX, X } from 'lucide-react'
import './chat-beta.css'
import { loadWhatsappOfflineSnapshot, removeWhatsappOutbox, saveWhatsappConversations, saveWhatsappMessages, saveWhatsappOutbox } from './whatsapp-offline.js'
import { loadClearedWhatsappConversations, loadMutedWhatsappConversations, markWhatsappConversationCleared, saveMutedWhatsappConversations } from './whatsapp-preferences.js'

const API = (import.meta.env.VITE_API_URL || 'https://backfixio.rotatix.com.br').replace(/\/$/, '')

async function chatApi(path, options = {}) {
  const token = localStorage.getItem('fixio_token')
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const exception = Error(data?.error || 'Não foi possível conectar ao chat.')
    exception.status = response.status
    throw exception
  }
  return data
}

const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(item => item[0]).join('').toUpperCase()
const avatarColors = ['mint', 'blue', 'purple', 'orange']
const avatarColor = id => avatarColors[Math.abs(Number(id) || String(id || '').length) % avatarColors.length]
const isWhatsappIdentifier = value => {
  const text = String(value || '').trim()
  return !text || /@(lid|s\.whatsapp\.net|g\.us)$/i.test(text) || /^\+?[\d\s().-]{8,}$/.test(text)
}
const conversationName = conversation => {
  const candidates = Number(conversation?.is_registered_client) ? [conversation?.client_name, conversation?.whatsapp_name] : [conversation?.whatsapp_name, conversation?.client_name]
  const usable = candidates.find(value => !isWhatsappIdentifier(value))
  if (usable) return String(usable).trim()
  return String(conversation?.whatsapp_jid || '').endsWith('@g.us') ? 'Grupo do WhatsApp' : 'Contato do WhatsApp'
}
const displayPhone = value => {
  const raw = String(value || '')
  if (raw.endsWith('@g.us')) return 'Grupo do WhatsApp'
  if (/@lid$/i.test(raw)) return 'Contato do WhatsApp'
  return raw.replace(/@s\.whatsapp\.net$/, '') || 'Telefone não informado'
}
const formatCpf = value => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11)
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
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
const formatMessageTime = value => {
  if (!value) return '—'
  const date = parseFixioDate(value)
  if (!date) return String(value)
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FIXIO_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date)
}
const compareMessages = (left, right) => {
  const leftDate = parseFixioDate(left?.created_at)
  const rightDate = parseFixioDate(right?.created_at)
  if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime()) return leftDate.getTime() - rightDate.getTime()
  if (leftDate && !rightDate) return -1
  if (!leftDate && rightDate) return 1
  const leftId = Number(left?.id)
  const rightId = Number(right?.id)
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) return leftId - rightId
  return String(left?.id || '').localeCompare(String(right?.id || ''))
}
const sortMessages = rows => [...(Array.isArray(rows) ? rows : [])].sort(compareMessages)
const messageWasCleared = (message, clearedAt) => {
  if (!clearedAt) return false
  const cutoff = parseFixioDate(clearedAt)
  if (!cutoff) return false
  const createdAt = parseFixioDate(message?.created_at)
  return !createdAt || createdAt.getTime() <= cutoff.getTime()
}
const pollPrefix = '[FIXIO_POLL]'
const parsePoll = message => {
  if (message?.poll && typeof message.poll === 'object') return message.poll
  const body = String(message?.body || '')
  if (/^\[(?:poll|enquete)\b[^\]]*\]$/i.test(body) || /^(?:poll|enquete)\b.*(?:received|recebida|recebido)/i.test(body)) return { question: 'Enquete recebida', options: [], selectableOptionsCount: 1 }
  if (!body.startsWith(pollPrefix)) return null
  try {
    const value = JSON.parse(body.slice(pollPrefix.length))
    if (!value || typeof value !== 'object') return null
    return { question: String(value.question || 'Enquete do WhatsApp'), options: Array.isArray(value.options) ? value.options : [], selectableOptionsCount: Number(value.selectableOptionsCount || 1) }
  } catch {
    return null
  }
}
const messagePreview = message => {
  const poll = parsePoll(message)
  return poll ? `Enquete: ${poll.question}` : String(message?.body || '')
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

  return <span className={`chat-beta-avatar ${avatarColor(conversation?.id)}${large ? ' large' : ''}`}>{src ? <img src={src} alt="" /> : initials(conversationName(conversation))}</span>
}

const RegisterClientModal = memo(function RegisterClientModal({ selected, registering, error, onClose, onSubmit }) {
  const [name, setName] = useState(() => conversationName(selected))
  const [email, setEmail] = useState(() => selected?.client_email || '')
  const [document, setDocument] = useState(() => formatCpf(selected?.client_document || ''))

  const submit = event => {
    event.preventDefault()
    onSubmit({ name, email, document })
  }

  return <div className="chat-beta-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <form className="panel chat-beta-new-conversation" onSubmit={submit}>
      <div className="chat-beta-new-conversation-head"><div><p className="eyebrow">CLIENTE</p><h2>Cadastrar cliente</h2><p>O contato do WhatsApp será vinculado ao cadastro do Fix.io.</p></div><button type="button" className="chat-beta-icon-button" onClick={onClose}><span aria-hidden="true">×</span></button></div>
      <label className="chat-beta-form-field"><span>Nome</span><input value={name} onChange={event => setName(event.target.value)} placeholder="Nome do cliente" required /></label>
      <label className="chat-beta-form-field"><span>Telefone WhatsApp</span><input value={displayPhone(selected?.client_phone)} readOnly /></label>
      <label className="chat-beta-form-field"><span>E-mail <small>(opcional)</small></span><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="cliente@email.com" /></label>
      <label className="chat-beta-form-field"><span>CPF</span><input value={document} onChange={event => setDocument(formatCpf(event.target.value))} placeholder="000.000.000-00" inputMode="numeric" maxLength={14} required /></label>
      {error && <p className="chat-beta-modal-error"><AlertTriangle size={15} />{error}</p>}
      <div className="chat-beta-new-conversation-footer"><button type="button" className="outline" onClick={onClose}>Cancelar</button><button className="primary" disabled={!name.trim() || !document.trim() || registering}>{registering ? 'Cadastrando...' : 'Cadastrar cliente'}</button></div>
    </form>
  </div>
})

function WhatsAppMedia({ message }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const mediaPath = String(message?.media_url || '').trim()

  useEffect(() => {
    if (!mediaPath) return undefined
    setSrc('')
    setFailed(false)
    const controller = new AbortController()
    let objectUrl = ''
    const token = localStorage.getItem('fixio_token')
    const mediaUrl = mediaPath.startsWith('/uploads/') ? `${API}${mediaPath}` : `${API}/api/integrations/whatsapp/media?path=${encodeURIComponent(mediaPath)}`
    fetch(mediaUrl, {
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
  const sentLabel = message?.sender_type === 'admin'
  if (type.includes('audio') || type.includes('voice')) return <div className="chat-beta-audio-card"><div className="chat-beta-media-heading"><span className="chat-beta-media-icon"><Volume2 size={17} /></span><span><b>{sentLabel ? 'Áudio enviado' : 'Áudio recebido'}</b><small>Mensagem de voz do WhatsApp</small></span></div><audio className="chat-beta-audio" controls src={src} /></div>
  if (type.includes('image') || type.includes('sticker')) return <>
    <div className="chat-beta-media-card">
      <div className="chat-beta-media-heading"><span className="chat-beta-media-icon"><Image size={16} /></span><b>{sentLabel ? 'Imagem enviada' : 'Imagem recebida'}</b></div>
      <button type="button" className="chat-beta-image-button" title="Abrir imagem" onClick={() => setPreviewOpen(true)}><img className="chat-beta-image" src={src} alt={message.media_name || (sentLabel ? 'Imagem enviada' : 'Imagem recebida')} /></button>
    </div>
    {previewOpen && <div className="chat-beta-image-modal" role="dialog" aria-modal="true" aria-label="Visualização da imagem" onClick={() => setPreviewOpen(false)}>
      <div className="chat-beta-image-preview" onClick={event => event.stopPropagation()}>
        <div className="chat-beta-image-preview-actions">
          <a className="chat-beta-image-download" href={src} download={message.media_name || 'imagem-whatsapp'}><Download size={16} />Baixar</a>
          <button type="button" className="chat-beta-image-close" title="Fechar imagem" onClick={() => setPreviewOpen(false)}><X size={19} /></button>
        </div>
        <img src={src} alt={message.media_name || (sentLabel ? 'Imagem enviada' : 'Imagem recebida')} />
      </div>
    </div>}
  </>
  if (type.includes('video')) return <div className="chat-beta-media-card"><div className="chat-beta-media-heading"><span className="chat-beta-media-icon"><MessageCircle size={16} /></span><b>{sentLabel ? 'Vídeo enviado' : 'Vídeo recebido'}</b></div><video className="chat-beta-video" controls src={src} /></div>
  return <a className="chat-beta-media-link" href={src} target="_blank" rel="noreferrer" download={message.media_name || undefined}>Abrir arquivo recebido</a>
}

function WhatsAppPoll({ poll }) {
  const options = Array.isArray(poll?.options) ? poll.options : []
  return <div className="chat-beta-poll-card"><div className="chat-beta-poll-heading"><span>ENQUETE</span><b>{poll?.question || 'Enquete do WhatsApp'}</b></div>{options.length ? <div className="chat-beta-poll-options">{options.map((option, index) => { const label = typeof option === 'string' ? option : option?.label || option?.optionName || `Opção ${index + 1}`; const votes = typeof option === 'object' && Number.isFinite(Number(option?.votes)) ? ` · ${option.votes} voto(s)` : ''; return <div className="chat-beta-poll-option" key={`${label}-${index}`}><i /> <span>{label}</span><small>{votes}</small></div> })}</div> : <small className="chat-beta-poll-missing">As opções não vieram no histórico recebido.</small>}<small className="chat-beta-poll-foot">Enquete recebida do WhatsApp · não é possível votar por este painel</small></div>
}

function MessageContent({ message }) {
  const poll = parsePoll(message)
  if (poll) return <WhatsAppPoll poll={poll} />
  const body = String(message?.body || '')
  const mediaType = String(message?.media_type || '').toLowerCase()
  const isViewOnce = /visualiza(?:ção|cao) única|view[ _-]?once|single[ _-]?view/i.test(body) || /view[ _-]?once|single[ _-]?view/i.test(mediaType)
  const viewOnceBody = isViewOnce ? (mediaType.includes('video') ? 'Vídeo de visualização única' : 'Foto de visualização única') : body
  const isMediaPlaceholder = !isViewOnce && /^\[(image|audio|voice|video|sticker|document|contact|location) recebido\]$/i.test(body)
  const placeholderBody = isMediaPlaceholder ? ({ image: 'Imagem recebida', audio: 'Áudio recebido', voice: 'Áudio recebido', video: 'Vídeo recebido', sticker: 'Figurinha recebida', document: 'Documento recebido', contact: 'Contato recebido', location: 'Localização recebida' }[body.slice(1, body.indexOf(' ')).toLowerCase()] || 'Mídia recebida') : ''
  const isSentMediaPlaceholder = Boolean(message?.media_url) && message?.sender_type === 'admin' && /^\[(imagem|vídeo|audio|áudio|arquivo) enviada?o?\]$/i.test(body)
  return <>
    {!isViewOnce && message?.media_url && <WhatsAppMedia message={message} />}
    {(viewOnceBody || placeholderBody) && !isSentMediaPlaceholder && <p>{viewOnceBody || placeholderBody}</p>}
  </>
}

function ChatBetaWorkspace({ openOrder, initialClientId = null }) {
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
  const [attachment, setAttachment] = useState(null)
  const [registering, setRegistering] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [clearingConversation, setClearingConversation] = useState(false)
  const [mutedConversations, setMutedConversations] = useState(() => loadMutedWhatsappConversations())
  const [clearedConversations, setClearedConversations] = useState(() => loadClearedWhatsappConversations())
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const messagesContainerRef = useRef(null)
  const fileInputRef = useRef(null)
  const offlineSnapshotRef = useRef({ conversations: [], messages: {}, outbox: [] })
  const outboxRef = useRef([])
  const conversationsRef = useRef([])
  const pendingMessagesRef = useRef(new Map())
  const stickToBottomRef = useRef(true)
  const forceLatestScrollRef = useRef(true)
  const flushingOutboxRef = useRef(false)
  const initialClientAppliedRef = useRef('')

  useEffect(() => {
    const onClientCreated = event => {
      const client = event.detail
      if (!client?.id) return
      setClients(current => {
        const existing = current.find(item => String(item.id) === String(client.id))
        const merged = { ...existing, ...client }
        return [...current.filter(item => String(item.id) !== String(client.id)), merged].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR'))
      })
    }
    window.addEventListener('fixio:client-created', onClientCreated)
    return () => window.removeEventListener('fixio:client-created', onClientCreated)
  }, [])

  const scrollMessagesToLatest = () => {
    const container = messagesContainerRef.current
    if (!container) return
    const latestTop = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = latestTop
    container.scrollTo({ top: latestTop, left: 0, behavior: 'auto' })
    const messageRows = container.querySelectorAll('.chat-beta-message-row')
    messageRows[messageRows.length - 1]?.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' })
  }

  const mergeConversation = (remote, cached) => {
    const merged = { ...cached, ...remote }
    if (isWhatsappIdentifier(remote?.client_name) && !isWhatsappIdentifier(cached?.client_name)) merged.client_name = cached.client_name
    if (!merged.client_name || isWhatsappIdentifier(merged.client_name)) merged.client_name = conversationName(merged)
    return merged
  }

  const withLocalQueue = rows => {
    const cachedById = new Map(offlineSnapshotRef.current.conversations.map(row => [String(row.id), row]))
    const byId = new Map(rows.map(row => {
      const merged = mergeConversation(row, cachedById.get(String(row.id)))
      const clearedAt = clearedConversations[String(row.id)]
      return [String(row.id), clearedAt && messageWasCleared({ created_at: merged.last_message_at }, clearedAt)
        ? { ...merged, last_message: null, last_message_at: null, unread_count: 0 }
        : merged]
    }))
    for (const record of outboxRef.current) {
      const item = byId.get(String(record.conversationId))
      if (item) byId.set(String(record.conversationId), { ...item, last_message: record.body, last_message_at: record.created_at, status: 'open' })
    }
    return [...byId.values()]
  }

  const localMessagesFor = conversationId => {
    const clearedAt = clearedConversations[String(conversationId)]
    const cached = (offlineSnapshotRef.current.messages[String(conversationId)] || []).filter(message => !messageWasCleared(message, clearedAt))
    const queued = outboxRef.current.filter(record => String(record.conversationId) === String(conversationId)).map(record => record.localMessage)
    const pending = [...pendingMessagesRef.current.values()].filter(message => String(message.conversation_id) === String(conversationId))
    const byId = new Map([...cached, ...queued, ...pending].map(message => [String(message.id), message]))
    return sortMessages([...byId.values()])
  }

  const setConversationRows = rows => {
    const merged = withLocalQueue(rows)
    conversationsRef.current = merged
    setConversations(merged)
    void saveWhatsappConversations(merged)
    return merged
  }

  const loadConversations = async ({ silent = false } = {}) => {
    if (!silent) setApiState('loading')
    try {
      const result = await chatApi('/api/conversations')
      const rows = Array.isArray(result) ? result : []
      setConversationRows(rows)
      setSelectedId(current => current && rows.some(item => String(item.id) === String(current)) ? current : rows[0]?.id || null)
      setError('')
      setApiState('ready')
      return rows
    } catch (exception) {
      setApiState(navigator.onLine === false ? 'offline' : 'error')
      if (!conversationsRef.current.length) setError(exception.message)
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

  const flushOutbox = async () => {
    if (navigator.onLine === false || flushingOutboxRef.current || !outboxRef.current.length) return
    flushingOutboxRef.current = true
    try {
      for (const record of [...outboxRef.current]) {
        try {
          const result = await chatApi(`/api/conversations/${record.conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body: record.body, senderName: record.senderName }) })
          pendingMessagesRef.current.delete(record.localMessage.id)
          outboxRef.current = outboxRef.current.filter(item => item.id !== record.id)
          await removeWhatsappOutbox(record.id)
          setMessages(current => current.map(message => message.id === record.localMessage.id ? result : message))
          const cachedMessages = offlineSnapshotRef.current.messages[String(record.conversationId)] || []
          offlineSnapshotRef.current.messages[String(record.conversationId)] = [...cachedMessages.filter(message => message.id !== record.localMessage.id && message.id !== result.id), result]
          void saveWhatsappMessages(record.conversationId, offlineSnapshotRef.current.messages[String(record.conversationId)])
          const merged = setConversationRows(conversationsRef.current.map(item => String(item.id) === String(record.conversationId) ? { ...item, last_message: result.body, last_message_at: result.created_at, status: 'open', unread_count: 0 } : item))
          offlineSnapshotRef.current.conversations = merged
        } catch (exception) {
          if (navigator.onLine === false || /Failed to fetch|NetworkError|Load failed|offline/i.test(String(exception?.message || exception))) break
          outboxRef.current = outboxRef.current.filter(item => item.id !== record.id)
          await removeWhatsappOutbox(record.id)
          pendingMessagesRef.current.delete(record.localMessage.id)
          setMessages(current => current.filter(message => message.id !== record.localMessage.id))
          setMessageError(exception.message)
        }
      }
    } finally {
      flushingOutboxRef.current = false
    }
  }

  useEffect(() => {
    let active = true
    const start = async () => {
      const snapshot = await loadWhatsappOfflineSnapshot()
      if (!active) return
      offlineSnapshotRef.current = snapshot
      outboxRef.current = snapshot.outbox || []
      if (snapshot.conversations.length) {
        const cachedRows = withLocalQueue(snapshot.conversations)
        conversationsRef.current = cachedRows
        setConversations(cachedRows)
        const savedId = localStorage.getItem('fixio.whatsapp.selected')
        setSelectedId(savedId && cachedRows.some(item => String(item.id) === savedId) ? savedId : cachedRows[0]?.id || null)
      }
      await loadConversations({ silent: true })
      void flushOutbox()
    }
    void start()
    let syncTimer
    syncTimer = window.setTimeout(() => { void syncWhatsApp({ silent: true }) }, 350)
    const interval = window.setInterval(() => { void loadConversations({ silent: true }); void flushOutbox() }, 5000)
    const onOnline = () => { setApiState('loading'); void loadConversations({ silent: true }); void flushOutbox() }
    window.addEventListener('online', onOnline)
    return () => {
      active = false
      if (syncTimer) window.clearTimeout(syncTimer)
      window.clearInterval(interval)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const selected = conversations.find(item => String(item.id) === String(selectedId)) || null

  useEffect(() => {
    if (!initialClientId) {
      initialClientAppliedRef.current = ''
      return
    }
    const clientKey = String(initialClientId)
    if (initialClientAppliedRef.current === clientKey) return
    const conversation = conversations.find(item => String(item.client_id) === clientKey)
    if (!conversation) return
    initialClientAppliedRef.current = clientKey
    openConversation(conversation.id)
  }, [initialClientId, conversations])

  useEffect(() => {
    if (!selected) {
      setMessages([])
      return undefined
    }
    forceLatestScrollRef.current = true
    stickToBottomRef.current = true
    localStorage.setItem('fixio.whatsapp.selected', String(selected.id))
    const cachedMessages = localMessagesFor(selected.id)
    setMessages(cachedMessages)
    const scrollTimers = [0, 60, 250, 600].map(delay => window.setTimeout(scrollMessagesToLatest, delay))
    let active = true
    const loadMessages = async (showLoading = false) => {
      if (showLoading) setLoadingMessages(true)
      setMessageError('')
      try {
        const result = await chatApi(`/api/conversations/${selected.id}/messages`)
        if (!active) return
        const clearedAt = clearedConversations[String(selected.id)]
        const serverMessages = sortMessages(result).filter(message => !messageWasCleared(message, clearedAt))
        const localPending = localMessagesFor(selected.id).filter(message => String(message.id).startsWith('local-'))
        const mergedMessages = sortMessages([...serverMessages, ...localPending])
        if (showLoading) {
          forceLatestScrollRef.current = true
          stickToBottomRef.current = true
          window.requestAnimationFrame(scrollMessagesToLatest)
          window.setTimeout(scrollMessagesToLatest, 80)
          window.setTimeout(scrollMessagesToLatest, 300)
        }
        setMessages(mergedMessages)
        offlineSnapshotRef.current.messages[String(selected.id)] = serverMessages
        void saveWhatsappMessages(selected.id, serverMessages)
        setConversations(current => current.map(item => String(item.id) === String(selected.id) ? { ...item, unread_count: 0 } : item))
      } catch (exception) {
        if (active) {
          setApiState(navigator.onLine === false ? 'offline' : apiState)
          setMessageError(navigator.onLine === false ? 'Sem internet. O histórico salvo nesta máquina continua disponível.' : exception.message)
        }
      } finally {
        if (active && showLoading) {
          forceLatestScrollRef.current = true
          stickToBottomRef.current = true
          setLoadingMessages(false)
          window.requestAnimationFrame(() => {
            scrollMessagesToLatest()
            window.requestAnimationFrame(scrollMessagesToLatest)
          })
          window.setTimeout(scrollMessagesToLatest, 120)
        }
      }
    }
    void loadMessages(true)
    const interval = window.setInterval(() => { void loadMessages() }, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
      scrollTimers.forEach(timer => window.clearTimeout(timer))
    }
  }, [selectedId, clearedConversations])

  const latestMessageKey = messages.length ? `${messages[messages.length - 1]?.id}:${messages[messages.length - 1]?.created_at || ''}` : 'empty'
  useLayoutEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return undefined
    const scrollToLatest = () => {
      if (forceLatestScrollRef.current || stickToBottomRef.current) {
        scrollMessagesToLatest()
      }
    }
    const frame = requestAnimationFrame(scrollToLatest)
    const timer = window.setTimeout(scrollToLatest, 250)
    const settleTimer = window.setTimeout(() => {
      scrollToLatest()
      if (!loadingMessages) forceLatestScrollRef.current = false
    }, 1000)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scrollToLatest)
    observer?.observe(container)
    container.querySelectorAll('.chat-beta-message').forEach(message => observer?.observe(message))
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); window.clearTimeout(settleTimer); observer?.disconnect() }
  }, [selectedId, latestMessageKey, messages.length, loadingMessages])

  const trackMessageScroll = event => {
    const container = event.currentTarget
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    stickToBottomRef.current = distanceFromBottom < 80
    if (distanceFromBottom >= 80) forceLatestScrollRef.current = false
  }

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

  const toggleMute = conversation => {
    const id = String(conversation?.id || '')
    if (!id) return
    setMutedConversations(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveMutedWhatsappConversations(next)
      window.dispatchEvent(new CustomEvent('fixio:whatsapp-mute-changed', { detail: { ids: [...next] } }))
      return next
    })
  }

  const clearLocalConversation = async conversationId => {
    const id = String(conversationId)
    const cleared = markWhatsappConversationCleared(id)
    setClearedConversations(cleared)
    const queued = outboxRef.current.filter(record => String(record.conversationId) === id)
    outboxRef.current = outboxRef.current.filter(record => String(record.conversationId) !== id)
    offlineSnapshotRef.current.outbox = outboxRef.current
    for (const record of queued) await removeWhatsappOutbox(record.id)
    for (const [messageId, message] of pendingMessagesRef.current.entries()) {
      if (String(message.conversation_id) === id) pendingMessagesRef.current.delete(messageId)
    }
    offlineSnapshotRef.current.messages[id] = []
    await saveWhatsappMessages(conversationId, [])
    setMessages(current => String(selectedId) === id ? [] : current)
    setConversationRows(conversationsRef.current.map(item => String(item.id) === id ? { ...item, last_message: null, last_message_at: null, unread_count: 0 } : item))
  }

  const clearConversation = async () => {
    if (!selected || clearingConversation) return
    const confirmed = window.confirm(`Limpar todas as mensagens de “${conversationName(selected)}”?\n\nA conversa continuará na lista, mas o histórico será apagado.`)
    if (!confirmed) return
    try {
      setClearingConversation(true)
      setMessageError('')
      if (navigator.onLine === false) {
        await clearLocalConversation(selected.id)
        setSyncMessage('Histórico limpo nesta máquina. Conecte-se à internet para apagar também o histórico remoto.')
      } else {
        try {
          const result = await chatApi(`/api/conversations/${selected.id}/messages`, { method: 'DELETE' })
          await clearLocalConversation(selected.id)
          setSyncMessage(`${Number(result?.deleted || 0)} mensagem(ns) apagada(s) de ${conversationName(selected)}.`)
        } catch (exception) {
          if (![404, 405].includes(Number(exception?.status))) throw exception
          await clearLocalConversation(selected.id)
          setSyncMessage('Histórico limpo nesta máquina. O servidor ainda não oferece exclusão remota; mensagens antigas ficarão ocultas aqui.')
        }
      }
      setConversationMenuOpen(false)
    } catch (exception) {
      setMessageError(exception.message || 'Não foi possível limpar esta conversa.')
    } finally {
      setClearingConversation(false)
    }
  }

  const chooseAttachment = file => {
    if (!file) return
    if (file.size > 64 * 1024 * 1024) {
      setMessageError('O arquivo é grande demais. O limite é 64 MB.')
      return
    }
    setAttachment(file)
    setMessageError('')
  }

  const handlePaste = event => {
    const files = [...(event.clipboardData?.files || [])]
    const image = files.find(file => file.type.startsWith('image/')) || [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (image) {
      event.preventDefault()
      chooseAttachment(image)
    }
  }

  const queueLocalMessage = async (message, senderName) => {
    const record = { id: message.id, conversationId: selected.id, body: message.body, senderName, created_at: message.created_at, localMessage: message }
    outboxRef.current = [...outboxRef.current.filter(item => item.id !== record.id), record]
    offlineSnapshotRef.current.outbox = outboxRef.current
    await saveWhatsappOutbox(record)
    setConversationRows(conversationsRef.current.map(item => String(item.id) === String(selected.id) ? { ...item, last_message: message.body, last_message_at: message.created_at, status: 'open', unread_count: 0 } : item))
  }

  const sendMessage = async event => {
    event.preventDefault()
    const body = draft.trim()
    if ((!body && !attachment) || !selected || sending || selected.status === 'closed') return
    const selectedConversation = selected
    const selectedAttachment = attachment
    if (navigator.onLine === false && selectedAttachment) {
      setMessageError('Anexos precisam de internet para serem enviados. A mensagem de texto pode ser salva agora.')
      return
    }
    const senderName = localStorage.getItem('fixio.technician') || 'Assistência Fix.io'
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic = {
      id: localId,
      conversation_id: selectedConversation.id,
      sender_type: 'admin',
      sender_name: senderName,
      body: body || (selectedAttachment ? '[arquivo enviado]' : ''),
      created_at: new Date().toISOString(),
      delivery_status: navigator.onLine === false ? 'queued' : 'sending',
    }
    pendingMessagesRef.current.set(localId, optimistic)
    setMessages(current => [...current, optimistic])
    setDraft('')
    setAttachment(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (navigator.onLine === false) {
      await queueLocalMessage(optimistic, senderName)
      pendingMessagesRef.current.delete(localId)
      setMessageError('Sem internet: mensagem salva nesta máquina e aguardando conexão.')
      return
    }
    try {
      setSending(true)
      setMessageError('')
      const result = selectedAttachment
        ? await (() => {
          const form = new FormData()
          form.append('file', selectedAttachment)
          form.append('caption', body)
          form.append('senderName', senderName)
          return chatApi(`/api/conversations/${selectedConversation.id}/media`, { method: 'POST', body: form })
        })()
        : await chatApi(`/api/conversations/${selectedConversation.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body, senderName }),
        })
      pendingMessagesRef.current.delete(localId)
      setMessages(current => current.map(message => message.id === localId ? result : message))
      const cachedMessages = offlineSnapshotRef.current.messages[String(selectedConversation.id)] || []
      offlineSnapshotRef.current.messages[String(selectedConversation.id)] = [...cachedMessages.filter(message => message.id !== localId && message.id !== result.id), result]
      void saveWhatsappMessages(selectedConversation.id, offlineSnapshotRef.current.messages[String(selectedConversation.id)])
      setConversationRows(conversationsRef.current.map(item => String(item.id) === String(selectedConversation.id) ? { ...item, last_message: result.body, last_message_at: result.created_at, status: 'open', unread_count: 0 } : item))
    } catch (exception) {
      if (navigator.onLine === false || /Failed to fetch|NetworkError|Load failed|offline/i.test(String(exception?.message || exception))) {
        const queued = { ...optimistic, delivery_status: 'queued' }
        pendingMessagesRef.current.set(localId, queued)
        setMessages(current => current.map(message => message.id === localId ? queued : message))
        await queueLocalMessage(queued, senderName)
        pendingMessagesRef.current.delete(localId)
        setMessageError('Sem internet: mensagem salva nesta máquina e aguardando conexão.')
      } else {
        pendingMessagesRef.current.delete(localId)
        setMessages(current => current.filter(message => message.id !== localId))
        setDraft(body)
        setMessageError(exception.message)
      }
    } finally {
      setSending(false)
    }
  }

  const addClientToDirectory = client => {
    if (!client?.id) return
    window.dispatchEvent(new CustomEvent('fixio:client-created', { detail: client }))
  }

  const openNewConversation = async () => {
    setNewConversationOpen(true)
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
      addClientToDirectory({ id: result.client_id, name: result.client_name || newContactName.trim(), phone: result.client_phone || newContactPhone.trim() })
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
    setError('')
    setRegisterOpen(true)
  }

  const registerClient = async fields => {
    const name = String(fields?.name || '').trim()
    const email = String(fields?.email || '').trim()
    const document = formatCpf(fields?.document || '')
    if (!selected || !name || registering) return
    try {
      setRegistering(true)
      const result = await chatApi(`/api/conversations/${selected.id}/register-client`, {
        method: 'POST',
        body: JSON.stringify({ name, email: email || null, document: document || null }),
      })
      setConversationRows(conversationsRef.current.map(item => String(item.id) === String(selected.id) ? { ...item, ...result, is_registered_client: 1, client_name: result.client_name || name, client_phone: result.client_phone || selected.client_phone } : item))
      addClientToDirectory({ id: result.client_id, name: result.client_name || name, phone: result.client_phone || selected.client_phone, ...(email ? { email } : {}), ...(document ? { document } : {}) })
      setRegisterOpen(false)
      setSyncMessage(`${name} foi cadastrado como cliente.`)
      setError('')
    } catch (exception) {
      setError(exception.message)
    } finally {
      setRegistering(false)
    }
  }

  const connectionLabel = apiState === 'ready' ? 'Servidor conectado' : apiState === 'offline' ? 'Modo offline' : apiState === 'error' ? 'Servidor indisponível' : 'Conectando ao servidor'
  const openConversation = conversationId => {
    forceLatestScrollRef.current = true
    stickToBottomRef.current = true
    setSelectedId(conversationId)
    window.requestAnimationFrame(scrollMessagesToLatest)
    window.setTimeout(scrollMessagesToLatest, 80)
    window.setTimeout(scrollMessagesToLatest, 300)
  }

  return <section className="chat-beta-workspace">
    <div className="chat-beta-titlebar">
      <div>
        <div className="chat-beta-kicker"><MessageCircle size={15} /> INTEGRAÇÃO <span>WHATSAPP</span></div>
        <h1>Chat de integração</h1>
        <p>Consulte a conversa, responda pelo Chat e vincule o contato a uma ordem de serviço.</p>
      </div>
      <div className="chat-beta-title-actions">
        <span className={`chat-beta-connection ${apiState}`} title="Indica a conexão com o servidor do Fix.io; o envio real é confirmado ao mandar a mensagem"><i />{connectionLabel}</span>
        <button type="button" className="outline" onClick={() => void syncWhatsApp()} disabled={syncingWhatsApp}><RefreshCw size={16} className={syncingWhatsApp ? 'spin' : ''} />{syncingWhatsApp ? 'Atualizando...' : 'Atualizar conversas'}</button>
      </div>
    </div>

    <div className="chat-beta-layout">
      <aside className="chat-beta-list panel">
        <div className="chat-beta-list-head">
          <div><h2>Conversas</h2><span>{conversations.length} atendimento(s)</span></div>
          <div className="chat-beta-more-wrap">
            <button type="button" className="chat-beta-icon-button" title="Mais opções" aria-label="Mais opções" aria-expanded={conversationMenuOpen} onClick={() => setConversationMenuOpen(current => !current)}><MoreHorizontal size={18} /></button>
            {conversationMenuOpen && <div className="chat-beta-more-menu" role="menu">
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
          {apiState === 'loading' && !conversations.length ? <div className="chat-beta-empty-list"><Clock size={24} /><b>Carregando conversas...</b><span>Consultando o backend do Fix.io.</span></div> : visibleConversations.length ? visibleConversations.map(conversation => <div key={conversation.id} className={`chat-beta-conversation ${String(selected?.id) === String(conversation.id) ? 'selected' : ''}${Number(conversation.is_pinned) ? ' pinned' : ''}${Number(conversation.unread_count) > 0 ? ' has-unread' : ''}${mutedConversations.has(String(conversation.id)) ? ' muted' : ''}`}>
            <button type="button" className="chat-beta-conversation-main" onClick={() => openConversation(conversation.id)}><ChatAvatar conversation={conversation} /><span className="chat-beta-conversation-copy"><b>{conversationName(conversation)}</b><small>{messagePreview({ body: conversation.last_message }) || 'Nenhuma mensagem ainda.'}</small><em>{formatOrder(conversation)} · {conversation.status === 'closed' ? 'encerrada' : 'aberta'}</em></span><span className="chat-beta-conversation-meta"><small>{formatTime(conversation.last_message_at || conversation.created_at)}</small>{Number(conversation.unread_count) > 0 && <b>{conversation.unread_count}</b>}</span></button>
            <button type="button" className="chat-beta-mute-button" title={mutedConversations.has(String(conversation.id)) ? 'Ativar som desta conversa' : 'Silenciar conversa'} onClick={() => toggleMute(conversation)}>{mutedConversations.has(String(conversation.id)) ? <VolumeX size={14} /> : <Volume2 size={14} />}</button><button type="button" className="chat-beta-pin-button" title={Number(conversation.is_pinned) ? 'Desafixar conversa' : 'Fixar conversa'} onClick={() => void togglePin(conversation)}>{Number(conversation.is_pinned) ? <PinOff size={14} /> : <Pin size={14} />}</button>
          </div>) : <div className="chat-beta-empty-list"><Search size={24} /><b>{error || 'Nenhuma conversa encontrada'}</b><span>{error ? 'Verifique a API e tente atualizar.' : 'As conversas criadas no backend aparecerão aqui.'}</span></div>}
        </div>
      </aside>

      <section className="chat-beta-thread panel">
        {selected ? <>
          <header className="chat-beta-thread-head">
            <div className="chat-beta-thread-person"><ChatAvatar conversation={selected} large /><div><h2>{conversationName(selected)}</h2><span><i className={`chat-beta-status-dot ${selected.status === 'closed' ? 'offline' : 'online'}`} />{selected.status === 'closed' ? 'Atendimento encerrado' : 'Atendimento aberto'} · {displayPhone(selected.client_phone)}</span></div></div>
            <div className="chat-beta-thread-actions">{!Number(selected.is_registered_client) && !String(selected.client_phone || '').endsWith('@g.us') && <button type="button" className="chat-beta-register-button" onClick={openRegisterClient}><UserPlus size={15} />Cadastrar cliente</button>}</div>
          </header>
          <div className="chat-beta-thread-context"><ClipboardList size={16} /><span><b>OS {formatOrder(selected)}</b><small>{selected.service_order_status || 'Conversa sem OS vinculada'}</small></span><button type="button" className="text-button" disabled={!selected.service_order_number} onClick={() => openOrder?.(selected.service_order_number)}>Abrir OS <ChevronDown size={14} /></button></div>
          <div className="chat-beta-messages" ref={messagesContainerRef} onScroll={trackMessageScroll}>
            <div className="chat-beta-day-divider"><span>Histórico</span></div>
            {loadingMessages ? <div className="chat-beta-message-loading"><Clock size={18} />Carregando mensagens...</div> : messages.length ? messages.map(message => <div key={message.id} className={`chat-beta-message-row ${message.sender_type === 'admin' ? 'outgoing' : 'incoming'}`}><div className="chat-beta-message"><MessageContent message={message} /><small>{formatMessageTime(message.created_at)}{message.sender_type === 'admin' && (message.delivery_status === 'queued' ? <span className="chat-beta-message-queued" title="Salva nesta máquina; aguardando internet">⏳ aguardando internet</span> : message.delivery_status === 'sending' ? <span className="chat-beta-message-queued">Enviando…</span> : <CheckCheck size={13} className="read" />)}</small></div></div>) : <div className="chat-beta-message-loading"><MessageCircle size={22} />Nenhuma mensagem nesta conversa ainda.</div>}
            {messageError && <div className="chat-beta-message-error"><AlertTriangle size={15} />{messageError}</div>}
          </div>
          <form className="chat-beta-composer" onSubmit={sendMessage}>
            <div className="chat-beta-compose-input">
              {attachment && <div className="chat-beta-attachment"><Paperclip size={13} /><b>{attachment.name}</b><small>{Math.ceil(attachment.size / 1024)} KB</small><button type="button" title="Remover anexo" aria-label="Remover anexo" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = '' }}><X size={13} /></button></div>}
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendMessage(event)
                  }
                }}
                placeholder={selected.status === 'closed' ? 'Atendimento encerrado' : 'Digite uma mensagem...'}
                aria-label="Mensagem para o cliente"
                disabled={sending || selected.status === 'closed'}
                rows="1"
              />
            </div>
            <div className="chat-beta-composer-tools">
              <input ref={fileInputRef} className="chat-beta-file-input" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={event => chooseAttachment(event.target.files?.[0])} />
              <button type="button" className="chat-beta-icon-button" title="Anexar arquivo" aria-label="Anexar arquivo" onClick={() => fileInputRef.current?.click()} disabled={sending || selected.status === 'closed'}><Paperclip size={17} /></button>
              <button type="submit" className="primary chat-beta-send" title="Enviar mensagem" aria-label="Enviar mensagem" disabled={sending || selected.status === 'closed' || (!draft.trim() && !attachment)}>{sending ? <Clock size={16} className="spin" /> : <Send size={16} />}</button>
            </div>
          </form>
        </> : <div className="chat-beta-empty-thread"><MessageCircle size={38} /><h2>Selecione uma conversa</h2><p>Escolha um atendimento à esquerda para visualizar as mensagens.</p></div>}
      </section>

      <aside className="chat-beta-details panel">
        {selected ? <>
          <div className="chat-beta-details-head"><h2>Detalhes</h2><button type="button" className="chat-beta-icon-button" title="Mais opções"><MoreHorizontal size={18} /></button></div>
          <div className="chat-beta-contact"><ChatAvatar conversation={selected} large /><h3>{conversationName(selected)}</h3><span>{displayPhone(selected.client_phone)}</span><small><i className={`chat-beta-status-dot ${selected.status === 'closed' ? 'offline' : 'online'}`} />{Number(selected.is_registered_client) ? 'Cliente cadastrado' : 'Contato do WhatsApp'}</small>{!Number(selected.is_registered_client) && !String(selected.client_phone || '').endsWith('@g.us') && <button type="button" className="primary chat-beta-register-wide" onClick={openRegisterClient}><UserPlus size={15} />Cadastrar cliente</button>}</div>
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
    {registerOpen && selected && <RegisterClientModal selected={selected} registering={registering} error={error} onClose={() => setRegisterOpen(false)} onSubmit={registerClient} />}
  </section>
}

export { ChatBetaWorkspace }
