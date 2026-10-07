import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {LayoutDashboard,Users,Laptop,ClipboardList,Plus,ArrowLeft,Save,AlertTriangle,Wrench,ChevronRight,Menu,X,Search,CircleDollarSign,Boxes,LockKeyhole,ArrowUpRight,CheckCircle2,ShieldCheck,MessageCircle,Usb,FileCode2,Bell,MonitorPlay,PlayCircle,Image as ImageIcon} from 'lucide-react'
import './styles.css'
import { AppShell } from './app-shell.jsx'
import { CustomerPortalEnhanced, FinanceWorkspaceEnhanced, FinancialDashboardPanel, InventoryWorkspaceEnhanced, SaleWorkspace } from './workspaces.jsx'
import { AutoAtendeWorkspace } from './auto-atende.jsx'
import { TechUnionWorkspace } from './tech-union.jsx'
import { ChatBetaWorkspace } from './chat-beta.jsx'
import { BoardviewErrorBoundary, BoardviewWorkspace } from './boardview/BoardviewWorkspace.jsx'
import { mergeTimelineNotes } from './timeline.js'
import './dark-theme.css'
import './fixio-brand.css'
import fixioMark from './fixio-mark.svg'
const API=(import.meta.env.VITE_API_URL||'https://backfixio.rotatix.com.br').replace(/\/$/,'')
const AUTH_REFRESH_KEY='fixio_refresh_token'
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(v)||0)/100)
const fmt=v=>v?new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium'}).format(new Date(v)):'—'
let whatsappAudioContext
function playWhatsAppNotificationSound(){
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext
    if(!AudioContextClass)return
    whatsappAudioContext ||= new AudioContextClass()
    const context=whatsappAudioContext
    const play=()=>{
      const now=context.currentTime
      ;[[880,0],[1174.66,0.13],[988,0.28]].forEach(([frequency,offset])=>{
        const gain=context.createGain()
        const oscillator=context.createOscillator()
        oscillator.type='sine'
        oscillator.frequency.setValueAtTime(frequency,now+offset)
        gain.gain.setValueAtTime(0.0001,now+offset)
        gain.gain.exponentialRampToValueAtTime(0.32,now+offset+0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+0.18)
        oscillator.connect(gain).connect(context.destination)
        oscillator.start(now+offset)
        oscillator.stop(now+offset+0.2)
      })
    }
    if(context.state==='suspended')void context.resume().then(play).catch(()=>{})
    else play()
  }catch{}
}
async function api(path,options={}){if(path==='/api/service-orders/intake-device'){const b=JSON.parse(options.body);const device=await api('/api/devices',{method:'POST',body:JSON.stringify({clientId:b.clientId,type:b.deviceType,brand:b.deviceBrand,model:b.deviceModel})});return api('/api/service-orders',{method:'POST',body:JSON.stringify({clientId:b.clientId,deviceId:device.id,problemDescription:b.problemDescription,technicianName:b.technicianName,estimatedDeliveryAt:b.estimatedDeliveryAt,quotedValue:b.quotedValue,estimatedCost:b.estimatedCost,internalNotes:b.internalNotes,checklist:b.checklist})})}if(path==='/api/service-orders/intake-existing'){const b=JSON.parse(options.body);return api('/api/service-orders',{method:'POST',body:JSON.stringify({clientId:b.clientId,deviceId:b.deviceId,problemDescription:b.problemDescription,technicianName:b.technicianName,estimatedDeliveryAt:b.estimatedDeliveryAt,quotedValue:b.quotedValue,estimatedCost:b.estimatedCost,internalNotes:b.internalNotes,checklist:b.checklist})})}if(path==='/api/service-orders/intake'){const b=JSON.parse(options.body);const client=await api('/api/clients',{method:'POST',body:JSON.stringify({name:b.clientName,phone:b.clientPhone,email:b.clientEmail,document:b.clientDocument,birthDate:b.birthDate})});const device=await api('/api/devices',{method:'POST',body:JSON.stringify({clientId:client.id,type:b.deviceType,brand:b.deviceBrand,model:b.deviceModel})});return api('/api/service-orders',{method:'POST',body:JSON.stringify({clientId:client.id,deviceId:device.id,problemDescription:b.problemDescription,technicianName:b.technicianName,estimatedDeliveryAt:b.estimatedDeliveryAt,quotedValue:b.quotedValue,estimatedCost:b.estimatedCost,internalNotes:b.internalNotes,checklist:b.checklist})})}const token=localStorage.getItem('fixio_token');const isForm=typeof FormData!=='undefined'&&options.body instanceof FormData;const headers={...(options.body&&!isForm?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...(options.headers||{})};const r=await fetch(`${API}${path}`,{...options,headers});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.error||'Falha na API');return data}
const fixioOriginalFetch=window.fetch.bind(window)
let authRefreshPromise
const clearAuthStorage=()=>{localStorage.removeItem('fixio_token');localStorage.removeItem(AUTH_REFRESH_KEY);localStorage.removeItem('fixio.session');localStorage.removeItem('fixio.customer_cpf')}
function refreshAuthSession(){
  if(authRefreshPromise)return authRefreshPromise
  const refreshToken=localStorage.getItem(AUTH_REFRESH_KEY)
  if(!refreshToken)return Promise.reject(new Error('Sessão de renovação ausente.'))
  authRefreshPromise=(async()=>{
    const response=await fixioOriginalFetch(`${API}/api/auth/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken})})
    const data=await response.json().catch(()=>null)
    if(!response.ok||!data?.token)throw Error(data?.error||'Não foi possível renovar a sessão.')
    localStorage.setItem('fixio_token',data.token)
    if(data.refreshToken)localStorage.setItem(AUTH_REFRESH_KEY,data.refreshToken)
    return data
  })().finally(()=>{authRefreshPromise=null})
  return authRefreshPromise
}
window.fetch=async(...args)=>{
  let response=await fixioOriginalFetch(...args)
  const request=args[0]
  const url=typeof request==='string'?request:request?.url||''
  const token=localStorage.getItem('fixio_token')
  if(response.status===401&&token&&localStorage.getItem(AUTH_REFRESH_KEY)&&!url.includes('/api/auth/')){
    try{
      await refreshAuthSession()
      const init=args[1]||{}
      const headers=new Headers(init.headers||{})
      headers.set('Authorization',`Bearer ${localStorage.getItem('fixio_token')}`)
      response=await fixioOriginalFetch(request,{...init,headers})
    }catch{
      clearAuthStorage()
      if(!window.__fixioSessionResetting){window.__fixioSessionResetting=true;window.location.reload()}
    }
  }else if(response.status===401&&token&&!url.includes('/api/auth/')){
    clearAuthStorage()
    if(!window.__fixioSessionResetting){window.__fixioSessionResetting=true;window.location.reload()}
  }
  const originalJson=response.json.bind(response)
  response.json=async()=>{
    const data=await originalJson()
    if(data&&Array.isArray(data.timeline))data.timeline=mergeTimelineNotes(data.timeline)
    return data
  }
  return response
}
const status=['Recebido','Em análise','Aguardando aprovação','Aguardando peça','Em manutenção','Testando','Pronto','Aguardando pagamento','Entregue','Cancelado','Sem reparo','Aguardando cliente']
const orderBoardColumns=[
  {key:'Recebido',label:'Recebido',hint:'Entrada e triagem',tone:'blue'},
  {key:'Em análise',label:'Em análise',hint:'Diagnóstico técnico',tone:'indigo'},
  {key:'Aguardando aprovação',label:'Aguardando aprovação',hint:'Cliente precisa aprovar',tone:'yellow'},
  {key:'Aguardando cliente',label:'Aguardando cliente',hint:'Retorno do cliente',tone:'amber'},
  {key:'Aguardando peça',label:'Aguardando peça',hint:'Compra ou entrega',tone:'orange'},
  {key:'Em manutenção',label:'Em manutenção',hint:'Serviço em execução',tone:'purple'},
  {key:'Testando',label:'Testando',hint:'Validação final',tone:'cyan'},
  {key:'Pronto',label:'Pronto',hint:'Aguardando retirada',tone:'green'},
  {key:'Aguardando pagamento',label:'Aguardando pagamento',hint:'Pagamento pendente',tone:'pink'},
  {key:'Entregue',label:'Entregue',hint:'Atendimento concluído',tone:'slate'},
  {key:'Cancelado',label:'Cancelado',hint:'Atendimento encerrado',tone:'red'},
  {key:'Sem reparo',label:'Sem reparo',hint:'Sem solução técnica',tone:'red'},
]
const boardStatusColumn=order=>orderBoardColumns.find(column=>column.key===order.status)||orderBoardColumns.at(-1)
const orderMoveNotePrompts={
  'Em análise':'Registre o diagnóstico inicial, os testes feitos ou o que precisa ser investigado.',
  'Aguardando aprovação':'Explique o que foi enviado para aprovação, como orçamento, prazo ou condição do serviço.',
  'Aguardando cliente':'Registre qual retorno ou informação está pendente com o cliente.',
  'Aguardando peça':'Informe qual peça está sendo aguardada e, se souber, a previsão de chegada.',
  'Em manutenção':'Descreva o serviço que será executado nesta etapa.',
  'Testando':'Registre os testes realizados ou o que ainda precisa ser validado.',
  'Pronto':'Informe o que foi concluído e qualquer orientação para a retirada.',
  'Aguardando pagamento':'Informe o valor ou a condição de pagamento que está pendente.',
  'Entregue':'Registre a entrega, data ou responsável que recebeu o aparelho.',
  'Cancelado':'Informe o motivo do cancelamento.',
  'Sem reparo':'Informe o motivo técnico ou comercial para não realizar o reparo.',
}
function Status({children}){return <span className={`status ${String(children).toLowerCase().replaceAll(' ','-')}`}>{children}</span>}
function Empty({children}){return <div className="empty-state">{children}</div>}
function Field({label,children}){return <label className="form-field"><span>{label}</span>{children}</label>}
const onlyDigits=value=>String(value||'').replace(/\D/g,'')
const formatCpf=value=>{const d=onlyDigits(value).slice(0,11);return d.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/,'$1.$2.$3-$4')}
const formatPhone=value=>{const d=onlyDigits(value).slice(0,11);if(d.length<=10)return d.replace(/^(\d{2})(\d)/,'($1) $2').replace(/^(\(\d{2}\) \d{4})(\d)/,'$1-$2');return d.replace(/^(\d{2})(\d)/,'($1) $2').replace(/^(\(\d{2}\) \d{5})(\d)/,'$1-$2')}
const dateAfterDays=value=>{const days=Number(value);if(!Number.isFinite(days)||days<=0)return null;const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()+Math.round(days));return date.toISOString().slice(0,10)}
function Metric({icon:Icon,label,value,hint,tone='blue'}){return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={20}/></div><div><p>{label}</p><strong>{value}</strong><small>{hint}</small></div></article>}
function OrderExtras({id,onSaved}){
  const[error,setError]=useState(''),[busy,setBusy]=useState(false),[mediaType,setMediaType]=useState('image')
  const sendNote=async event=>{event.preventDefault();const form=event.currentTarget;const fields=new FormData(form);try{setBusy(true);await api(`/api/service-orders/${id}/timeline`,{method:'POST',body:JSON.stringify({eventType:'note',description:fields.get('description'),actorName:localStorage.getItem('fixio.technician')||'Assistência'})});form.reset();setError('');onSaved()}catch(err){setError(err.message)}finally{setBusy(false)}}
  const sendMedia=async event=>{event.preventDefault();const form=event.currentTarget;const fields=new FormData(form);try{setBusy(true);if(mediaType==='youtube'){await api(`/api/service-orders/${id}/media`,{method:'POST',body:JSON.stringify({type:'youtube',url:fields.get('url'),title:fields.get('title'),isClientVisible:fields.get('visible')==='on'})})}else{const files=fields.getAll('files').filter(file=>file instanceof File&&file.size);if(!files.length)throw Error('Selecione ao menos uma imagem.');const upload=new FormData();files.forEach(file=>upload.append('files',file));upload.append('title',String(fields.get('title')||''));upload.append('isClientVisible',fields.get('visible')==='on'?'true':'false');await api(`/api/service-orders/${id}/media/upload`,{method:'POST',body:upload})}form.reset();setMediaType('image');setError('');onSaved()}catch(err){setError(err.message)}finally{setBusy(false)}}
  return <article className="panel info-panel order-extras"><div className="panel-head"><div><h2>Atualizar a OS</h2><p>Registre uma anotação na timeline ou adicione evidências do atendimento.</p></div></div><div className="extras-grid"><form className="annotation-form" onSubmit={sendNote}><b>Anotação na timeline</b><textarea name="description" required rows="5" placeholder="Ex.: Cliente aprovou o orçamento; aguardando a peça chegar..."/><small>Essa anotação ficará disponível para o cliente acompanhar o andamento.</small><button className="primary" disabled={busy}>{busy?'Salvando…':'Adicionar anotação'}</button></form><form className="media-form" onSubmit={sendMedia}><b>Fotos e vídeos</b><select name="type" value={mediaType} onChange={e=>setMediaType(e.target.value)}><option value="image">Anexar fotos</option><option value="youtube">Adicionar link de vídeo</option></select>{mediaType==='youtube'?<input name="url" type="url" required placeholder="https://youtube.com/..."/>:<label className="photo-upload media-file-drop"><ImageIcon size={25}/><span><b>Escolher fotos</b><small>JPG, PNG ou WEBP · até 8 arquivos</small></span><input name="files" type="file" accept="image/*" multiple required/></label>}<input name="title" placeholder="Descrição das fotos ou do vídeo"/><label className="check"><input name="visible" type="checkbox" defaultChecked/> Visível ao cliente</label><button className="outline" disabled={busy}>{busy?'Salvando…':'Adicionar mídia'}</button></form></div>{error&&<p className="form-error">{error}</p>}</article>
}
function Intake({back,done}){const[error,setError]=useState('');const submit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/service-orders/intake',{method:'POST',body:JSON.stringify({clientName:f.get('clientName'),clientPhone:f.get('clientPhone'),clientEmail:f.get('clientEmail'),deviceType:f.get('deviceType'),deviceBrand:f.get('deviceBrand'),deviceModel:f.get('deviceModel'),deviceSerialNumber:f.get('deviceSerialNumber'),problemDescription:f.get('problem'),technicianName:f.get('technician'),estimatedDeliveryAt:dateAfterDays(f.get('completionDays')),quotedValue:f.get('price')||0,estimatedCost:f.get('cost')||0,internalNotes:f.get('notes')})});await done();back()}catch(err){setError(err.message)}};return <><section className="order-top"><button className="back-button" onClick={back}><ArrowLeft size={17}/>Voltar</button></section><section className="order-heading"><div><p className="eyebrow">NOVA ORDEM DE SERVIÇO</p><h1>Registrar atendimento</h1><p className="muted">Cliente e equipamento são cadastrados junto com a OS.</p></div></section><form className="panel register-card polished-form" onSubmit={submit}><div className="form-title"><span className="form-title-icon"><ClipboardList size={20}/></span><div><h2>Entrada do equipamento</h2><p>Um único cadastro para iniciar o atendimento.</p></div></div><div className="form-grid"><Field label="Cliente"><input name="clientName" required placeholder="Nome completo"/></Field><Field label="Telefone"><input name="clientPhone" placeholder="(00) 00000-0000"/></Field><Field label="E-mail"><input name="clientEmail" type="email" placeholder="Opcional"/></Field><Field label="Tipo do equipamento"><select name="deviceType"><option>Notebook</option><option>Computador</option><option>Celular</option><option>Videogame</option></select></Field><Field label="Marca"><input name="deviceBrand" placeholder="Ex.: Dell"/></Field><Field label="Modelo"><input name="deviceModel" placeholder="Ex.: Inspiron 15"/></Field><Field label="Número de série / IMEI"><input name="deviceSerialNumber" placeholder="Opcional"/></Field><Field label="Problema informado"><textarea name="problem" required rows="4" placeholder="Descreva o problema relatado"/></Field><Field label="Técnico"><input name="technician" required/></Field><Field label="Prazo estimado (dias)"><input name="completionDays" type="number" min="1" step="1" placeholder="Ex.: 3"/></Field><Field label="Orçamento"><input name="price" type="number" step="0.01" placeholder="0,00"/></Field><Field label="Custo previsto"><input name="cost" type="number" step="0.01" placeholder="0,00"/></Field><Field label="Observações"><textarea name="notes" rows="3"/></Field></div>{error&&<p className="form-error">{error}</p>}<div className="form-footer"><button type="button" className="outline" onClick={back}>Cancelar</button><button className="primary"><Save size={17}/>Criar OS</button></div></form></>}
function ExistingIntake({back,done,clients,devices}){const[clientId,setClientId]=useState(''),[error,setError]=useState('');const available=devices.filter(d=>String(d.client_id)===String(clientId));const submit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/service-orders/intake-existing',{method:'POST',body:JSON.stringify({clientId:+f.get('clientId'),deviceId:+f.get('deviceId'),problemDescription:f.get('problem'),technicianName:f.get('technician'),estimatedDeliveryAt:dateAfterDays(f.get('completionDays')),quotedValue:f.get('price')||0,estimatedCost:f.get('cost')||0,internalNotes:f.get('notes')})});await done();back()}catch(err){setError(err.message)}};return <><section className="order-top"><button className="back-button" onClick={back}><ArrowLeft size={17}/>Voltar</button></section><section className="order-heading"><div><p className="eyebrow">NOVA ORDEM DE SERVIÇO</p><h1>Usar cadastro existente</h1><p className="muted">Escolha o cliente e um equipamento já cadastrados.</p></div></section><form className="panel register-card polished-form" onSubmit={submit}><div className="form-grid"><Field label="Cliente"><select name="clientId" value={clientId} onChange={e=>setClientId(e.target.value)} required><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Equipamento"><select name="deviceId" required disabled={!clientId}><option value="">Selecione</option>{available.map(d=><option key={d.id} value={d.id}>{[d.brand,d.model].filter(Boolean).join(' ')||d.type}</option>)}</select></Field><Field label="Problema"><textarea name="problem" required rows="4"/></Field><Field label="Técnico"><input name="technician" required/></Field><Field label="Prazo estimado (dias)"><input name="completionDays" type="number" min="1" step="1" placeholder="Ex.: 3"/></Field><Field label="Orçamento"><input name="price" type="number" step="0.01"/></Field><Field label="Custo"><input name="cost" type="number" step="0.01"/></Field><Field label="Observações"><textarea name="notes" rows="3"/></Field></div>{error&&<p className="form-error">{error}</p>}<div className="form-footer"><button type="button" className="outline" onClick={back}>Cancelar</button><button className="primary"><Save size={17}/>Criar OS</button></div></form></>}
function OrderBoard({orders,open,onEdit,onDelete,onOrderMoved}){
  const[boardOrders,setBoardOrders]=useState(orders)
  const[search,setSearch]=useState('')
  const[dragging,setDragging]=useState(null)
  const[dragOver,setDragOver]=useState(null)
  const[collapsed,setCollapsed]=useState({})
  const[notice,setNotice]=useState(null)
  const[pendingMove,setPendingMove]=useState(null)
  const[moveNote,setMoveNote]=useState('')
  const[moveError,setMoveError]=useState('')
  const[savingMove,setSavingMove]=useState(false)
  const boardRef=useRef(null)
  const dragPositionRef=useRef(null)
  useEffect(()=>setBoardOrders(orders),[orders])
  useEffect(()=>{if(!notice)return undefined;const timer=window.setTimeout(()=>setNotice(null),6500);return()=>window.clearTimeout(timer)},[notice])
  useEffect(()=>{
    if(dragging===null)return undefined
    const board=boardRef.current
    if(!board)return undefined
    const onDragOver=event=>{dragPositionRef.current=event}
    board.addEventListener('dragover',onDragOver)
    const timer=window.setInterval(()=>{
      const pointer=dragPositionRef.current
      if(!pointer)return
      const row=pointer.target?.closest?.('.order-board-row')||board.querySelector('.order-board-row')
      if(!row)return
      const bounds=row.getBoundingClientRect()
      const leftEdge=Math.max(bounds.left,24)
      const rightEdge=Math.min(bounds.right,window.innerWidth-24)
      const edgeSize=72
      if(pointer.clientX<leftEdge+edgeSize)row.scrollLeft=Math.max(0,row.scrollLeft-5)
      else if(pointer.clientX>rightEdge-edgeSize)row.scrollLeft=Math.min(row.scrollWidth-row.clientWidth,row.scrollLeft+5)
    },40)
    return()=>{board.removeEventListener('dragover',onDragOver);window.clearInterval(timer);dragPositionRef.current=null}
  },[dragging])

  const normalizedSearch=search.trim().toLowerCase()
  const filtered=boardOrders.filter(order=>{
    if(!normalizedSearch)return true
    return [order.id,order.client_name,order.device_brand,order.device_model,order.problem_description,order.technician_name]
      .filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch)
  })
  const countFor=column=>filtered.filter(order=>boardStatusColumn(order).key===column.key).length
  const saveMove=async(moving,nextStatus,note='')=>{
    const previousStatus=moving.status
    setSavingMove(true)
    setBoardOrders(current=>current.map(order=>String(order.id)===String(moving.id)?{...order,status:nextStatus}:order))
    try{
      const saved=await api(`/api/service-orders/${moving.id}`,{method:'PATCH',body:JSON.stringify({status:nextStatus,statusNote:note.trim()||null,actorName:localStorage.getItem('fixio.technician')||'Assistência'})})
      const confirmed=await api(`/api/service-orders/${moving.id}`)
      if(String(confirmed?.status||'')!==String(nextStatus))throw Error(`O status da OS #${moving.id} não foi confirmado no servidor.`)
      const updated={...saved,...confirmed,status:nextStatus}
      setBoardOrders(current=>current.map(order=>String(order.id)===String(moving.id)?{...order,...updated}:order))
      onOrderMoved?.(updated)
      const whatsapp=saved.whatsapp?.status
      const whatsappError=String(saved.whatsapp?.error||'').trim().slice(0,220)
      const message=whatsapp==='sent'?' Cliente avisado pelo WhatsApp.':whatsapp==='skipped'?' Status salvo; o WhatsApp não está configurado.':whatsapp==='error'?` Status salvo, mas não foi possível enviar o WhatsApp.${whatsappError?` Motivo: ${whatsappError}`:''}`:''
      setNotice({type:whatsapp==='error'?'warning':'success',text:`OS #${moving.id} movida para “${nextStatus}”.${message}`})
      setPendingMove(null)
      setMoveNote('')
      setMoveError('')
    }catch(error){
      setBoardOrders(current=>current.map(order=>String(order.id)===String(moving.id)?{...order,status:previousStatus}:order))
      setMoveError(error.message)
      setNotice({type:'error',text:`Não foi possível concluir a atualização da OS #${moving.id}.`})
    }finally{setSavingMove(false)}
  }
  const moveOrder=async(columnKey)=>{
    const moving=boardOrders.find(order=>String(order.id)===String(dragging))
    if(!moving)return
    const target=orderBoardColumns.find(column=>column.key===columnKey)
    const nextStatus=target?.statuses?.[0]||target?.key
    if(!nextStatus||moving.status===nextStatus){setDragging(null);setDragOver(null);return}
    setDragging(null)
    setDragOver(null)
    if(orderMoveNotePrompts[nextStatus]){
      setPendingMove({order:moving,nextStatus})
      setMoveNote('')
      setMoveError('')
      return
    }
    await saveMove(moving,nextStatus)
  }
  const boardRows=[orderBoardColumns.slice(0,6),orderBoardColumns.slice(6)]
  const renderColumn=column=>{
    const cards=filtered.filter(order=>boardStatusColumn(order).key===column.key)
    const isCollapsed=Boolean(collapsed[column.key])
    return <article key={column.key} className={`board-column ${isCollapsed?'is-collapsed':''} ${dragOver===column.key?'is-drag-over':''}`} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move';setDragOver(column.key)}} onDragLeave={event=>{if(event.currentTarget===event.target||!event.currentTarget.contains(event.relatedTarget))setDragOver(null)}} onDrop={event=>{event.preventDefault();void moveOrder(column.key)}}>
      <button type="button" className="board-column-head" onClick={()=>setCollapsed(current=>({...current,[column.key]:!current[column.key]}))} aria-expanded={!isCollapsed}>
        <span className={`board-column-dot ${column.tone}`}/><span className="board-column-title"><b>{column.label}</b><small>{column.hint}</small></span><strong>{countFor(column)}</strong><ChevronRight size={16} className={isCollapsed?'':'is-open'}/>
      </button>
      {!isCollapsed&&<div className="board-column-body">{cards.length?cards.map(order=><article key={order.id} className={`order-card ${dragging===order.id?'is-dragging':''}`} draggable onDragStart={event=>{setDragging(order.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(order.id))}} onDragEnd={()=>{setDragging(null);setDragOver(null)}} onClick={()=>open(order.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(order.id)}}} tabIndex="0">
          <div className="order-card-top"><span className="order-card-id">OS #{order.id}</span><Status>{order.status}</Status></div>
          <h3>{order.client_name||'Cliente não informado'}</h3>
          <p className="order-card-device">{[order.device_brand,order.device_model].filter(Boolean).join(' ')||order.device_type||'Aparelho não informado'}</p>
          <p className="order-card-problem">{order.problem_description||'Sem descrição do problema.'}</p>
          <div className="order-card-meta"><span><Wrench size={13}/>{order.technician_name||'Sem técnico'}</span><span>{order.estimated_delivery_at?`Prazo ${fmt(order.estimated_delivery_at)}`:'Sem prazo'}</span></div>
          <div className="order-card-footer"><b>{money(order.quoted_value_cents)}</b><span>↔ arrastar</span></div>
          {(onEdit||onDelete)&&<div className="order-card-actions" onClick={event=>event.stopPropagation()}>{onEdit&&<button type="button" className="table-action" onClick={()=>onEdit(order)}>Editar</button>}{onDelete&&<button type="button" className="table-action danger" onClick={()=>onDelete(order)}>Excluir</button>}</div>}
        </article>):<div className="board-column-empty">Solte uma OS aqui</div>}</div>}
    </article>
  }
  return <section className="order-board-shell">
    <div className="board-header">
      <div><p className="eyebrow">FLUXO DA OFICINA</p><h2>Quadro de OS</h2><p className="muted">Arraste cada ordem diretamente para a etapa atual. Clique no cartão para abrir todos os detalhes.</p></div>
      <div className="board-header-tools"><label className="board-search"><Search size={15}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar OS, cliente ou aparelho" aria-label="Buscar OS, cliente ou aparelho"/></label><span className="board-total">{filtered.length} {filtered.length===1?'ordem':'ordens'}</span></div>
    </div>
    {notice&&<div className={`board-notice ${notice.type}`} role="status"><span>{notice.text}</span><button type="button" onClick={()=>setNotice(null)} aria-label="Fechar aviso">×</button></div>}
    {!boardOrders.length?<Empty>Nenhuma ordem de serviço cadastrada.</Empty>:<div ref={boardRef} className="order-board" aria-label="Quadro de ordens de serviço" onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))dragPositionRef.current=null}}>
      {boardRows.map((columns,index)=><div className="order-board-row" key={`board-row-${index}`}>{columns.map(renderColumn)}</div>)}
    </div>}
    {pendingMove&&<div className="board-move-modal" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!savingMove)setPendingMove(null)}}>
      <form className="board-move-dialog" onSubmit={event=>{event.preventDefault();void saveMove(pendingMove.order,pendingMove.nextStatus,moveNote)}}>
        <div className="board-move-dialog-head"><div><p className="eyebrow">ATUALIZAÇÃO DA OS #{pendingMove.order.id}</p><h2>Registrar mudança para “{pendingMove.nextStatus}”</h2><p>{orderMoveNotePrompts[pendingMove.nextStatus]}</p></div><button type="button" className="icon-button" onClick={()=>setPendingMove(null)} disabled={savingMove} aria-label="Fechar">×</button></div>
        <label className="board-move-note"><span>Nota da atualização <small>(opcional)</small></span><textarea value={moveNote} onChange={event=>{setMoveNote(event.target.value);setMoveError('')}} placeholder="Escreva uma observação, se necessário..." rows="5" maxLength={1000} autoFocus/><small>Se preenchida, a nota aparece abaixo do status no histórico da OS.</small></label>
        {moveError&&<p className="form-error">{moveError}</p>}
        <div className="board-move-dialog-actions"><button type="button" className="outline" onClick={()=>setPendingMove(null)} disabled={savingMove}>Cancelar</button><button type="submit" className="primary" disabled={savingMove}>{savingMove?'Salvando atualização…':'Salvar e mover OS'}</button></div>
      </form>
    </div>}
  </section>
}

