import type { Checks, HeldTask, Stats } from '../types'

// StarPulse's :root tokens (starpulse/web/src/style.css), its navy fills swapped for Claude Code's dark greys so the band and
// the Board sit in the app. An Svg is drawn isolated, so it spells them out.
export const SP = {
  navy: '#262624',
  bg2: '#1f1e1d',
  ink: '#dbe4f3',
  inkHi: '#e2e8f0',
  ink3: '#b8c4d8',
  slate: '#94a3b8',
  // Every outline: a warm silver that sits quietly on the chat grey.
  edge: '#d4d2c8',
  muted: '#6b7a93',
  dim: '#64748b',
  track: '#334155',
  faint: '#475569',
  surface: '#2b2a27',
  stack: '#30302e',
  ghost: '#3f4c66',
  ok: '#34d399',
  okHi: '#6ee7b7',
  run: '#fbbf24',
  runText: '#fcd34d',
  fail: '#fb7185',
  failText: '#fda4af',
  hold: '#fb923c',
  holdText: '#fdba74',
  agent: '#a78bfa',
  agentText: '#c4b5fd',
  ready: '#60a5fa',
  // The row bar's track and its criterion ticks: the slate over the chat grey, solid since a Client's colours take no alpha.
  barTrack: '#353839',
  barTick: '#474c50',
  ink0: '#05070d',
}
// Every icon the terminal draws: its Nerd Font v3 codepoint, then the plain Unicode character for a terminal without
// the font. A terminal cannot report its font, so the `glyphs` option picks the column.
const GLYPHS = {
  down: ['\uf078', '▾'],
  right: ['\uf054', '▸'],
  working: ['\uf111', '●'],
  idle: ['\uf10c', '○'],
  ready: ['\uf01c', '◇'],
  in_progress: ['\uf04b', '▶'],
  review: ['\uf06e', '◉'],
  needs_attention: ['\uf071', '!'],
  waiting: ['\uf252', '…'],
  done: ['\uf00c', '✓'],
  pass: ['\uf058', '✓'],
  pending: ['\uf192', '●'],
  fail: ['\uf057', '✗'],
  none: ['\uf1db', '○'],
  pr: ['\uf407', '#'],
  go: ['\uf08e', '↗'],
  start: ['\uf04b', '▶'],
  move: ['\uf061', '→'],
  board: ['\uf0db', '▦'],
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

/** A lane's icon: the glyph of its own name, `none` for a lane the map lacks. */
export const laneIcon = (g: Glyphs, lane: string) => g(lane in GLYPHS ? (lane as Glyph) : 'none')

const FONT = "Inter,system-ui,-apple-system,'Segoe UI',sans-serif"
const MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace"

// The lane pill's name and colour, by the Board machine's state id.
export const LANES: Record<string, [string, string]> = {
  ready: ['Ready', SP.ready],
  in_progress: ['In Progress', SP.run],
  review: ['Review', SP.agent],
  needs_attention: ['Needs attention', SP.fail],
  waiting: ['Waiting', SP.slate],
  done: ['Done', SP.ok],
}

// What a pull request's checks say and their colour; the terminal's icon is the glyph named for the check.
export const CHECKS: Record<Checks, { phrase: string; color: string }> = {
  pass: { phrase: 'checks pass', color: SP.ok },
  pending: { phrase: 'checks running', color: SP.run },
  fail: { phrase: 'checks failing', color: SP.fail },
  none: { phrase: 'no checks', color: SP.slate },
}

export const laneOf = (t: HeldTask): [string, string] => LANES[t.lane] ?? [t.column, SP.slate]

const count = (n: number) => `${n} ${n === 1 ? 'criterion' : 'criteria'}`

// k of n criteria checked; k is null when the server serves no checked state, so only the count is known.
export type Progress = { n: number; k: number | null }

export const progress = (t: HeldTask): Progress | null => {
  if (!t.criteria?.length) {
    return null
  }
  const n = t.criteria.length
  const ticks = t.criteria.map(c => c.checked)

  return { n, k: ticks.every(c => typeof c === 'boolean') ? ticks.filter(Boolean).length : null }
}

/** `2/4` when the checked state is served, else `4 criteria`. */
export const ratio = (p: Progress) => (p.k === null ? count(p.n) : `${p.k}/${p.n}`)

/** The sentence a screen reader gets for the row. */
export const alt = (t: HeldTask) => {
  const p = progress(t)
  const parts = [`${t.id}: ${laneOf(t)[0]}`]
  if (p) {
    parts.push(p.k === null ? count(p.n) : `${p.k} of ${p.n} criteria`)
  }
  if (t.pull) {
    parts.push(`PR #${t.pull.number} ${CHECKS[t.pull.checks].phrase}`)
  }

  return parts.join(', ')
}

/** What the row says beside the ID: the title, or the reason a parked task gives, or what a waiting task waits on. */
export const subline = (t: HeldTask): { text: string; color: string } => {
  if (t.reason) {
    return { text: t.reason, color: t.lane === 'needs_attention' ? SP.failText : SP.ink }
  }
  if (t.lane === 'waiting' && t.waitingOn.length) {
    return { text: `waiting on ${t.waitingOn.join(', ')}`, color: SP.slate }
  }

  return { text: t.title, color: SP.ink }
}

/** An eighth-block bar of `cells` cells, k of n filled, as its filled part and its empty track. */
export const termBar = (k: number, n: number, cells = 12): [fill: string, track: string] => {
  const eighths = Math.round((cells * 8 * k) / Math.max(1, n))
  const full = '█'.repeat(Math.floor(eighths / 8)) + (eighths % 8 ? '▏▎▍▌▋▊▉'[(eighths % 8) - 1] : '')

  return [full, '░'.repeat(cells - [...full].length)]
}

const xml = (t = '') => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

// The module has no canvas to measure with, so widths come from per-glyph advances in em, a little generous.
const advance = (ch: string) => {
  if ('iljtfI.,;:!|\'`'.includes(ch)) {
    return 0.3
  }
  if ('mwMW@%'.includes(ch)) {
    return 0.85
  }
  if (ch === ' ') {
    return 0.28
  }
  if (/[A-Z0-9]/.test(ch)) {
    return 0.64
  }

  return 0.56
}

const width = (text: string, size: number, isMono = false, weight = 400) => {
  const em = isMono ? text.length * 0.6 : [...text].reduce((sum, ch) => sum + advance(ch), 0)

  return em * size * (weight >= 500 ? 1.04 : 1)
}

const fit = (text: string, size: number, room: number, isMono = false, weight = 400) => {
  if (room < 30) {
    return ''
  }
  if (width(text, size, isMono, weight) <= room) {
    return text
  }
  let out = ''
  for (const ch of text) {
    if (width(`${out}${ch}…`, size, isMono, weight) > room) {
      break
    }
    out += ch
  }

  return `${out}…`
}

// At most `most` lines; the last is cut with an ellipsis when the text runs on.
const wrap = (text: string, size: number, room: number, weight = 400, most = 2) => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && width(next, size, false, weight) > room) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  lines.push(line)

  return lines.length > most ? [...lines.slice(0, most - 1), fit(lines.slice(most - 1).join(' '), size, room, false, weight)] : lines
}

