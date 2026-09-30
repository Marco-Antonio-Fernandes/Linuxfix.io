import { useLayoutEffect } from 'react'

// Bounds are CSS pixels. The native GTK host converts them to its allocation.
// Observe position as well as size: sidebar transitions can move a same-size box.
export function useNativeViewport(viewport, type) {
  useLayoutEffect(() => {
    const bridge = window.chrome?.webview
    const element = viewport.current
    if (!bridge || !element) return undefined
    let frame = 0
    let previous = ''
    const report = () => {
      const rect = element.getBoundingClientRect()
      const bounds = {
        type, left: rect.left, top: rect.top,
        width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      }
      const serialized = JSON.stringify(bounds)
      if (serialized !== previous) {
        previous = serialized
        bridge.postMessage(bounds)
      }
      frame = requestAnimationFrame(report)
    }
    report()
    return () => {
      cancelAnimationFrame(frame)
      bridge.postMessage({
        type, left: 0, top: 0, width: 0, height: 0,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      })
    }
  }, [viewport, type])
}
