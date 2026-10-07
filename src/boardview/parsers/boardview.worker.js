import { parseBrd } from './brd.js'
import { parseCad } from './cad.js'
import { parseBdv } from './bdv.js'
import { parseAsc } from './asc.js'
import { parseFz } from './fz.js'

self.onmessage = async event => {
  const { buffer, fileName } = event.data || {}
  try {
    const extension = String(fileName || '').toLowerCase().split('.').pop()
    if (extension === 'rar' || extension === 'zip') throw new Error('Este arquivo é um pacote compactado. Extraia o arquivo .cad, .brd ou outro boardview antes de importar.')
    const parsers = { brd: parseBrd, cad: parseCad, bdv: parseBdv, asc: parseAsc, fz: parseFz }
    const parser = parsers[extension]
    if (!parser) throw new Error(`Extensão .${extension || 'desconhecida'} não suportada. Use .brd, .cad, .bdv, .asc ou .fz.`)
    const board = await parser(buffer, { fileName })
    self.postMessage({ type: 'success', board })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Falha ao interpretar o arquivo de boardview.' })
  }
}
