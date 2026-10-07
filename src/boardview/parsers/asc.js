import { decodeBoardContent } from './brd.js'
import { parseLegacyBoardText } from './legacy.js'

export function parseAsc(content, options = {}) {
  const { text, encoded } = decodeBoardContent(content)
  if (!text.trim()) throw new Error('O arquivo .asc está vazio.')
  return parseLegacyBoardText(text, { ...options, sourceFormat: 'asc', encoded })
}

