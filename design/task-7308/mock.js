// TASK-7308 mockup: the real starpulse-board band (draw.js) plus the proposed active-skill row and Make interactive button.
import { SP, FONT, MONO, STREAM, bandHeadSvg, bandBodySvg, fit, svg, width, xml } from './draw.js'

// The three blues at the green's Tailwind step (--ok is emerald-400): ring and label ink.
const BLUES = {
  sky6: ['#0284c7', '#38bdf8', 'sky-600'],
  blue5: ['#3b82f6', '#60a5fa', 'blue-500'],
  blue6: ['#2563eb', '#60a5fa', 'blue-600'],
  indigo5: ['#6366f1', '#818cf8', 'indigo-500'],
}

const criteria = (k, n) => Array.from({ length: n }, (_, i) => ({ text: `AC ${i + 1}`, checked: i < k }))
const base = {
  id: 'TASK-7308', title: 'Design the next-skill and take-over controls on the StarPulse task', column: 'In Progress', lane: 'in_progress',
  holder: '', criteria: criteria(2, 5), reason: '', waitingOn: [], pull: null, phase: 'build', substate: 'red_proven',
}
const buildSkill = { name: 'build', states: [['test', 'choose test'], ['red', 'prove RED'], ['pass', 'pass'], ['refactor', 'refactor']], at: 2, next: { kind: 'skill', name: 'deliver' } }
const deliverSkill = { name: 'deliver', states: [['lint', 'fix lint'], ['body', 'write PR body'], ['ci', 'read CI']], at: 2, next: { kind: 'op', name: 'agent-cmd review' } }
const pull = { repo: 'trantor-org/trantor', number: 5664, checks: 'pending', threads: 0, behindMain: 2 }

// One starting state per address; `live: false` is a session the harness can no longer reach.
const STATES = {
  unattended: { label: 'Unattended', task: base, skill: buildSkill, mode: 'unattended' },
  interactive: { label: 'Interactive', task: base, skill: buildSkill, mode: 'interactive' },
  deliver: { label: 'Deliver → operation', task: { ...base, phase: 'deliver', substate: 'pr_opened', pull, criteria: criteria(4, 5) }, skill: deliverSkill, mode: 'unattended' },
  'no-next': {
    label: 'No declared next', mode: 'unattended',
    task: { ...base, column: 'In Progress', phase: 'review_fix', substate: '', pull: { ...pull, checks: 'pass', threads: 3, behindMain: 0 }, criteria: criteria(5, 5) },
    skill: { name: 'review-fix', states: [['read', 'read threads'], ['fix', 'fix'], ['reply', 'reply']], at: 1, next: null },
  },
  attention: {
    label: 'Needs attention', mode: 'unattended',
    task: { ...base, column: 'Needs attention', lane: 'needs_attention', substate: 'green', reason: 'pick the skill blue' },
    skill: { ...buildSkill, at: 3, flag: 'bad' },
  },
  waiting: {
    label: 'Parked', mode: 'unattended',
    task: { ...base, column: 'Waiting', lane: 'waiting', waitingOn: ['TASK-7310'], phase: 'deliver', substate: 'ci_green', pull: { ...pull, checks: 'pass' }, criteria: criteria(5, 5) },
    skill: { ...deliverSkill, at: 2, flag: 'hold' },
  },
  unreported: { label: 'Phase unreported', task: { ...base, phase: '', substate: '' }, skill: null, mode: 'unattended' },
  gone: { label: 'Session gone', task: base, skill: buildSkill, mode: 'unattended', live: false },
  empty: { label: 'No task held', task: null, skill: null, mode: 'unattended' },
}

const q = new URLSearchParams(location.search)
const key = STATES[q.get('s')] ? q.get('s') : 'unattended'
let blue = BLUES[q.get('blue')] ? q.get('blue') : 'blue5'
const st = { ...STATES[key] }
const $ = id => document.getElementById(id)