// Motion runs only under the system's no-preference setting; a lane that is not live, and a pass or fail check, never pulse.
// `extra` is rules only one drawing uses, inside the same query.
const style = (extra = '') =>
  '<style>@media (prefers-reduced-motion: no-preference){' +
  `.live{animation:p 2s ease-in-out infinite}@keyframes p{50%{opacity:.45}}${extra}}</style>`

// A drawing is an image the page's theme cannot reach, and the system scheme need not be the app's, so every card carries its
// own dark surface: its inks read the same on a light or a dark page.
const card = (w: number, h: number, stroke: string = SP.edge, strokeOpacity = 0.16, fill: string = SP.surface, radius = 7) =>
  `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-opacity="${strokeOpacity}"/>`

const pill = (x: number, y: number, w: number, color: string, label: string, size = 11) =>
  `<rect x="${x}" y="${y}" width="${w}" height="18" rx="9" fill="${color}" fill-opacity=".14"/>` +
  `<circle cx="${x + 11}" cy="${y + 9}" r="3" fill="${color}"/>` +
  `<text x="${x + 19}" y="${y + 12.8}" font-family="${FONT}" font-size="${size}" font-weight="500" fill="${color}">${xml(label)}</text>`

const pillWidth = (label: string) => Math.ceil(width(label, 11, false, 500)) + 26

// An AC bar at the origin: one rounded segment per criterion, the k met filled in the lane colour, the rest a dark track,
// and the k/n ratio beside them; it never moves.
const meter = (n: number, k: number, color: string, w: number, h: number) => {
  const label = `${k}/${n}`
  const labelW = Math.ceil(width(label, 11, false, 600))
  const segsW = w - labelW - 8
  const gap = segsW / n >= 8 ? 3 : 1
  const segW = (segsW - gap * (n - 1)) / n
  const segs = Array.from({ length: n }, (_, i) =>
    `<rect class="seg" x="${(i * (segW + gap)).toFixed(1)}" width="${segW.toFixed(1)}" height="${h}" rx="${Math.min(3, h / 2)}" fill="${i < k ? color : SP.barTrack}"/>`,
  )
  return (
    segs.join('') +
    `<text x="${w}" y="${h / 2 + 4}" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="600" font-variant-numeric="tabular-nums" fill="${k ? SP.ink : SP.slate}">${label}</text>`
  )
}

