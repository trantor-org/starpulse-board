import type { ClientModule } from 'claude-code'

/** What a row's bar draws from; `leanBar` in draw.ts builds it. */
type Bar = { k: number | null; n: number; color: string; track: string; tick: string; isLive: boolean; seed: number }

// A seeded noise in [0, 1), so a still bar draws the same dots on every redraw.
const noise = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453

  return x - Math.floor(x)
}

// One braille cell of the dot field, its eight dots denser toward the fill's leading edge as the drawn meter's are.
const cell = (c: number, cols: number, seed: number) => {
  const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols - 1), 1.3)
  let bits = 0
  for (let d = 0; d < 8; d++) {
    if (noise(c + seed, d) < density) {
      bits |= 1 << d
    }
  }

  return String.fromCodePoint(0x2800 + (bits || 0x40))
}

const TWINKLE_MS = 400

/**
 * A desktop Board row's bar: braille dots over the criteria done, then the rest of the track blank but for a tick at
 * each criterion boundary, all on one grey track exactly as wide as the region flex gave it. A live lane's dots twinkle:
 * each tick re-rolls about a quarter of the cells, and the fill never moves.
 */
const RowBar: ClientModule<Bar, number> = (bar, surface) => {
  const { Box, Text } = surface.elements
  if (bar.isLive && surface.state === undefined) {
    let frame = 0
    surface.every(TWINKLE_MS, () => surface.setState(++frame))
    surface.setState(0)
  }
  const cols = surface.columns
  if (!bar.n || !cols) {
    return <Box />
  }
  const fill = bar.k === null ? 0 : Math.round((cols * bar.k) / bar.n)
  const frame = surface.state ?? 0
  const dots = Array.from({ length: fill }, (_, c) => cell(c, fill, bar.seed + (bar.isLive && noise(c, frame) < 0.25 ? frame * 7 : 0))).join('')
  const ticks = new Set(Array.from({ length: bar.n - 1 }, (_, j) => Math.round((cols * (j + 1)) / bar.n)))
  const rest = Array.from({ length: cols - fill }, (_, i) => (ticks.has(fill + i) ? '│' : ' ')).join('')

  return (
    <Box flexDirection="row">
      {fill > 0 && (
        <Text color={bar.color} backgroundColor={bar.track}>
          {dots}
        </Text>
      )}
      {cols > fill && (
        <Text color={bar.tick} backgroundColor={bar.track}>
          {rest}
        </Text>
      )}
    </Box>
  )
}

export default RowBar