function Orders({orders,open,onEdit,onDelete,onOrderMoved}){const showActions=Boolean(onEdit||onDelete);return showActions?<OrderBoard orders={orders} open={open} onEdit={onEdit} onDelete={onDelete} onOrderMoved={onOrderMoved}/>:!orders.length?<Empty>Nenhuma ordem de serviço cadastrada.</Empty>:<div className="table-wrap"><table><thead><tr>{['OS','Cliente / equipamento','Problema','Status','Técnico','Valor'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{orders.map(o=><tr key={o.id} className="clickable-row" onClick={()=>open(o.id)}><td><b>#{o.id}</b></td><td><b>{o.client_name}</b><br/><small>{[o.device_brand,o.device_model].filter(Boolean).join(' ')||o.device_type}</small></td><td>{o.problem_description}</td><td><Status>{o.status}</Status></td><td>{o.technician_name}</td><td>{money(o.quoted_value_cents)}</td></tr>)}</tbody></table></div>}
function Dashboard({data,orders,setPage,open}){const s=data?.summary||{};return <><section className="page-head"><div><p className="eyebrow">VISÃO GERAL</p><h1>Dashboard</h1><p className="muted">Dados reais vindos da API.</p></div><button className="primary" onClick={()=>setPage('new-order')}><Plus size={18}/>Nova OS</button></section><section className="metrics">{[[ClipboardList,'OS no período',s.total||0,'blue'],[AlertTriangle,'Aguardando aprovação',s.waiting_approval||0,'yellow'],[Wrench,'Em manutenção',s.in_maintenance||0,'purple'],[Save,'Prontas',s.ready||0,'green']].map(([I,l,v,t])=><article className="metric-card" key={l}><div className={`metric-icon ${t}`}><I size={20}/></div><div><p>{l}</p><strong>{v}</strong><small>Período atual</small></div></article>)}</section><section className="dashboard-grid"><article className="panel"><div className="panel-head"><div><h2>Ordens recentes</h2><p>Registros reais</p></div></div><Orders orders={orders.slice(0,5)} open={open}/></article><aside className="panel summary-card"><h2>Resumo financeiro</h2><div><span>Faturamento</span><b>{money(s.revenue_cents)}</b></div><div><span>Lucro estimado</span><b>{money(s.profit_cents)}</b></div></aside></section><section className="analytics"><article className="panel revenue-panel"><div className="panel-head"><div><h2>Vendas e lucro</h2><p>{data?.period?`${fmt(data.period.from)} até ${fmt(data.period.to)}`:'Período atual'}</p></div></div><div className="chart-summary"><div><span className="legend sales"></span><small>Faturamento</small><b>{money(s.revenue_cents)}</b></div><div><span className="legend profit"></span><small>Lucro</small><b>{money(s.profit_cents)}</b></div></div><div className="ranking-list">{data?.byDay?.length?data.byDay.map(x=><div className="rank" key={x.date}><div className="rank-info"><div><b>{fmt(x.date)}</b><strong>{money(x.revenue_cents)}</strong></div><small>Lucro: {money(x.profit_cents)}</small></div></div>):<Empty>O relatório aparecerá quando houver dados.</Empty>}</div></article><article className="panel ranking-panel"><div className="panel-head"><div><h2>Serviços que mais saem</h2><p>Por faturamento</p></div></div><div className="ranking-list">{data?.topServices?.length?data.topServices.map((x,i)=><div className="rank" key={x.name}><span className="rank-number green">{i+1}</span><div className="rank-info"><div><b>{x.name}</b><strong>{money(x.revenue_cents)}</strong></div><small>{x.quantity} ocorrência(s)</small></div></div>):<Empty>Sem serviços no período.</Empty>}</div></article></section><FinancialDashboardPanel/></>}
function RecordEditor({kind,record,clients,onClose,onSaved}){
  const isClient=kind==='clients';const[form,setForm]=useState(()=>isClient?{name:record.name||'',phone:record.phone||'',email:record.email||'',document:record.document||'',birthDate:record.birth_date||'',address:record.address||'',notes:record.notes||''}:{clientId:String(record.client_id||''),type:record.type||'',brand:record.brand||'',model:record.model||'',serialNumber:record.serial_number||'',color:record.color||''});const[error,setError]=useState('');const[busy,setBusy]=useState(false);const set=(key,value)=>setForm(current=>({...current,[key]:value}));const submit=async event=>{event.preventDefault();try{setBusy(true);const payload=isClient?{...form,phone:formatPhone(form.phone),document:formatCpf(form.document)}:{clientId:Number(form.clientId),type:form.type,brand:form.brand,model:form.model,serialNumber:form.serialNumber,color:form.color};await api(`/api/${isClient?'clients':'devices'}/${record.id}`,{method:'PATCH',body:JSON.stringify(payload)});onSaved?.();onClose()}catch(exception){setError(exception.message)}finally{setBusy(false)}};return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><form className="panel record-editor" onSubmit={submit}><div className="panel-head"><div><h2>Editar {isClient?'cliente':'equipamento'}</h2><p>Atualize os dados salvos no sistema.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><div className="form-grid">{isClient?<><Field label="Nome"><input value={form.name} required onChange={e=>set('name',e.target.value)}/></Field><Field label="Telefone"><input value={form.phone} onChange={e=>set('phone',formatPhone(e.target.value))}/></Field><Field label="E-mail"><input value={form.email} type="email" onChange={e=>set('email',e.target.value)}/></Field><Field label="CPF/CNPJ"><input value={form.document} onChange={e=>set('document',formatCpf(e.target.value))}/></Field><Field label="Data de nascimento"><input value={String(form.birthDate||'').slice(0,10)} type="date" onChange={e=>set('birthDate',e.target.value)}/></Field><Field label="Endereço"><input value={form.address} onChange={e=>set('address',e.target.value)}/></Field><Field label="Observações"><textarea value={form.notes} rows="3" onChange={e=>set('notes',e.target.value)}/></Field></>:<><Field label="Cliente"><select value={form.clientId} required onChange={e=>set('clientId',e.target.value)}><option value="">Selecione</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></Field><Field label="Tipo"><input value={form.type} required onChange={e=>set('type',e.target.value)}/></Field><Field label="Marca"><input value={form.brand} onChange={e=>set('brand',e.target.value)}/></Field><Field label="Modelo"><input value={form.model} onChange={e=>set('model',e.target.value)}/></Field><Field label="Número de série / IMEI"><input value={form.serialNumber} onChange={e=>set('serialNumber',e.target.value)}/></Field><Field label="Cor"><input value={form.color} onChange={e=>set('color',e.target.value)}/></Field></>}</div>{error&&<p className="form-error">{error}</p>}<div className="form-footer"><button type="button" className="outline" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando…':'Salvar alterações'}</button></div></form></div>
}
function OrderEditor({record,onClose,onSaved}){
  const[form,setForm]=useState(()=>({problemDescription:record.problem_description||'',technicianName:record.technician_name||'',estimatedDeliveryAt:String(record.estimated_delivery_at||'').slice(0,10),quotedValue:record.quoted_value_cents==null?'':(Number(record.quoted_value_cents)/100).toFixed(2),estimatedCost:record.estimated_cost_cents==null?'':(Number(record.estimated_cost_cents)/100).toFixed(2),internalNotes:record.internal_notes||''}));const[error,setError]=useState('');const[busy,setBusy]=useState(false);const set=(key,value)=>setForm(current=>({...current,[key]:value}));const submit=async event=>{event.preventDefault();try{setBusy(true);await api(`/api/service-orders/${record.id}`,{method:'PATCH',body:JSON.stringify({...form,quotedValue:form.quotedValue||0,estimatedCost:form.estimatedCost||0,estimatedDeliveryAt:form.estimatedDeliveryAt||null})});onSaved?.();onClose()}catch(exception){setError(exception.message)}finally{setBusy(false)}};return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><form className="panel record-editor order-editor" onSubmit={submit}><div className="panel-head"><div><h2>Editar ordem de serviço #{record.id}</h2><p>Atualize os dados do atendimento sem perder o histórico.</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><div className="form-grid"><Field label="Problema informado"><textarea value={form.problemDescription} required rows="4" onChange={e=>set('problemDescription',e.target.value)}/></Field><Field label="Técnico"><input value={form.technicianName} required onChange={e=>set('technicianName',e.target.value)}/></Field><Field label="Previsão"><input value={form.estimatedDeliveryAt} type="date" onChange={e=>set('estimatedDeliveryAt',e.target.value)}/></Field><Field label="Orçamento"><input value={form.quotedValue} type="number" step="0.01" onChange={e=>set('quotedValue',e.target.value)}/></Field><Field label="Custo previsto"><input value={form.estimatedCost} type="number" step="0.01" onChange={e=>set('estimatedCost',e.target.value)}/></Field><Field label="Observações internas"><textarea value={form.internalNotes} rows="3" onChange={e=>set('internalNotes',e.target.value)}/></Field></div>{error&&<p className="form-error">{error}</p>}<div className="form-footer"><button type="button" className="outline" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando…':'Salvar alterações'}</button></div></form></div>
}
function List({kind,clients,devices,orders,setPage,open,onOpenChat,onOrderMoved}){const label=kind==='clients'?'Clientes':kind==='devices'?'Equipamentos':'Ordens de serviço';const rows=kind==='clients'?clients:kind==='devices'?devices:orders;const[editing,setEditing]=useState(null),[editingOrder,setEditingOrder]=useState(null),[error,setError]=useState('');const isEditable=kind==='clients'||kind==='devices',isOrder=kind==='orders';const remove=async row=>{if(!window.confirm(`Excluir ${isOrder?`a OS #${row.id}`:'este registro'}?`))return;try{await api(`/api/${isOrder?'service-orders':kind}/${row.id}`,{method:'DELETE'});window.location.reload()}catch(exception){setError(exception.message)}};return <><section className="page-head"><div><p className="eyebrow">ATENDIMENTO</p><h1>{label}</h1><p className="muted">Registros reais do banco de dados.</p></div><button className="primary" onClick={()=>setPage(kind==='clients'?'new-client':kind==='devices'?'new-device':'new-order')}><Plus size={18}/>Novo</button></section><section className="panel list-panel">{error&&<p className="form-error list-error">{error}</p>}{isOrder?<Orders orders={rows} open={open} onEdit={setEditingOrder} onDelete={remove} onOrderMoved={onOrderMoved}/>:!rows.length?<Empty>Nenhum registro encontrado.</Empty>:<div className="table-wrap"><table><thead><tr>{(kind==='clients'?['Cliente','E-mail','Telefone','Equipamentos','Chat','Ações']:['Equipamento','Tipo','Cliente','Nº de série','Ações']).map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(row=>kind==='clients'?<tr key={row.id}><td><b>{row.name}</b></td><td>{row.email||'—'}</td><td>{row.phone||'—'}</td><td>{row.devices_count||0}</td><td><button type="button" className="table-action chat-action" onClick={()=>onOpenChat?.(row)}><MessageCircle size={14}/>Chat</button></td><td className="row-actions"><button type="button" className="table-action" onClick={()=>setEditing(row)}>Editar</button><button type="button" className="table-action danger" onClick={()=>remove(row)}>Excluir</button></td></tr>:<tr key={row.id}><td><b>{[row.brand,row.model].filter(Boolean).join(' ')||'Sem identificação'}</b></td><td>{row.type}</td><td>{row.client_name}</td><td>{row.serial_number||'—'}</td><td className="row-actions"><button type="button" className="table-action" onClick={()=>setEditing(row)}>Editar</button><button type="button" className="table-action danger" onClick={()=>remove(row)}>Excluir</button></td></tr>)}</tbody></table></div>}</section>{isEditable&&editing&&<RecordEditor key={`${kind}-${editing.id}`} kind={kind} record={editing} clients={clients} onClose={()=>setEditing(null)} onSaved={()=>window.location.reload()}/>} {isOrder&&editingOrder&&<OrderEditor key={`order-${editingOrder.id}`} record={editingOrder} onClose={()=>setEditingOrder(null)} onSaved={()=>window.location.reload()}/>}</>}
function Create({kind,clients,devices,done,back}){const [clientId,setClientId]=useState(''),[error,setError]=useState('');const isOrder=kind==='order',isDevice=kind==='device';const title=isOrder?'Detalhes do atendimento':isDevice?'Identificação do equipamento':'Dados de contato';const subtitle=isOrder?'Selecione o cliente, o equipamento e registre o que foi relatado.':isDevice?'Associe o equipamento a um cliente para manter todo o histórico organizado.':'Registre o contato para iniciar o histórico de atendimentos.';const submit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const body=isOrder?{clientId:+f.get('clientId'),deviceId:+f.get('deviceId'),problemDescription:f.get('problem'),technicianName:f.get('technician'),estimatedDeliveryAt:dateAfterDays(f.get('completionDays')),quotedValue:f.get('price')||0,estimatedCost:f.get('cost')||0,internalNotes:f.get('notes')} :isDevice?{clientId:+f.get('clientId'),type:f.get('type'),brand:f.get('brand'),model:f.get('model'),serialNumber:f.get('serial')}:{name:f.get('name'),phone:f.get('phone'),email:f.get('email'),document:f.get('document'),birthDate:f.get('birthDate')||null,address:f.get('address'),notes:f.get('notes')};const saved=await api(isOrder?'/api/service-orders':isDevice?'/api/devices':'/api/clients',{method:'POST',body:JSON.stringify(body)});if(!isOrder&&!isDevice)window.dispatchEvent(new CustomEvent('fixio:client-created',{detail:saved}));await done();back()}catch(err){setError(err.message)}};const av=devices.filter(x=>String(x.client_id)===String(clientId));return <><section className="order-top"><button className="back-button" onClick={back}><ArrowLeft size={17}/>Voltar</button></section><section className="order-heading"><div><p className="eyebrow">CADASTRO</p><h1>{isOrder?'Nova ordem de serviço':isDevice?'Novo equipamento':'Novo cliente'}</h1><p className="muted">Preencha somente o que for necessário neste momento.</p></div></section><form className="panel register-card polished-form" onSubmit={submit}><div className="form-title"><span className="form-title-icon">{isOrder?<ClipboardList size={20}/>:isDevice?<Laptop size={20}/>:<Users size={20}/>}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div><div className="form-grid">{isOrder?<><Field label="Cliente"><select name="clientId" value={clientId} onChange={e=>setClientId(e.target.value)} required><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Equipamento"><select name="deviceId" required disabled={!clientId}><option value="">Selecione</option>{av.map(d=><option key={d.id} value={d.id}>{[d.brand,d.model].filter(Boolean).join(' ')||d.type}</option>)}</select></Field><Field label="Problema"><textarea name="problem" required rows="4" placeholder="Descreva o problema informado pelo cliente"/></Field><Field label="Técnico"><input name="technician" required placeholder="Nome do responsável" defaultValue={localStorage.getItem('fixio.technician')||''} onChange={e=>localStorage.setItem('fixio.technician',e.target.value)}/></Field><Field label="Prazo estimado (dias)"><input type="number" name="completionDays" min="1" step="1" placeholder="Ex.: 3"/></Field><Field label="Orçamento"><input type="number" step="0.01" name="price" placeholder="0,00"/></Field><Field label="Custo previsto"><input type="number" step="0.01" name="cost" placeholder="0,00"/></Field><Field label="Observações"><textarea name="notes" rows="3" placeholder="Notas internas, não visíveis ao cliente"/></Field></>:isDevice?<><Field label="Cliente"><select name="clientId" required><option value="">Selecione</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Tipo"><select name="type"><option>Notebook</option><option>Computador</option><option>Celular</option><option>Videogame</option></select></Field><Field label="Marca"><input name="brand" placeholder="Ex.: Dell"/></Field><Field label="Modelo"><input name="model" placeholder="Ex.: Inspiron 15"/></Field><Field label="Número de série / IMEI"><input name="serial" placeholder="Opcional"/></Field></>:<><Field label="Nome"><input name="name" required placeholder="Nome completo"/></Field><Field label="Telefone"><input name="phone" placeholder="(00) 00000-0000"/></Field><Field label="E-mail"><input name="email" type="email" placeholder="cliente@email.com"/></Field><Field label="CPF/CNPJ"><input name="document" placeholder="Opcional"/></Field><Field label="Data de nascimento"><input name="birthDate" type="date"/></Field><Field label="Endereço"><input name="address" placeholder="Opcional"/></Field><Field label="Observações"><textarea name="notes" rows="3" placeholder="Informações relevantes"/></Field></>}</div>{error&&<p className="form-error">{error}</p>}<div className="form-footer"><button type="button" className="outline" onClick={back}>Cancelar</button><button className="primary"><Save size={17}/>Salvar dados</button></div></form></>}
function MediaPreview({item}){
  const title=item.title||({image:'Imagem',video:'Vídeo',youtube:'Abrir vídeo'}[item.type]||'Mídia')
  if(item.type==='image')return <a className="media-preview" href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={title}/><span>{title}</span></a>
  if(item.type==='video')return <div className="media-preview"><video controls preload="metadata" src={item.url}/><span>{title}</span></div>
  return <a className="media-preview media-link" href={item.url} target="_blank" rel="noreferrer"><span>{title}</span><small>{item.url}</small></a>
}
function Detail({id,back,refresh}){
  const[o,setO]=useState(),[err,setErr]=useState('');const stages=['Recebido','Em análise','Aguardando aprovação','Em manutenção','Testando','Pronto','Entregue'];const load=async()=>{try{setO(await api(`/api/service-orders/${id}`));setErr('')}catch(e){setErr(e.message)}};useEffect(()=>{void load()},[id]);if(err)return <Empty>{err}</Empty>;if(!o)return <Empty>Carregando OS...</Empty>;const index=Math.max(0,stages.indexOf(o.status));const change=async value=>{try{await api(`/api/service-orders/${id}`,{method:'PATCH',body:JSON.stringify({status:value})});await load()}catch(e){setErr(e.message)}};return <><section className="order-top"><button className="back-button" onClick={back}><ArrowLeft size={17}/>Voltar</button><select className="filter" value={o.status} onChange={e=>change(e.target.value)}>{status.map(x=><option key={x}>{x}</option>)}</select></section><section className="order-heading"><div><p className="eyebrow">OS #{o.id}</p><h1>{o.problem_description}</h1><p className="muted">Aberta em {fmt(o.created_at)}</p></div><Status>{o.status}</Status></section><article className="panel order-progress"><div><b>Andamento do serviço</b><span>{index+1} de {stages.length} etapas</span></div><div className="progress-track"><i style={{width:`${(index/(stages.length-1))*100}%`}}/></div><div className="progress-stages">{stages.map((stage,i)=><button key={stage} className={i<=index?'done':''} onClick={()=>change(stage)}><i>{i<index?'✓':i+1}</i><span>{stage}</span></button>)}</div>{index<stages.length-1&&<button className="primary advance" onClick={()=>change(stages[index+1])}>Avançar para: {stages[index+1]}</button>}</article><div className="order-layout"><div className="order-main"><article className="panel info-panel"><h2>Dados do atendimento</h2><div className="info-grid"><div><span>Cliente</span><b>{o.client_name}</b><small>{o.client_phone||'Sem telefone'} · {o.client_email||'Sem e-mail'}</small></div><div><span>Equipamento</span><b>{[o.device_brand,o.device_model].filter(Boolean).join(' ')||o.device_type}</b><small>{o.serial_number||'Sem série'}</small></div><div><span>Técnico</span><b>{o.technician_name}</b></div><div><span>Previsão de conclusão</span><b>{fmt(o.estimated_delivery_at)}</b></div></div></article><article className="panel info-panel"><h2>Timeline</h2><div className="order-timeline">{o.timeline.map(x=><div key={x.id}><i></i><span><b>{x.description}</b><small>{fmt(x.created_at)} · {x.actor_name||'Sistema'}</small></span></div>)}</div></article><article className="panel info-panel"><h2>Mídias adicionadas</h2><div className="order-media-grid">{o.media.length?o.media.map(x=><MediaPreview item={x} key={x.id}/>):<p className="muted">Nenhuma mídia cadastrada.</p>}</div></article><OrderExtras id={id} onSaved={load}/></div><aside className="order-side"><article className="panel summary-card"><h2>Financeiro</h2><div><span>Orçamento</span><b>{money(o.quoted_value_cents)}</b></div><div><span>Custo</span><b>{money(o.estimated_cost_cents)}</b></div><div className="total"><span>Lucro</span><b>{money(o.quoted_value_cents-o.estimated_cost_cents)}</b></div></article></aside></div></>}

function Inventory({orders}){const[products,setProducts]=useState([]),[error,setError]=useState('');const load=()=>api('/api/products').then(setProducts).catch(e=>setError(e.message));useEffect(()=>{load()},[]);const save=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/products',{method:'POST',body:JSON.stringify({name:f.get('name'),sku:f.get('sku'),quantity:f.get('quantity'),minimumQuantity:f.get('minimum'),cost:f.get('cost'),supplier:f.get('supplier'),location:f.get('location')})});e.currentTarget.reset();load()}catch(err){setError(err.message)}};const move=async(e,id)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/products/${id}/movements`,{method:'POST',body:JSON.stringify({type:f.get('type'),quantity:f.get('quantity'),note:f.get('note'),serviceOrderId:f.get('serviceOrderId')||null})});e.currentTarget.reset();load()}catch(err){setError(err.message)}};return <><section className="page-head"><div><p className="eyebrow">GESTÃO</p><h1>Estoque</h1><p className="muted">Peças e produtos cadastrados no banco.</p></div></section><section className="dashboard-grid"><form className="panel info-panel finance-form" onSubmit={save}><h2>Novo produto</h2><Field label="Nome"><input name="name" required/></Field><Field label="SKU"><input name="sku"/></Field><Field label="Quantidade inicial"><input name="quantity" type="number" min="0" step="0.001" defaultValue="0"/></Field><Field label="Estoque mínimo"><input name="minimum" type="number" min="0" step="0.001" defaultValue="0"/></Field><Field label="Custo unitário"><input name="cost" type="number" min="0" step="0.01" defaultValue="0"/></Field><Field label="Fornecedor"><input name="supplier"/></Field><Field label="Localização"><input name="location"/></Field><button className="primary"><Save size={16}/>Salvar produto</button></form><article className="panel orders-panel"><div className="panel-head"><div><h2>Produtos</h2><p>{products.filter(p=>p.is_low_stock).length} com estoque baixo</p></div></div>{error?<Empty>{error}</Empty>:!products.length?<Empty>Nenhum produto cadastrado.</Empty>:<div className="table-wrap"><table><thead><tr>{['Produto','Saldo','Mínimo','Custo','Movimentar'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{products.map(p=><tr key={p.id}><td><b>{p.name}</b><br/><small>{p.sku||p.location||'Sem SKU/local'}</small></td><td><Status>{p.quantity}</Status></td><td>{p.minimum_quantity}</td><td>{money(p.cost_cents)}</td><td><form className="movement-form" onSubmit={e=>move(e,p.id)}><select name="type"><option value="in">Entrada</option><option value="out">Saída</option><option value="adjustment">Ajuste</option></select><input name="quantity" type="number" step="0.001" required placeholder="Qtd."/><select name="serviceOrderId" defaultValue=""><option value="">Sem OS</option>{orders.map(o=><option key={o.id} value={o.id}>#{o.id}</option>)}</select><input name="note" placeholder="Observação"/><button className="outline">Salvar</button></form></td></tr>)}</tbody></table></div>}</article></section></>}
function Finance({orders}){const[entries,setEntries]=useState([]),[summary,setSummary]=useState(),[error,setError]=useState('');const load=()=>Promise.all([api('/api/finance/entries'),api('/api/finance/summary')]).then(([e,s])=>{setEntries(e);setSummary(s)}).catch(e=>setError(e.message));useEffect(()=>{load()},[]);const save=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/finance/entries',{method:'POST',body:JSON.stringify({type:f.get('type'),category:f.get('category'),description:f.get('description'),amount:f.get('amount'),occurredOn:f.get('occurredOn'),serviceOrderId:f.get('serviceOrderId')||null})});e.currentTarget.reset();load()}catch(err){setError(err.message)}};return <><section className="page-head"><div><p className="eyebrow">GESTÃO</p><h1>Financeiro</h1><p className="muted">Entradas e despesas reais registradas no banco.</p></div></section><section className="metrics"><Metric icon={CircleDollarSign} label="Entradas" value={money(summary?.income_cents)} hint="Período atual"/><Metric icon={AlertTriangle} label="Despesas" value={money(summary?.expense_cents)} hint="Período atual" tone="yellow"/><Metric icon={Save} label="Resultado" value={money(summary?.profit_cents)} hint="Entradas menos despesas" tone="green"/></section><section className="dashboard-grid"><form className="panel info-panel finance-form" onSubmit={save}><h2>Novo lançamento</h2><Field label="Tipo"><select name="type"><option value="income">Entrada</option><option value="expense">Despesa</option></select></Field><Field label="Categoria"><input name="category" required placeholder="Ex.: Serviço, peça, aluguel"/></Field><Field label="Descrição"><input name="description" required/></Field><Field label="Valor"><input name="amount" required type="number" min="0.01" step="0.01"/></Field><Field label="Data"><input name="occurredOn" required type="date"/></Field><Field label="OS relacionada"><select name="serviceOrderId" defaultValue=""><option value="">Nenhuma</option>{orders.map(o=><option key={o.id} value={o.id}>OS #{o.id} — {o.client_name}</option>)}</select></Field><button className="primary"><Save size={16}/>Salvar lançamento</button></form><article className="panel orders-panel"><div className="panel-head"><div><h2>Lançamentos</h2><p>Histórico financeiro</p></div></div>{error?<Empty>{error}</Empty>:!entries.length?<Empty>Nenhum lançamento cadastrado.</Empty>:<div className="table-wrap"><table><thead><tr>{['Data','Tipo','Categoria','Descrição','Valor','OS'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{entries.map(x=><tr key={x.id}><td>{fmt(x.occurred_on)}</td><td><Status>{x.type==='income'?'Entrada':'Despesa'}</Status></td><td>{x.category}</td><td>{x.description}</td><td><b>{money(x.amount_cents)}</b></td><td>{x.service_order_number?`#${x.service_order_number}`:'—'}</td></tr>)}</tbody></table></div>}</article></section></>}
function Login({onLogin}){const[admin,setAdmin]=useState(false);const submit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);onLogin({mode:admin?'admin':'customer',cpf:f.get('cpf')})};return <main className="login-page"><button type="button" className="admin-access" aria-label="Acesso administrativo" title="Acesso administrativo" onClick={()=>setAdmin(true)}><ShieldCheck size={15}/></button><div className="login-glow login-glow-one"/><div className="login-glow login-glow-two"/><section className="login-shell"><div className="login-intro"><div className="login-brand"><div className="brand-mark"><Wrench size={21}/></div><b>fix<span>.io</span></b></div><div className="login-kicker"><span/> CENTRAL DE ASSISTÊNCIA</div><h1>Seu atendimento,<br/><em>do jeito certo.</em></h1><p className="login-description">Veja o andamento do serviço de forma simples e segura.</p><div className="login-highlights"><div><CheckCircle2 size={17}/><span>Acompanhamento simples</span></div><div><ShieldCheck size={17}/><span>Informações protegidas</span></div></div></div><form className="panel login-card login-card-new" onSubmit={submit}>{admin&&<button type="button" className="login-back" onClick={()=>setAdmin(false)}>← Voltar para cliente</button>}<div className="login-card-heading"><span className="login-welcome">{admin?'ÁREA RESTRITA':'ACOMPANHAMENTO DO CLIENTE'}</span><h2>{admin?'Acesso administrativo':'Consulte seu atendimento'}</h2><p>{admin?'Entre para gerenciar a operação da assistência.':'Informe seu CPF para continuar.'}</p></div><div className="login-fields">{admin?<><Field label="E-mail"><input name="email" type="email" autoComplete="username" placeholder="voce@empresa.com" required/></Field><Field label="Senha"><div className="password-input"><LockKeyhole size={17}/><input name="password" type="password" autoComplete="current-password" placeholder="Digite sua senha" required/></div></Field></>:<Field label="Seu CPF"><input name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" required/><small className="field-hint">Informe somente o CPF usado no atendimento.</small></Field>}</div><div className="test-mode-note"><span><ShieldCheck size={16}/></span><p><b>Modo de teste ativo</b><br/>O acesso está liberado para testar o sistema.</p></div><button className="primary full login-submit"><span>{admin?'Entrar no painel':'Consultar atendimento'}</span><ArrowUpRight size={18}/></button><p className="login-legal">Ao continuar, você verá o ambiente de demonstração do Fix.io.</p></form></section></main>}
function OrderStart({back,done,clients,devices}){const[clientMode,setClientMode]=useState('existing'),[clientId,setClientId]=useState(''),[newDevice,setNewDevice]=useState(false),[brand,setBrand]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const available=devices.filter(d=>String(d.client_id)===String(clientId));const brands=[...new Set(devices.map(d=>d.brand).filter(Boolean))].sort();const models=[...new Set(devices.filter(d=>!brand||d.brand?.toLowerCase()===brand.toLowerCase()).map(d=>d.model).filter(Boolean))].sort();const checklist=['Tela sem riscos','Carcaça sem danos','Liga e carrega','Botões e entradas testados','Acessórios recebidos'];const submit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const selectedChecklist=checklist.filter(x=>f.get(`check-${x}`)==='on').map(label=>({label,result:'Conferido na entrada'}));const common={problemDescription:f.get('problem'),technicianName:f.get('technician'),estimatedDeliveryAt:dateAfterDays(f.get('completionDays')),quotedValue:0,estimatedCost:0,internalNotes:f.get('notes'),checklist:selectedChecklist};const photos=f.getAll('intakePhotos').filter(x=>x instanceof File&&x.size);if(!photos.length){setError('Envie pelo menos uma foto do aparelho.');return}try{setBusy(true);let order;if(clientMode==='new')order=await api('/api/service-orders/intake',{method:'POST',body:JSON.stringify({...common,clientName:f.get('clientName'),clientPhone:f.get('clientPhone'),clientDocument:f.get('clientDocument'),clientEmail:f.get('clientEmail'),deviceType:'Celular',deviceBrand:f.get('deviceBrand'),deviceModel:f.get('deviceModel')})});else if(newDevice)order=await api('/api/service-orders/intake-device',{method:'POST',body:JSON.stringify({...common,clientId:+f.get('clientId'),deviceType:'Celular',deviceBrand:f.get('deviceBrand'),deviceModel:f.get('deviceModel')})});else order=await api('/api/service-orders/intake-existing',{method:'POST',body:JSON.stringify({...common,clientId:+f.get('clientId'),deviceId:+f.get('deviceId')})});const upload=new FormData();photos.forEach(photo=>upload.append('files',photo));upload.append('title',String(f.get('intakePhotoTitle')||''));upload.append('isClientVisible','true');await api(`/api/service-orders/${order.id}/media/upload`,{method:'POST',body:upload});const videoUrl=String(f.get('videoUrl')||'').trim();if(videoUrl)await api(`/api/service-orders/${order.id}/media`,{method:'POST',body:JSON.stringify({type:'youtube',url:videoUrl,title:'Vídeo relacionado ao aparelho',isClientVisible:false})});await done();back()}catch(err){setError(err.message)}finally{setBusy(false)}};return <><section className="order-top"><button className="back-button" onClick={back}><ArrowLeft size={17}/>Voltar</button></section><section className="order-heading"><div><p className="eyebrow">NOVO ATENDIMENTO</p><h1>Receber aparelho</h1><p className="muted">Anote os dados do cliente e do aparelho para começar o atendimento.</p></div></section><form className="panel register-card polished-form intake-form" onSubmit={submit}><div className="form-title"><span className="form-title-icon"><ClipboardList size={20}/></span><div><h2>Começar atendimento</h2><p>Vamos informar o valor e o prazo depois de avaliar o aparelho.</p></div></div><div className="quick-actions"><button type="button" className={clientMode==='existing'?'active':''} onClick={()=>{setClientMode('existing');setNewDevice(false)}}>Cliente já cadastrado</button><button type="button" className={clientMode==='new'?'active':''} onClick={()=>{setClientMode('new');setNewDevice(true)}}><Plus size={15}/>Novo cliente</button></div><div className="form-grid">{clientMode==='existing'?<><Field label="Cliente"><select name="clientId" value={clientId} onChange={e=>{setClientId(e.target.value);setNewDevice(false)}} required><option value="">Selecione o cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Aparelho"><div className="inline-field"><select name="deviceId" required disabled={!clientId||newDevice}><option value="">{newDevice?'Cadastrar aparelho abaixo':'Selecione o aparelho'}</option>{available.map(d=><option key={d.id} value={d.id}>{[d.brand,d.model].filter(Boolean).join(' ')||'Celular sem modelo'}</option>)}</select><button type="button" className="outline" disabled={!clientId} onClick={()=>setNewDevice(!newDevice)}>{newDevice?'Usar cadastrado':'Novo aparelho'}</button></div></Field></>:<><Field label="Nome do cliente"><input name="clientName" required placeholder="Nome completo"/></Field><Field label="CPF"><input name="clientDocument" required inputMode="numeric" placeholder="000.000.000-00"/></Field><Field label="Telefone"><input name="clientPhone" required placeholder="(00) 00000-0000"/></Field><Field label="E-mail"><input name="clientEmail" type="email" placeholder="Opcional"/></Field></>}{(clientMode==='new'||newDevice)&&<><Field label="Marca"><input name="deviceBrand" list="brands" value={brand} onChange={e=>setBrand(e.target.value)} required placeholder="Ex.: Samsung"/><datalist id="brands">{brands.map(x=><option key={x} value={x}/>)}</datalist></Field><Field label="Modelo"><input name="deviceModel" list="models" required placeholder="Ex.: Galaxy S24 Ultra"/><datalist id="models">{models.map(x=><option key={x} value={x}/>)}</datalist></Field></>}<Field label="O que aconteceu?"><textarea name="problem" required rows="3" placeholder="Ex.: não liga, travando, tela quebrada..."/></Field><Field label="Responsável pelo atendimento"><input name="technician" required placeholder="Nome do responsável"/></Field><Field label="Prazo previsto (dias)"><input name="completionDays" type="number" min="1" step="1" placeholder="Ex.: 3"/></Field><Field label="Observações"><textarea name="notes" rows="3" placeholder="Anote detalhes do aparelho e os acessórios deixados."/></Field></div><section className="intake-evidence"><div><h3>Como o aparelho chegou</h3><p>Confira estes itens com o cliente. Você poderá alterar depois.</p></div><div className="intake-checks">{checklist.map(item=><label key={item}><input type="checkbox" name={`check-${item}`} defaultChecked={item==='Tela sem riscos'}/>{item}</label>)}</div><label className="photo-upload"><b>Fotos do aparelho <em>*</em></b><input name="intakePhotos" type="file" accept="image/*" multiple required/><small>Envie fotos do aparelho e dos danos visíveis. Até 8 fotos de 8 MB.</small></label><input name="intakePhotoTitle" placeholder="Descreva as fotos (opcional)"/><Field label="Vídeo do aparelho (opcional)"><input name="videoUrl" type="url" placeholder="https://www.youtube.com/..."/></Field></section>{error&&<p className="form-error">{error}</p>}<div className="form-footer"><button type="button" className="outline" onClick={back} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}><Save size={17}/>{busy?'Salvando atendimento...':'Abrir atendimento'}</button></div></form></>}
function Portal({token}){const[data,setData]=useState(),[error,setError]=useState('');useEffect(()=>{api(`/api/public/orders/${token}`).then(setData).catch(e=>setError(e.message))},[token]);if(error)return <main className="portal-page"><div className="portal-brand"><Wrench size={19}/>fix<span>.io</span></div><article className="portal-card"><AlertTriangle size={28}/><h1>Link indisponível</h1><p className="muted">{error}</p></article></main>;if(!data)return <main className="portal-page"><div className="portal-brand"><Wrench size={19}/>fix<span>.io</span></div><article className="portal-card"><p className="muted">Carregando acompanhamento…</p></article></main>;const o=data.order;return <main className="portal-page"><div className="portal-brand"><Wrench size={19}/>fix<span>.io</span></div><article className="portal-card"><div className="success-circle"><ClipboardList size={28}/></div><p className="eyebrow">ACOMPANHAMENTO DA OS</p><h1>Olá, {o.client_name}</h1><div className="portal-device"><Laptop size={24}/><div><b>{[o.device_brand,o.device_model].filter(Boolean).join(' ')||o.device_type}</b><span>OS #{o.id}</span></div><Status>{o.status}</Status></div><p className="muted">{o.problem_description}</p><div className="timeline">{data.timeline.map((item,index)=><div className="timeline-item" key={`${item.created_at}-${index}`}><i className={index===0?'current':''}/><span><b>{item.description}</b><small>{fmt(item.created_at)}</small></span></div>)}</div>{data.media?.length>0&&<section className="portal-media"><h2>Fotos e vídeos</h2><div className="portal-media-grid">{data.media.map(item=>item.type==='image'?<a href={item.url} target="_blank" rel="noreferrer" key={item.url}><img src={item.url} alt={item.title||'Foto do atendimento'}/><small>{item.title||'Foto'}</small></a>:<a href={item.url} target="_blank" rel="noreferrer" key={item.url}><PlayCircle size={22}/><small>{item.title||'Abrir vídeo'}</small></a>)}</div></section>}<div className="portal-total"><span>Orçamento</span><b>{money(o.quoted_value_cents)}</b></div><p className="muted">Este portal mostra somente informações liberadas pela assistência.</p></article><footer>Fix.io · acompanhamento seguro</footer></main>}
export default function App(){
  useEffect(()=>{const onInput=event=>{const target=event.target;if(!(target instanceof HTMLInputElement))return;if(['cpf','document','clientDocument'].includes(target.name))target.value=formatCpf(target.value);if(['phone','clientPhone'].includes(target.name))target.value=formatPhone(target.value);if(target.name==='technician'&&target.value.trim())localStorage.setItem('fixio.technician',target.value)};const onFocus=event=>{const target=event.target;if(target instanceof HTMLInputElement&&target.name==='technician'&&!target.value)target.value=localStorage.getItem('fixio.technician')||''};document.addEventListener('input',onInput,true);document.addEventListener('focusin',onFocus,true);return()=>{document.removeEventListener('input',onInput,true);document.removeEventListener('focusin',onFocus,true)}},[])
  const publicToken=window.location.pathname.match(/^\/portal\/([^/]+)/)?.[1]
  if(publicToken)return <Portal token={publicToken}/>
  const storedAdminSession=localStorage.getItem('fixio.session')==='admin'&&Boolean(localStorage.getItem('fixio_token'))
  const[entered,setEntered]=useState(()=>storedAdminSession)
  const[authReady,setAuthReady]=useState(()=>!storedAdminSession||!localStorage.getItem(AUTH_REFRESH_KEY))
  const[customerCpf,setCustomerCpf]=useState(()=>localStorage.getItem('fixio.customer_cpf')||'')
  const[notifications,setNotifications]=useState({unread_count:0,latest:null})
  const whatsappWebUnread=useRef(0)
  const whatsappDesktopNotificationsReady=useRef(false)
  const[financeNotifications,setFinanceNotifications]=useState({pending_count:0,latest:null,connection:null})
  const[page,setPage]=useState('dashboard'),[data,setData]=useState(null),[clients,setClients]=useState([]),[devices,setDevices]=useState([]),[orders,setOrders]=useState([]),[id,setId]=useState(),[chatClientId,setChatClientId]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const load=async()=>{
    setLoading(true)
    try{
      const[c,d,o,x]=await Promise.all([api('/api/clients'),api('/api/devices'),api('/api/service-orders'),api('/api/dashboard')])
      setClients(c);setDevices(d);setOrders(o);setData(x);setError('')
    }catch(e){
      setError(e.message)
    }finally{setLoading(false)}
  }
  useEffect(()=>{
    const onClientCreated=event=>{
      const client=event.detail
      if(!client?.id)return
      setClients(current=>{const existing=current.find(item=>String(item.id)===String(client.id));const merged={...existing,...client};return[...current.filter(item=>String(item.id)!==String(client.id)),merged].sort((left,right)=>String(left.name||'').localeCompare(String(right.name||''),'pt-BR'))})
    }
    window.addEventListener('fixio:client-created',onClientCreated)
    return()=>window.removeEventListener('fixio:client-created',onClientCreated)
  },[])
   useEffect(()=>{
     if(!entered){setAuthReady(true);return undefined}
     const refreshToken=localStorage.getItem(AUTH_REFRESH_KEY)
     if(!refreshToken){setAuthReady(true);return undefined}
     let active=true
     setAuthReady(false)
     void refreshAuthSession().catch(()=>{
       clearAuthStorage()
       if(active)setEntered(false)
     }).finally(()=>{if(active)setAuthReady(true)})
     return()=>{active=false}
   },[entered])
   useEffect(()=>{if(entered&&authReady)load()},[entered,authReady])
   useEffect(()=>{
     if(!entered||!authReady)return undefined
     const bridge=window.chrome?.webview
     if(!bridge)return undefined
     const receive=event=>{
       const status=event.data
       if(status?.type!=='desktop-status'||status.target!=='whatsapp'||status.state!=='notification')return
       const unread=Math.max(0,Number(status.unreadCount)||0)
       if(whatsappDesktopNotificationsReady.current&&unread>whatsappWebUnread.current)playWhatsAppNotificationSound()
       whatsappDesktopNotificationsReady.current=true
       whatsappWebUnread.current=unread
       setNotifications(current=>({...current,unread_count:unread}))
     }
     bridge.addEventListener('message',receive)
     return()=>bridge.removeEventListener('message',receive)
   },[entered,authReady])
   useEffect(()=>{
     if(!entered||!authReady)return undefined
     let active=true
     const loadFinanceNotifications=async()=>{try{const result=await api('/api/finance/pix/notifications');if(active)setFinanceNotifications(result)}catch{}}
     void loadFinanceNotifications()
     const timer=window.setInterval(loadFinanceNotifications,15000)
     window.addEventListener('fixio:pix-updated',loadFinanceNotifications)
     return()=>{active=false;window.clearInterval(timer);window.removeEventListener('fixio:pix-updated',loadFinanceNotifications)}
   },[entered,authReady])
  const open=x=>{setId(x);setPage('detail')}
  const openClientChat=client=>{setChatClientId(client?.id||null);setPage('chat-beta')}
  const onOrderMoved=updated=>{if(!updated?.id)return;setOrders(current=>current.map(order=>String(order.id)===String(updated.id)?{...order,...updated}:order))}
  const shareOrder=async()=>{if(!id)throw Error('Nenhuma OS selecionada.');const result=await api(`/api/service-orders/${id}/portal`,{method:'POST'});const publicOrigin=(import.meta.env.VITE_PUBLIC_WEB_URL||window.location.origin).replace(/\/$/,'');const link=result.url?.startsWith('/')?`${publicOrigin}${result.url}`:result.url;try{await navigator.clipboard?.writeText(link)}catch{}return `Link da OS #${id} copiado para a área de transferência.`}
  const logout=()=>{clearAuthStorage();setEntered(false);setCustomerCpf('');setPage('dashboard')}
  if(!entered&&!customerCpf)return <ClientPortalEntry onAdminLogin={({mode})=>{if(mode==='admin'){localStorage.setItem('fixio.session','admin');setEntered(true)}}} onCustomerLogin={({cpf})=>{localStorage.setItem('fixio.customer_cpf',cpf);setCustomerCpf(cpf)}}/>
  if(customerCpf&&!entered)return <div className="customer-portal-container"><button type="button" className="portal-back-button" onClick={logout}><ArrowLeft size={16}/>Voltar</button><CustomerPortalEnhanced cpf={customerCpf} onLogout={logout}/></div>
  if(entered&&!authReady)return <main className="login-page"><div className="login-restore-card">Restaurando sua sessão…</div></main>
  let view=page==='techunion'?<TechUnionWorkspace/>:page==='whatsapp'||page==='chat-beta'?<WhatsAppModule tab={page==='chat-beta'?'chat':'web'} onTab={next=>next==='web'?openWhatsApp():setPage('chat-beta')} openOrder={open} initialClientId={chatClientId}/>:page==='boardview'?<BoardviewErrorBoundary><BoardviewWorkspace/></BoardviewErrorBoundary>:error?<div className="api-error"><AlertTriangle size={18}/>Não foi possível conectar a {API}: {error}<button onClick={load}>Tentar novamente</button></div>:loading?<Empty>Carregando dados reais...</Empty>:page==='dashboard'?<Dashboard data={data} orders={orders} setPage={setPage} open={open}/>:page==='finance'?<FinanceWorkspaceEnhanced orders={orders}/>:page==='inventory'?<InventoryWorkspaceEnhanced orders={orders}/>:page==='sale'?<SaleWorkspace/>:page==='autounattend'?<AutoAtendeWorkspace/>:page==='detail'?<Detail id={id} back={()=>setPage('orders')} refresh={load}/>:page==='new-client'?<Create kind="client" clients={clients} devices={devices} done={load} back={()=>setPage('clients')}/>:page==='new-device'?<Create kind="device" clients={clients} devices={devices} done={load} back={()=>setPage('devices')}/>:page==='new-order'?<OrderStart clients={clients} devices={devices} done={load} back={()=>setPage('orders')}/>:<List kind={page} clients={clients} devices={devices} orders={orders} setPage={setPage} open={open} onOpenChat={openClientChat} onOrderMoved={onOrderMoved}/>
  const openWhatsApp=()=>{whatsappWebUnread.current=0;setNotifications(current=>({...current,unread_count:0}));setPage('whatsapp')}
   return <AppShell page={page} setPage={setPage} notifications={notifications} financeNotifications={financeNotifications} onOpenWhatsApp={openWhatsApp} onOpenFinance={()=>setPage('finance')} onShareOrder={shareOrder} onLogout={logout}>{view}</AppShell>
}

function WhatsAppModule({tab,onTab,openOrder,initialClientId}){
  return <section className="whatsapp-module">
    <nav className="whatsapp-module-tabs" aria-label="Módulo do WhatsApp">
      <button type="button" className={tab==='web'?'active':''} onClick={()=>onTab('web')}><MessageCircle size={16}/>WhatsApp Web</button>
      <button type="button" className={tab==='chat'?'active':''} onClick={()=>onTab('chat')}><MessageCircle size={16}/>Chat</button>
    </nav>
    <div className="whatsapp-module-body">{tab==='web'?<WhatsAppWorkspace/>:<ChatBetaWorkspace openOrder={openOrder} initialClientId={initialClientId}/>}</div>
  </section>
}

function WhatsAppWorkspace(){
  const desktop=Boolean(window.chrome?.webview)
  const hostRef=useRef(null)
  const [status,setStatus]=useState({state:'loading',message:'Carregando o WhatsApp Web dentro do Fix.io…'})
  useEffect(()=>{
    const bridge=window.chrome?.webview
    if(!bridge)return undefined
    const receive=event=>{
      if(event.data?.type==='desktop-status'&&event.data.target==='whatsapp')setStatus(event.data)
    }
    bridge.addEventListener('message',receive)
    return()=>bridge.removeEventListener('message',receive)
  },[])
  useLayoutEffect(()=>{
    const bridge=window.chrome?.webview
    const host=hostRef.current
    if(!desktop||!bridge||!host)return undefined
    let frame=null
    let lastBounds=''
    const report=()=>{
      frame=null
      const rect=host.getBoundingClientRect()
      const left=Math.max(0,rect.left)
      const top=Math.max(0,rect.top)
      const bounds={type:'whatsapp-bounds',left,top,width:Math.max(0,Math.min(rect.right,window.innerWidth)-left),height:Math.max(0,Math.min(rect.bottom,window.innerHeight)-top),viewportWidth:window.innerWidth,viewportHeight:window.innerHeight}
      const serialized=JSON.stringify(bounds)
      if(serialized===lastBounds)return
      lastBounds=serialized
      bridge.postMessage(bounds)
    }
    const schedule=()=>{ if(frame===null)frame=window.requestAnimationFrame(report) }
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule)
    observer?.observe(host)
    window.addEventListener('resize',schedule)
    window.addEventListener('scroll',schedule,true)
    report()
    return()=>{
      observer?.disconnect()
      if(frame!==null)window.cancelAnimationFrame(frame)
      window.removeEventListener('resize',schedule)
      window.removeEventListener('scroll',schedule,true)
    }
  },[desktop])
  return <section className="whatsapp-workspace">
    <div aria-live="polite" className="whatsapp-workspace-head">
      <div><p className="eyebrow">ATENDIMENTO</p><h1>WhatsApp Web</h1><p className="muted">Converse normalmente pelo WhatsApp Web dentro do Fix.io. Novas mensagens serão sinalizadas pelo ícone superior.</p></div>
    </div>
    <div ref={hostRef} className="whatsapp-browser-fallback" role={status.state==='error'?'alert':undefined}><MessageCircle size={28} /><b>WhatsApp Web dentro do Fix.io</b><span>{status.message || 'O QR Code será carregado nesta área.'}</span><small>O arquivo original da conversa permanece no perfil local do aplicativo.</small></div>
  </section>
}

function SecureLogin({onLogin,initialAdmin=false}){
  const[admin,setAdmin]=useState(initialAdmin),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const submit=async event=>{event.preventDefault();const f=new FormData(event.currentTarget);if(!admin){onLogin({mode:'customer',cpf:onlyDigits(f.get('cpf'))});return}try{setBusy(true);setError('');const response=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});localStorage.setItem('fixio_token',response.token);if(response.refreshToken)localStorage.setItem(AUTH_REFRESH_KEY,response.refreshToken);onLogin({mode:'admin'})}catch(exception){setError(exception.message)}finally{setBusy(false)}}
  return <main className="login-page"><button type="button" className="admin-access" aria-label="Acesso administrativo" title="Acesso administrativo" onClick={()=>{setAdmin(true);setError('')}}><ShieldCheck size={15}/></button><div className="login-glow login-glow-one"/><div className="login-glow login-glow-two"/><section className="login-shell"><div className="login-intro"><div className="login-brand"><div className="brand-mark"><img src={fixioMark} alt="" /></div><b>fix<span>.io</span></b></div><div className="login-kicker"><span/> CENTRAL DE ASSISTÊNCIA</div><h1>Seu atendimento,<br/><em>do jeito certo.</em></h1><p className="login-description">Veja o andamento do serviço de forma simples e segura.</p><div className="login-highlights"><div><CheckCircle2 size={17}/><span>Acompanhamento simples</span></div><div><ShieldCheck size={17}/><span>Informações protegidas</span></div></div></div><form className="panel login-card login-card-new" onSubmit={submit}>{admin&&<button type="button" className="login-back" onClick={()=>{setAdmin(false);setError('')}}>← Voltar para cliente</button>}<div className="login-card-heading"><span className="login-welcome">{admin?'ÁREA RESTRITA':'ACOMPANHAMENTO DO CLIENTE'}</span><h2>{admin?'Acesso administrativo':'Consulte seu atendimento'}</h2><p>{admin?'Entre com sua conta autorizada.':'Informe seu CPF para continuar.'}</p></div><div className="login-fields">{admin?<><Field label="E-mail"><input name="email" type="email" autoComplete="username" placeholder="voce@empresa.com" required/></Field><Field label="Senha"><div className="password-input"><LockKeyhole size={17}/><input name="password" type="password" autoComplete="current-password" placeholder="Digite sua senha" required/></div></Field></>:<Field label="Seu CPF"><input name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" required/><small className="field-hint">Informe somente o CPF usado no atendimento.</small></Field>}</div>{error&&<p className="form-error">{error}</p>}<button className="primary full login-submit" disabled={busy}><span>{busy?'Autenticando...':admin?'Entrar no painel':'Consultar atendimento'}</span><ArrowUpRight size={18}/></button><p className="login-legal">{admin ? 'A área administrativa exige uma conta autorizada.' : 'Use o CPF informado no atendimento.'}</p></form></section></main>
}

function ClientPortalEntry({onAdminLogin,onCustomerLogin}){
  const[admin,setAdmin]=useState(false)
  if(admin)return <SecureLogin initialAdmin onLogin={onAdminLogin}/>
  const submit=event=>{event.preventDefault();const cpf=onlyDigits(new FormData(event.currentTarget).get('cpf'));if(cpf.length>=11)onCustomerLogin({cpf})}
  return <main className="login-page"><button type="button" className="admin-access" aria-label="Acesso administrativo" title="Acesso administrativo" onClick={()=>setAdmin(true)}><ShieldCheck size={15}/></button><div className="login-glow login-glow-one"/><div className="login-glow login-glow-two"/><section className="login-shell"><div className="login-intro"><div className="login-brand"><div className="brand-mark"><Wrench size={21}/></div><b>fix<span>.io</span></b></div><div className="login-kicker">PORTAL DO CLIENTE</div><h1>Acompanhe seu serviço.</h1><p className="login-description">Informe seu CPF para ver o andamento do serviço.</p></div><form className="panel login-card login-card-new" onSubmit={submit}><div className="login-card-heading"><span className="login-welcome">ÁREA DO CLIENTE</span><h2>Consultar atendimento</h2><p>Digite o CPF informado no atendimento.</p></div><div className="login-fields"><Field label="Seu CPF"><input name="cpf" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" /></Field></div><button className="primary full login-submit"><span>Entrar</span><ArrowUpRight size={18}/></button></form></section></main>
}