export const ROW_HEIGHT = 30

/** The band's row as one StarPulse card: lane dot, ID, title or reason, AC bar, lane pill, PR and its checks. */
export const rowSvg = (t: HeldTask, W: number, isPicked = false) => {
  const PAD = 10
  const BAR_H = 12
  const H = ROW_HEIGHT
  const mid = H / 2
  const [laneName, color] = laneOf(t)
  const p = progress(t)
  const isLive = t.lane === 'in_progress'
  const pr = t.pull ? `#${t.pull.number}` : ''
  const prW = t.pull ? Math.ceil(width(pr, 11.5, true)) + 16 : 0
  const laneW = pillWidth(laneName)
  const idW = Math.ceil(width(t.id, 11.5, true))
  const showPr = t.pull !== null && W >= 300
  const sub = subline(t)
  const left = PAD + 14 + idW + 10
  const laneX = W - PAD - laneW - (showPr ? prW + 8 : 0)
  const prX = laneX + laneW + 8
  const text = p && p.k === null ? ratio(p) : ''
  let barW = p?.k !== null && p ? Math.max(70, Math.min(220, W * 0.26)) : Math.ceil(width(text, 11))
  let titleMax = laneX - 10 - barW - 10 - left
  // Too narrow for a readable title: drop it and give the bar the room.
  if (titleMax < 80) {
    titleMax = 0
    if (p && p.k !== null) {
      barW = Math.max(40, laneX - 10 - 10 - left)
    }
  }
  const barX = laneX - 10 - barW
  const bar =
    p && p.k !== null
      ? `<g transform="translate(${barX},${(H - BAR_H) / 2})">${meter(p.n, p.k, color, barW, BAR_H)}</g>`
      : p
        ? `<text x="${barX}" y="${mid + 4}" font-family="${FONT}" font-size="11" fill="${SP.muted}">${xml(text)}</text>`
        : ''
  const checks = t.pull ? CHECKS[t.pull.checks] : null
  const pulse = (on: boolean) => (on ? ' class="live"' : '')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style()}` +
    `<defs><clipPath id="tc"><rect x="${left}" width="${titleMax}" height="${H}"/></clipPath><filter id="g" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2"/></filter></defs>` +
    card(W, H, SP.edge, isPicked ? 0.6 : 0.16) +
    `<circle cx="${PAD + 4}" cy="${mid}" r="4" fill="${color}" filter="url(#g)" opacity=".6"/>` +
    `<circle${pulse(isLive)} cx="${PAD + 4}" cy="${mid}" r="3.5" fill="${color}"/>` +
    `<text x="${PAD + 14}" y="${mid + 4}" font-family="${MONO}" font-size="11.5" fill="${SP.slate}">${xml(t.id)}</text>` +
    (titleMax ? `<text clip-path="url(#tc)" x="${left}" y="${mid + 4.5}" font-family="${FONT}" font-size="13" fill="${sub.color}">${xml(fit(sub.text, 13, titleMax))}</text>` : '') +
    bar +
    pill(laneX, mid - 9, laneW, color, laneName) +
    (showPr && checks
      ? `<circle${pulse(t.pull?.checks === 'pending')} cx="${prX + 4}" cy="${mid}" r="3.5" fill="${checks.color}"><title>${checks.phrase}</title></circle>` +
        `<text x="${prX + 12}" y="${mid + 4}" font-family="${MONO}" font-size="11.5" fill="${SP.muted}">${pr}</text>`
      : '') +
    '</svg>'
  )
}

const GLOW = '<filter id="g" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2"/></filter>'

const svg = (W: number, H: number, body: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style(extra)}<defs>${GLOW}</defs>${body}</svg>`

const label = (x: number, y: number, text: string) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="10.5" font-weight="600" letter-spacing="1.3" fill="${SP.slate}">${xml(text)}</text>`

// A pull request's dot colour by its checks, as the StarPulse chip draws it.
const prColor = (c: Checks) => (c === 'none' ? SP.slate : CHECKS[c].color)

// One item a row lays out: its width and how it draws at a left edge and a top.
type Piece = { w: number; draw: (x: number, y: number) => string }

