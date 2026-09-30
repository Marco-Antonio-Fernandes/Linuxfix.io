import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// The web application was originally hosted by the Windows WebView2 shell.
// Keep its small message contract and translate it to Tauri on Linux.
const listeners = new Set()

const webview = {
  postMessage(message) {
    return invoke('desktop_message', { message })
  },
  addEventListener(type, listener) {
    if (type === 'message' && typeof listener === 'function') listeners.add(listener)
  },
  removeEventListener(type, listener) {
    if (type === 'message') listeners.delete(listener)
  },
}

window.chrome = window.chrome || {}
window.chrome.webview = webview

await listen('desktop-status', event => {
  const message = { data: event.payload }
  listeners.forEach(listener => listener(message))
})
