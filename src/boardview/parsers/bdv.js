import { parseLegacyBoardText } from './legacy.js'

const MAGIC = 'dd:1.3?,r?-=bb'

function hasMarker(text) {
  return /<<format\.asc>>/i.test(text) && /<<pins\.asc>>/i.test(text)
}

export function decodeBdv(content) {
  const bytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content instanceof Uint8Array ? content : new Uint8Array(content)
  const plainText = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (hasMarker(plainText) || plainText.includes(MAGIC)) return { text: plainText, encoded: false }

  const decoded = new Uint8Array(bytes.length)
  let count = 0xa0
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) count += 1
    const value = bytes[index]
    decoded[index] = value === 0x0d || value === 0x0a || value === 0
      ? value
      : (count - value) & 0xff
    if (count > 285) count = 159
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(decoded), encoded: true }
}

export function parseBdv(content, options = {}) {
  const { text, encoded } = decodeBdv(content)
  if (!text.trim()) throw new Error('O arquivo .bdv está vazio.')
  if (!hasMarker(text) && !text.includes(MAGIC)) throw new Error('Formato .bdv não reconhecido ou corrompido. O OpenBoardView espera os blocos format.asc e pins.asc.')
  return parseLegacyBoardText(text, { ...options, sourceFormat: 'bdv', encoded })
}