// A StarPulse chip: an 18-tall pill of its colour at 14%, a glowing dot, its label in the colour.
const chip = (text: string, color: string, isMono = false): Piece => {
  const size = isMono ? 11 : 11.5
  const font = isMono ? MONO : FONT

  return {
    w: Math.ceil(width(text, size, isMono)) + 29,
    draw: (x, y) =>
      `<rect x="${x}" y="${y}" width="${Math.ceil(width(text, size, isMono)) + 29}" height="18" rx="9" fill="${color}" fill-opacity=".14"/>` +
      `<circle cx="${x + 12}" cy="${y + 9}" r="3" fill="${color}" filter="url(#g)" opacity=".8"/><circle cx="${x + 12}" cy="${y + 9}" r="3" fill="${color}"/>` +
      `<text x="${x + 20}" y="${y + 12.8}" font-family="${font}" font-size="${size}" fill="${color}">${xml(text)}</text>`,
  }
}

// Pieces laid left to right from 0, wrapping at `room`; the height is from the top of the first line.
const flow = (pieces: Piece[], room: number, gapX: number, gapY = 6, h = 18) => {
  let x = 0
  let y = 0
  const out: string[] = []
  for (const it of pieces) {
    if (x && x + it.w > room) {
      x = 0
      y += h + gapY
    }
    out.push(it.draw(x, y))
    x += it.w + gapX
  }

  return { body: out.join(''), height: y + h }
}

// One line of pieces, dropping the ones past `room`.
const line = (pieces: Piece[], room: number, gap: number) => {
  let x = 0
  const out: string[] = []
  for (const it of pieces) {
    if (x + it.w > room) {
      break
    }
    out.push(it.draw(x, 0))
    x += it.w + gap
  }

  return out.join('')
}

/** The cost and token readings: dollars to the cent, tokens in thousands or millions. */
export const money = (v: number) => `$${v.toFixed(2)}`
export const kfmt = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${(v / 1e3).toFixed(1)}k`)

export const NO_STATS: Stats = { turns: 0, cost: 0, last: 0, tokens: 0, output: 0, agentMs: 0, cacheRead: 0, inputAll: 0 }

/** The session's stats as key and value, drawn as native text so a step changes only the numbers. */
export const statLines = (s: Stats): [key: string, value: string][] => [
  ['cost', money(s.cost)],
  ['last turn', money(s.last)],
  ['avg/turn', money(s.turns ? s.cost / s.turns : 0)],
  ['tokens', kfmt(s.tokens)],
  ['output', kfmt(s.output)],
  ['turns', String(s.turns)],
  ['agent', `${Math.round(s.agentMs / 60000)}m`],
  ['reuse', `${s.inputAll ? Math.round((100 * s.cacheRead) / s.inputAll) : 0}%`],
]

// The in-progress machine's phases and each one's subflow states, in order (`starpulse machine show in-progress`).
const PHASES: [id: string, name: string, subs: [id: string, name: string][]][] = [
  ['build', 'Build', [['worktree_ready', 'worktree'], ['red_proven', 'red'], ['green', 'green'], ['criteria_checked', 'criteria'], ['docs_reconciled', 'docs']]],
  ['deliver', 'Deliver', [['lint_green', 'lint'], ['committed', 'commit'], ['pushed', 'push'], ['pr_opened', 'PR'], ['ci_green', 'CI'], ['pr_ready', 'ready']]],
  ['review_fix', 'Review', [['triage', 'threads'], ['review_recorded', 'recorded']]],
]

/**
 * Where a task stands on the delivery path: the phase it is in (-1 when the board reports none, never a guess), how many
 * of that phase's substates it reached (a substate is an achievement, so `start` is none), whether it is past the last
 * one, and a needs-attention or parked flag.
 */
export const pathOf = (t: HeldTask) => {
  const isFinal = (t.phase === 'review_fix' && t.substate === 'review_recorded') || t.lane === 'review' || t.lane === 'done'
  const found = PHASES.findIndex(([id]) => id === t.phase)
  const phase = found < 0 && isFinal ? PHASES.length - 1 : found
  const at = (PHASES[phase]?.[2] ?? []).findIndex(([id]) => id === t.substate) + 1
  const flag = t.lane === 'needs_attention' ? 'bad' : t.lane === 'waiting' ? 'hold' : ''
  const why = flag === 'bad' ? t.reason || 'needs attention' : flag === 'hold' ? `parked · until ${t.waitingOn.join(', ') || 'unblocked'}` : ''

  return { phase, at, isFinal, flag, why }
}

/** The tests a task's substate proves: RED once the failing test is proven, GREEN from green on; null before either. */
export const testsOf = (t: HeldTask): { text: string; color: string } | null => {
  const { phase, at, isFinal } = pathOf(t)
  if (phase < 0) {
    return null
  }
  if (isFinal || phase > 0 || at >= 3) {
    return { text: 'tests GREEN', color: SP.ok }
  }

  return at === 2 ? { text: 'tests RED proven', color: SP.fail } : null
}

// DAG StepStar colours (DagParts.tsx) by step state, and the label ink beside each.
const DC: Record<string, string> = { done: SP.ok, now: SP.run, bad: SP.fail, hold: SP.hold, '': SP.track }
const TC: Record<string, string> = { done: SP.slate, now: SP.runText, bad: SP.failText, hold: SP.holdText, '': SP.slate }

// A ring on the page's navy with a core at 34% of r; a step not started idles at .45, and the step that runs pulses its ring.
const orb = (cx: number, cy: number, size: number, st: string) => {
  const o = st ? 1 : 0.45

  return (
    `<g transform="translate(${cx},${cy}) scale(${size / 12})">` +
    (st === 'now' ? `<circle class="ping" r="5" fill="none" stroke="${DC[st]}"/>` : '') +
    `<circle r="5" fill="${SP.navy}" stroke="${DC[st]}" stroke-opacity="${0.85 * o}"/>` +
    `<circle${st === 'now' ? ' class="live"' : ''} r="1.7" fill="${DC[st]}" fill-opacity="${0.9 * o}"/></g>`
  )
}

// A DAG link: dashed, from one step's colour to the next, streaming only into the step that runs.
const link = (id: string, x1: number, x2: number, y: number, a: string, b: string) => {
  const isHot = b === 'now'

  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" x2="${x2}" y1="0" y2="0"><stop offset="0" stop-color="${DC[a]}"/><stop offset="1" stop-color="${DC[b]}"/></linearGradient>` +
    `<line${isHot ? ' class="hot"' : ''} x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="url(#${id})" stroke-width="${isHot ? 1.9 : 1}" stroke-opacity="${isHot ? 0.8 : 0.42}" stroke-dasharray="4 2"/>`
  )
}