// A skill ring: the DAG orb's shape (draw.ts orb) in the skill's blue; the state that runs pulses, a flag takes its colour.
const ring = (cx, cy, size, s) => {
  const [c] = BLUES[blue]
  const col = s === 'bad' ? SP.fail : s === 'hold' ? SP.hold : s ? c : SP.track
  const o = s ? 1 : 0.45
  const live = s === 'now'

  return `<g transform="translate(${cx},${cy}) scale(${size / 12})">` +
    (live ? `<circle class="ping" r="5" fill="none" stroke="${col}"/>` : '') +
    `<circle r="5" fill="${SP.navy}" stroke="${col}" stroke-opacity="${0.85 * o}"/>` +
    `<circle${live ? ' class="live"' : ''} r="1.7" fill="${col}" fill-opacity="${(s === 'done' ? 0.55 : 0.9) * o}"/></g>`
}
const ink = s => (s === 'now' ? BLUES[blue][1] : s === 'bad' ? SP.failText : s === 'hold' ? SP.holdText : SP.slate)

// The skill's own links: dashed like the execution DAG's, in blue, streaming into the state that runs.
const slink = (x1, x2, y, b) => {
  const hot = b === 'now'

  return `<line${hot ? ' class="hot"' : ''} x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${BLUES[blue][0]}" stroke-width="${hot ? 1.9 : 1}" stroke-opacity="${hot ? 0.8 : 0.42}" stroke-dasharray="4 2"/>`
}

const SKILL_H = 30

// The active skill row: its name, its states as a chain, then a solid declared edge to what runs next, if one is declared.
const skillRow = (sk, W, mode) => {
  const y = 14
  const [c, cText] = BLUES[blue]
  const out = []
  const nameW = Math.ceil(width(sk.name, 12, false, 600))
  out.push(`<text x="10" y="${y + 4.2}" font-family="${FONT}" font-size="12" font-weight="600" fill="${cText}">${xml(sk.name)}</text>`)
  // The states spread as draw.ts chain() spreads the substates: at least 30px apart, inside the substates' 240px of slack.
  const nodes = sk.states.map(([, name]) => 20 + Math.ceil(width(name, 11.5)))
  const used = nodes.reduce((sum, w) => sum + w, 0)
  const nextW = sk.next ? 56 + Math.ceil(width(sk.next.name, 11, true)) : 0
  const room = Math.min(W - 24 - nameW - 16 - nextW, used + 240)
  const span = nodes.length > 1 ? Math.max(30, (room - used) / (nodes.length - 1)) : 0
  let x = 10 + nameW + 16
  sk.states.forEach(([id, name], i) => {
    const s = i < sk.at ? 'done' : i === sk.at ? sk.flag || 'now' : ''
    if (i) {
      out.push(slink(x + 8, x + span - 8, y, s))
      x += span
    }
    out.push(`<g><title>${id}</title>${ring(x + 7, y, 14, s)}<text x="${x + 20}" y="${y + 4}" font-family="${FONT}" font-size="11.5" fill="${ink(s)}">${xml(name)}</text></g>`)
    x += nodes[i]
  })
  x += 30
  if (sk.next) {
    const isSkill = sk.next.kind === 'skill'
    const label = isSkill && mode === 'interactive' ? `/${sk.next.name}` : sk.next.name
    const x1 = x - 22
    const x2 = x + 4
    out.push(
      `<line x1="${x1}" y1="${y}" x2="${x2 - 5}" y2="${y}" stroke="${isSkill ? c : SP.slate}" stroke-width="1.4" stroke-opacity=".75"/>` +
        `<path d="M${x2 - 6},${y - 3.5} L${x2},${y} L${x2 - 6},${y + 3.5}z" fill="${isSkill ? c : SP.slate}" fill-opacity=".85"/>`,
    )
    x = x2 + 6
    out.push(
      isSkill
        ? `<circle cx="${x + 6}" cy="${y}" r="5.5" fill="none" stroke="${c}" stroke-opacity=".7"/>`
        : `<rect x="${x + 0.5}" y="${y - 5.5}" width="11" height="11" rx="2" fill="none" stroke="${SP.slate}" stroke-opacity=".8"/>`,
    )
    const room = W - (x + 18) - 10
    out.push(`<text x="${x + 18}" y="${y + 4}" font-family="${MONO}" font-size="11" fill="${isSkill ? cText : SP.slate}">${xml(fit(label, 11, room, true))}</text>`)
  }

  return svg(W, SKILL_H, out.join(''), STREAM)
}

