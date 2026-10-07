import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('renderer não reutiliza width/height do canvas nas dimensões do componente', async () => {
  const source = await readFile(new URL('../src/boardview/BoardviewWorkspace.jsx', import.meta.url), 'utf8')
  assert.match(source, /const symbolWidth = clamp\(/)
  assert.match(source, /const symbolHeight = clamp\(/)
  assert.doesNotMatch(source, /const width = clamp\(worldWidth/)
  assert.doesNotMatch(source, /const height = clamp\(worldHeight/)
})