const STREAM =
  '.hot{animation:st .42s linear infinite}@keyframes st{to{stroke-dashoffset:-6}}' +
  '.ping{transform-box:fill-box;transform-origin:center;animation:pg 1.6s ease-out infinite}@keyframes pg{from{transform:scale(1);opacity:.7}to{transform:scale(2.1);opacity:0}}'

type Node = { st: string; w: number; draw: (x: number) => string }

// Nodes spread across `room` from x0, a link in each gap with 8px either side; the right edge of the last node.
const chain = (nodes: Node[], x0: number, y: number, room: number, prefix: string) => {
  const used = nodes.reduce((sum, n) => sum + n.w, 0)
  const span = nodes.length > 1 ? Math.max(30, (room - used) / (nodes.length - 1)) : 0
  const out: string[] = []
  let x = x0
  nodes.forEach((n, i) => {
    if (i) {
      out.push(link(`${prefix}${i}`, x + 8, x + span - 8, y, nodes[i - 1]!.st, n.st))
      x += span
    }
    out.push(n.draw(x))
    x += n.w
  })

  return out.join('')
}

const PATH_HEIGHT = 58
const UNREPORTED_HEIGHT = 30

// The two path rows: the phases reached so far, then the current phase's substates and the flag's note. A task the
// board reports no phase for gets one line saying so, never a guessed phase.
const pathRows = (t: HeldTask, W: number) => {
  const { phase, at, isFinal, flag, why } = pathOf(t)
  const room = W - 24
  if (phase < 0) {
    const said = fit(['Delivery phase not reported by the board', why].filter(Boolean).join(' · '), 11.5, room)

    return {
      h: UNREPORTED_HEIGHT,
      body: `<text x="10" y="19" font-family="${FONT}" font-size="11.5" fill="${flag === 'bad' ? SP.failText : flag === 'hold' ? SP.holdText : SP.slate}">${xml(said)}</text>`,
    }
  }
  const phases = PHASES.slice(0, isFinal ? PHASES.length : phase + 1).map(([, name, subs], i): Node => {
    const st = flag && i === phase ? flag : i < phase || isFinal ? 'done' : i === phase ? 'now' : ''
    const n = `${i < phase || isFinal ? subs.length : i === phase ? at : 0}/${subs.length}`
    const nameW = Math.ceil(width(name, 12, false, 600))

    return {
      st,
      w: 22 + nameW + 6 + Math.ceil(width(n, 10.5, true)),
      draw: x =>
        orb(x + 8, 16, 16, st) +
        `<text x="${x + 22}" y="${20.2}" font-family="${FONT}" font-size="12" font-weight="600" fill="${TC[st]}">${xml(name)}</text>` +
        `<text x="${x + 28 + nameW}" y="${20}" font-family="${MONO}" font-size="10.5" fill="${SP.slate}">${n}</text>`,
    }
  })
  const steps = PHASES[phase]![2].map(([id, name], i): Node => {
    const st = isFinal || i < at ? 'done' : i === at ? flag || 'now' : ''

    return {
      st,
      w: 20 + Math.ceil(width(name, 11.5)),
      draw: x =>
        `<g><title>${id}</title>${orb(x + 7, 39, 14, st)}<text x="${x + 20}" y="${43}" font-family="${FONT}" font-size="11.5" fill="${TC[st]}">${xml(name)}</text></g>`,
    }
  })
  const stepsW = steps.reduce((sum, n) => sum + n.w, 0) + (steps.length - 1) * 30
  const note = why ? fit(why, 11, room - stepsW - 12) : ''
  const noteW = note ? Math.ceil(width(note, 11)) + 12 : 0
  const noteColor = flag === 'bad' ? SP.failText : SP.holdText

  return {
    h: PATH_HEIGHT,
    body:
      chain(phases, 10, 16, Math.min(room, phaseRoom(phases)), 'lp') +
      chain(steps, 10, 39, Math.min(room - noteW, stepsW + 240), 'ls') +
      (note
        ? `<text x="${10 + Math.min(room - noteW, stepsW + 240) + 12}" y="${43}" font-family="${FONT}" font-size="11" fill="${noteColor}">${xml(note)}</text>`
        : ''),
  }
}

