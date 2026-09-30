import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// The web application was originally hosted by the Windows WebView2 shell.
// Keep its small message contract and translate it to Tauri on Linux.
const listeners = new Set()
const latest = new Map()

function deliver(payload) {
  latest.set(payload.target, payload)
  listeners.forEach(listener => listener({ data: payload }))
}

const webview = {
  postMessage(message) {
    return invoke('desktop_message', { message }).catch(error => {
      const type = message?.type || ''
      const target = type.startsWith('whatsapp') || message?.page === 'whatsapp'
        ? 'whatsapp' : type.startsWith('techunion') || message?.page === 'techunion'
          ? 'techunion' : 'application'
      deliver({ type: 'desktop-status', target, state: 'error', message: String(error) })
    })
  },
  addEventListener(type, listener) {
    if (type === 'message' && typeof listener === 'function') {
      listeners.add(listener)
      queueMicrotask(() => {
        if (listeners.has(listener)) latest.forEach(payload => listener({ data: payload }))
      })
    }
  },
  removeEventListener(type, listener) {
    if (type === 'message') listeners.delete(listener)
  },
}

window.chrome = window.chrome || {}
window.chrome.webview = webview

await listen('desktop-status', event => {
  deliver(event.payload)
})