let toastTimer = 0
const toast = text => {
  const el = $('toast')
  el.textContent = text
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600)
}

// The Make interactive request the harness answers; a session it cannot reach refuses, as the band's tmux switch does.
const makeInteractive = () => {
  if (st.live === false) {
    toast(`${st.task.id} has no live session to make interactive`)
    return
  }
  st.mode = 'interactive'
  render()
}

const renderTools = () => {
  const tools = $('tools')
  tools.replaceChildren()
  const t = st.task
  if (t && st.mode === 'unattended') {
    const b = document.createElement('button')
    b.id = 'make-interactive'
    b.textContent = 'Make interactive'
    b.addEventListener('click', makeInteractive)
    tools.append(b)
  }
  if (t && st.mode === 'interactive') {
    const s = document.createElement('span')
    s.className = 'driving'
    s.id = 'interactive'
    s.textContent = 'Interactive'
    tools.append(s)
  }
  if (t?.pull) {
    const a = document.createElement('a')
    a.href = `https://github.com/${t.pull.repo}/pull/${t.pull.number}`
    a.textContent = `#${t.pull.number}`
    tools.append(a)
  }
  const fold = document.createElement('button')
  fold.textContent = '▾'
  fold.setAttribute('aria-label', 'Fold the band')
  tools.append(fold)
}

const render = () => {
  const W = Math.floor(document.querySelector('.pane').getBoundingClientRect().width)
  renderTools()
  const toolsW = Math.ceil($('tools').getBoundingClientRect().width)
  $('head').innerHTML = bandHeadSvg(st.task, Math.max(240, W - toolsW), 0)
  const body = bandBodySvg(st.task, W)
  $('body').innerHTML = body ? body.source : ''
  $('skill').innerHTML = st.task && st.skill ? skillRow(st.skill, W, st.mode) : ''
  $('stats').textContent = st.task ? '$2.41 · 31 turns · 1.2M tokens · 18m agent' : ''
  document.documentElement.style.setProperty('--skill', BLUES[blue][0])
  document.documentElement.style.setProperty('--skill-text', BLUES[blue][1])
}

const transcript = () => {
  const lines = st.task
    ? [['tool', '⏺ Bash  uv run agent-cmd run-tests tests/starpulse/test_phase.py'], ['tool', '  ⎿  RED_PROVEN  1 failed: test_skill_row_draws_next_edge'], ['', 'The test fails for the right reason. Writing the smallest change that passes it.'], ['tool', '⏺ Edit  hooks/draw.ts']]
    : [['', 'No task claimed in this session yet.']]
  $('transcript').replaceChildren(...lines.map(([cls, text]) => Object.assign(document.createElement('div'), { className: cls, textContent: text })))
}

const nav = () => {
  $('states').replaceChildren(...Object.entries(STATES).map(([k, v]) => {
    const a = document.createElement('a')
    a.href = `?s=${k}&blue=${blue}`
    a.textContent = v.label
    if (k === key) {
      a.setAttribute('aria-current', 'page')
    }
    return a
  }))
  $('blues').replaceChildren(...Object.entries(BLUES).map(([k, [c, , name]]) => {
    const b = document.createElement('button')
    b.setAttribute('aria-pressed', String(k === blue))
    b.dataset.blue = k
    b.innerHTML = `<span class="sw" style="background:${c}"></span>${name}`
    b.addEventListener('click', () => {
      blue = k
      history.replaceState(null, '', `?s=${key}&blue=${blue}`)
      nav()
      render()
    })
    return b
  }))
}

// Typing in the session is the harness's take-over: the band only reflects that the session became interactive.
$('input').addEventListener('input', e => {
  if (st.task && st.mode === 'unattended' && e.target.value.trim() && st.live !== false) {
    st.mode = 'interactive'
    render()
  }
})
$('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.value.trim()) {
    e.preventDefault()
    $('transcript').append(Object.assign(document.createElement('div'), { className: 'you', textContent: e.target.value.trim() }))
    e.target.value = ''
  }
})
addEventListener('resize', render)

nav()
transcript()
render()