// The phases reached sit 120px apart rather than spreading across the band.
const phaseRoom = (phases: Node[]) => phases.reduce((sum, n) => sum + n.w, 0) + (phases.length - 1) * 120

// What a pull request's facts say, as chips (its number is the band's native link): its checks, its open threads and how far it is behind main.
const prChips = (pr: NonNullable<HeldTask['pull']>) => {
  const chips = [pr.checks === 'none' ? chip('checks not started', SP.slate) : chip(CHECKS[pr.checks].phrase, CHECKS[pr.checks].color)]
  if (pr.threads !== null) {
    chips.push(pr.threads ? chip(`${pr.threads} open ${pr.threads === 1 ? 'thread' : 'threads'}`, SP.run) : chip('no open threads', SP.ok))
  }
  if (pr.behindMain !== null) {
    chips.push(pr.behindMain ? chip(`${pr.behindMain} behind main`, SP.run) : chip('up to date', SP.ok))
  }

  return chips
}

// A checklist strip across the band, its pieces wrapped inside 7px by 10px on the band's own colour.
const strip = (y: number, W: number, pieces: Piece[], gapX: number) => {
  const { body, height } = flow(pieces, W - 20, gapX)
  const h = height + 14

  return {
    h,
    body: `<g transform="translate(10,${y + 7})">${body}</g>`,
  }
}

export const BAND_HEIGHT = 34

/**
 * The band's first line, its native tools laid over its right `tools` pixels: the held task's lane dot, ID, title and AC bar, or the line that
 * says no task is held. The band's own Box draws the frame, so this draws none.
 */
export const bandHeadSvg = (t: HeldTask | null, W: number, tools = 0) => {
  const H = BAND_HEIGHT
  const mid = H / 2
  if (!t) {
    return svg(
      W,
      H,
      `<text x="10" y="${mid + 4.5}" font-family="${FONT}" font-size="13" fill="${SP.slate}">${xml(fit('No task held — the band fills once this session claims one.', 13, W - 20 - tools))}</text>`,
    )
  }
  const [, color] = laneOf(t)
  const p = progress(t)
  const isLive = t.lane === 'in_progress'
  const idW = Math.ceil(width(t.id, 12, true))
  const barW = p ? (p.k === null ? Math.ceil(width(ratio(p), 11)) : 180) : 0
  const barX = W - tools - 10 - barW
  const left = 24 + idW + 10
  const bar = !p
    ? ''
    : p.k === null
      ? `<text x="${barX}" y="${mid + 4}" font-family="${FONT}" font-size="11" fill="${SP.muted}">${xml(ratio(p))}</text>`
      : `<g transform="translate(${barX},${mid - 7})">${meter(p.n, p.k, color, barW, 14)}</g>`

  return svg(
    W,
    H,
    `<circle cx="14" cy="${mid}" r="4" fill="${color}" filter="url(#g)" opacity=".6"/>` +
      `<circle${isLive ? ' class="live"' : ''} cx="14" cy="${mid}" r="3.5" fill="${color}"/>` +
      `<text x="24" y="${mid + 4}" font-family="${MONO}" font-size="12" fill="${SP.slate}">${xml(t.id)}</text>` +
      `<text x="${left}" y="${mid + 4.5}" font-family="${FONT}" font-size="13" fill="${SP.ink}">${xml(fit(t.title, 13, barX - 12 - left))}</text>` +
      bar,
  )
}

