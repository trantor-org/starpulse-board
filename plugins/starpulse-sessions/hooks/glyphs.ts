// StarPulse's :root tokens (starpulse/web/src/style.css) the Sessions pane colours with.
export const SP = {
  black: '#000000',
  ink: '#dbe4f3',
  slate: '#94a3b8',
  muted: '#6b7a93',
  track: '#334155',
  faint: '#475569',
  ok: '#34d399',
  run: '#fbbf24',
  fail: '#fb7185',
  agent: '#a78bfa',
  ready: '#60a5fa',
}

// Every icon the pane draws: its Nerd Font v3 codepoint, then the plain Unicode character for a terminal without the
// font. A terminal cannot report its font, so the `glyphs` option picks the column.
const GLYPHS = {
  down: ['\uf078', '▾'],
  right: ['\uf054', '▸'],
  working: ['\uf111', '●'],
  idle: ['\uf10c', '○'],
  start: ['\uf04b', '▶'],
  refresh: ['\uf021', '↻'],
  new: ['\uf067', '+'],
  filter: ['\uf002', '/'],
  archived: ['\uf187', '▪'],
  archive: ['\uf187', '×'],
  you: ['\uf007', '•'],
} as const

export type Glyph = keyof typeof GLYPHS
export type Glyphs = (name: Glyph) => string

/** The icon lookup for the `glyphs` option: anything but `plain` draws Nerd Font. */
export const glyphs = (mode: unknown): Glyphs => {
  const column = mode === 'plain' ? 1 : 0

  return name => GLYPHS[name][column]
}

// A task chip's colour, by the Board machine's state id.
export const LANE_STYLES: Record<string, [string, string]> = {
  ready: ['Ready', SP.ready],
  in_progress: ['In Progress', SP.run],
  review: ['Review', SP.agent],
  needs_attention: ['Needs attention', SP.fail],
  waiting: ['Waiting', SP.slate],
  done: ['Done', SP.ok],
}