/**
 * The band below its first line: the delivery path's phases and substates, then the PR's facts and the tests chip. It
 * depends on the task alone, so a step that moves the stats leaves it as it was. With no task held, nothing.
 */
export const bandBodySvg = (t: HeldTask | null, W: number) => {
  if (!t) {
    return null
  }
  const path = pathRows(t, W)
  const parts = [path.body]
  let y = path.h
  const tests = testsOf(t)
  const facts = [...(t.pull ? prChips(t.pull) : []), ...(tests ? [chip(tests.text, tests.color)] : [])]
  if (facts.length) {
    const row = strip(y, W, facts, 8)
    parts.push(row.body)
    y += row.h
  }

  return { height: y, source: svg(W, y, parts.join(''), STREAM) }
}

/** The band folded to one line: tests chip and the task's chip, its native tools and stats over the right `tools` pixels. */
export const miniSvg = (t: HeldTask | null, W: number, tools = 0) => {
  const tests = t ? testsOf(t) : null
  const pieces = [
    ...(tests ? [chip(tests.text, tests.color)] : []),
    t ? chip(`${t.id} · ${laneOf(t)[0]}`, laneOf(t)[1], true) : chip('no task held', SP.slate),
  ]

  return svg(W, BAND_HEIGHT, `<g transform="translate(10,8)">${line(pieces, W - 20 - tools, 10)}</g>`)
}

export const LEAN_HEIGHT = 26

// The lean row's right columns: the bar with its k/n pill, and a PR slot kept even when the task has no PR, so every
// row's bar starts at one x.
const LEAN_PR = Math.ceil(width('#0000', 11, true)) + 12
const LEAN_GAP = 10
const [BAR_MIN, BAR_MAX] = [40, 600]
// What a row spends beside its ID and drawing: the lane card's border and padding, the native button's padding and the
// gap. A guess over the truth leaves a gap by the ID, one under shrinks the drawing to its slot, so it leans over.
const LEAN_CHROME = 96

/**
 * Every row's ID column in mono characters: the longest ID shown, so the bar starts just past the task number and a
 * longer ID (six digits and up) shortens the bar from its left.
 */
export const idChars = (ids: string[]) => Math.max(0, ...ids.map(i => i.length))

/**
 * Every lean drawing's width in a pane W wide: the bar takes what the ID column leaves, so one width serves every row and
 * every bar starts at one x.
 */
export const leanWidth = (W: number, ids: string[]) => {
  const id = width('0'.repeat(idChars(ids)), 13, true)
  const bar = Math.max(BAR_MIN, Math.min(BAR_MAX, Math.floor(W - id - LEAN_CHROME - LEAN_GAP - LEAN_PR)))

  return bar + LEAN_GAP + LEAN_PR
}

/**
 * The Board's row drawing where a surface runs no Client, right of the row's ID at one width so every bar starts at one
 * x: the flat AC bar with its k/n pill, and the PR with its checks. The lane is the box around it, so no dot or pill.
 */
export const leanRowSvg = (t: HeldTask, W: number) => {
  const H = LEAN_HEIGHT
  const mid = H / 2
  const p = progress(t)
  const prX = W - LEAN_PR
  const barW = prX - LEAN_GAP
  const bar = !p
    ? ''
    : p.k === null
      ? `<text x="${barW}" y="${mid + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${SP.muted}">${xml(ratio(p))}</text>`
      : `<g transform="translate(0,${mid - 6})">${meter(p.n, p.k, laneOf(t)[1], barW, 12)}</g>`

  return svg(W, H, bar + prMark(t, prX, mid))
}

// A lean row's PR: its checks dot and number at x, or nothing while none is open.
const prMark = (t: HeldTask, x: number, mid: number) => {
  const checks = t.pull ? CHECKS[t.pull.checks] : null

  return checks
    ? `<circle cx="${x + 4}" cy="${mid}" r="3.5" fill="${prColor(t.pull!.checks)}"><title>${checks.phrase}</title></circle>` +
        `<text x="${x + 12}" y="${mid + 4}" font-family="${MONO}" font-size="11" fill="${SP.muted}">#${t.pull!.number}</text>`
    : ''
}

/**
 * What a desktop row's Client draws from: the ID padded to the lane's `idW`, the criteria done and in all, the lane's
 * colour, and the PR's number with its checks colour, or none while no PR is open.
 */
export const leanRow = (t: HeldTask, idW: number) => {
  const p = progress(t)

  return {
    id: t.id,
    idW,
    k: p?.k ?? null,
    n: p?.n ?? 0,
    color: laneOf(t)[1],
    track: SP.barTrack,
    ink: SP.slate,
    muted: SP.muted,
    pr: t.pull ? `#${t.pull.number}` : '',
    prColor: t.pull ? prColor(t.pull.checks) : SP.muted,
  }
}

// The PR line of a card: its checks dot, number and phrase, or that none is open yet.
const prLine = (t: HeldTask, x: number, y: number) => {
  if (!t.pull) {
    return `<text x="${x}" y="${y + 4}" font-family="${FONT}" font-size="12" fill="${SP.slate}">none yet</text>`
  }
  const num = `#${t.pull.number}`
  const numW = Math.ceil(width(num, 12, true))
  const phrase = t.pull.checks === 'none' ? 'checks not started' : CHECKS[t.pull.checks].phrase

  return (
    `<circle cx="${x + 4}" cy="${y}" r="3.5" fill="${prColor(t.pull.checks)}"/>` +
    `<text x="${x + 13}" y="${y + 4}" font-family="${MONO}" font-size="12" fill="${SP.ink}">${num}</text>` +
    `<text x="${x + 19 + numW}" y="${y + 4}" font-family="${FONT}" font-size="12" fill="${SP.slate}">${xml(phrase)}</text>`
  )
}

/**
 * A task's detail card: its ID, title, the reason it waits, its acceptance criteria under their bar, and its pull request.
 * Drawn below the native "‹ Board" button, with the session and move buttons under it.
 */
export const paneSvg = (t: HeldTask, W: number) => {
  const PAD = 16
  const room = W - PAD * 2
  const [, color] = laneOf(t)
  const p = progress(t)
  const parts: string[] = []
  let y = PAD
  parts.push(`<text x="${PAD}" y="${y + 11}" font-family="${MONO}" font-size="12" fill="${SP.slate}">${xml(t.id)}</text>`)
  y += 24
  for (const l of wrap(t.title, 17, room, 600, 4)) {
    parts.push(`<text x="${PAD}" y="${y + 15}" font-family="${FONT}" font-size="17" font-weight="600" fill="${SP.inkHi}">${xml(l)}</text>`)
    y += 23
  }
  if (t.reason) {
    y += 4
    for (const l of wrap(t.reason, 12.5, room, 400, 3)) {
      parts.push(`<text x="${PAD}" y="${y + 12}" font-family="${FONT}" font-size="12.5" fill="${SP.failText}">${xml(l)}</text>`)
      y += 17
    }
  }
  if (t.lane === 'waiting' && t.waitingOn.length) {
    y += 4
    parts.push(`<text x="${PAD}" y="${y + 12}" font-family="${FONT}" font-size="12.5" fill="${SP.slate}">${xml(fit(`Waiting on ${t.waitingOn.join(' · ')}`, 12.5, room))}</text>`)
    y += 17
  }
  if (p) {
    y += 14
    parts.push(label(PAD, y + 9, 'ACCEPTANCE CRITERIA'))
    y += 18
    if (p.k !== null) {
      parts.push(`<g transform="translate(${PAD},${y})">${meter(p.n, p.k, color, Math.min(360, room), 12)}</g>`)
      y += 22
    }
    for (const c of t.criteria ?? []) {
      const ink = c.checked ? SP.slate : SP.ink3
      const mark = c.checked === true ? '✓' : c.checked === false ? '○' : '·'
      wrap(c.text, 12, room - 16, 400, 2).forEach((l, i) => {
        parts.push(
          (i ? '' : `<text x="${PAD}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${c.checked ? SP.ok : SP.dim}">${mark}</text>`) +
            `<text x="${PAD + 16}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${ink}">${xml(l)}</text>`,
        )
        y += 16
      })
      y += 4
    }
  }
  y += 10
  parts.push(label(PAD, y + 9, 'PULL REQUEST'))
  y += 22
  parts.push(prLine(t, PAD, y + 4))
  y += 12 + PAD
  const H = Math.ceil(y)

  return { height: H, source: svg(W, H, card(W, H, SP.edge, 0.18, SP.navy, 14) + parts.join('')) }
}
