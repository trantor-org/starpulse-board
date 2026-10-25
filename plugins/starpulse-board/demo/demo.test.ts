import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { type El, page, renderTree, type Section } from './render'

// Mounts the desktop Board pane at a narrow and a wide width, and the band, with demo tasks, and draws them as one HTML
// page. A hooks module can import no file system, so the page goes to the test output between PAGE_START and PAGE_END
// and the pull request workflow cuts it out; the test itself checks that every demo task is drawn.
declare const console: { log: (...args: unknown[]) => void }
declare const h: (...args: any[]) => unknown
declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const SESSION = 'demo-session'
const PULL = 'https://github.com/example/demo/pull'

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
}

const criteria = (checked: (boolean | undefined)[]) => checked.map((c, i) => ({ text: `Criterion ${i + 1}`, checked: c }))
const pr = (number: number, checks: string) => [{ url: `${PULL}/${number}`, number, checks }]

const task = (id: string, title: string, fields: Record<string, unknown>) => ({
  id,
  title,
  assignee: '',
  criteria: criteria([true, false, false, false]),
  pause_reason: '',
  waiting_on: [],
  prs: [],
  ...fields,
})

const DEMO_LANES = [
  ['ready', 'Ready', [task('TASK-101', 'No criterion met yet', { criteria: criteria([false, false, false]) }), task('TASK-9', 'No criteria written', { criteria: [] })]],
  ['waiting', 'Waiting', [task('TASK-102', 'Waits on the demo', { waiting_on: ['TASK-101'], criteria: criteria([false, false]) })]],
  [
    'in_progress',
    'In Progress',
    [
      task('TASK-103', 'Partly met, pull request pending', { assignee: SESSION, criteria: criteria([true, true, false, false, false]), prs: pr(15, 'pending') }),
      task('TASK-12', 'Met-state not served', { assignee: 'session-2', criteria: criteria([undefined, undefined, undefined]), prs: pr(16, 'pass') }),
      task('TASK-123456', 'A long id, one criterion', { assignee: 'session-3', criteria: criteria([false]) }),
    ],
  ],
  ['review', 'Review', [task('TASK-104', 'All criteria met, checks green', { criteria: criteria([true, true, true, true]), prs: pr(14, 'pass') }), task('TASK-105', 'All met, checks failing', { criteria: criteria([true, true]), prs: pr(1234, 'fail') })]],
  ['needs_attention', 'Needs attention', [task('TASK-106', 'Parked for the operator', { pause_reason: 'operator', criteria: criteria([true, false, false]) })]],
  ['done', 'Done', [task('TASK-1', 'Shipped', { criteria: criteria([true, true, true]), prs: pr(2, 'pass') })]],
] as const

const boardJson = (columns: readonly (readonly [string, string, readonly unknown[]])[]) =>
  JSON.stringify({ columns: columns.map(([state, name, tasks]) => ({ state, name, tasks })) })

const LANES = boardJson(DEMO_LANES)
// The band shows the task this session holds.
const HELD = boardJson([['in_progress', 'In Progress', DEMO_LANES[2][2].filter(t => t.assignee === SESSION)]])

const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// The engine kills a streaming child when `signal` aborts; the fake sends one frame and then waits for that.
const stream = async function* (event: string, board: string, signal?: AbortSignal) {
  yield { stream: 'stdout' as const, text: `event: ${event}\ndata: ${board}\n\n` }
  await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve()))
  return { value: { code: 0, signal: null } }
}

// The board a held-task feed sends and a take-over answers; the band draws the task this session holds.
type Feed = { held?: string; takeOver?: string; toasts?: string[] }

const host = (on: On, feed: Feed = {}) => {
  const held = feed.held ?? HELD
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('session.id', () => ({ value: SESSION }))
  on('session.start', ($, e) => e)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    feed.toasts?.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => answer(e.argv[0] === 'curl' ? (feed.takeOver ?? '{}\n200') : held))
  on('process.spawn', async function* ($, e, next) {
    const isLanes = e.argv.at(-1)?.includes('/api/lanes')
    return yield* (isLanes ? stream('lanes', LANES, next.signal) : stream('held', held, next.signal))
  })
}

const clients = (el: El | string, found: El[] = []): El[] => {
  if (typeof el === 'string') return found
  if (el.type === 'Client') found.push(el)
  for (const child of el.children ?? []) clients(child, found)
  return found
}

// A row Client sits inside the lane's box: its border and padding take 4 of the pane's columns.
const ROW_INSET = 4

const drawPane = async ($: any, columns: number) => {
  const ui = await $.ui.mount({
    plugin: 'starpulse-board',
    surface: 'desktop',
    component: 'Pane',
    props: { title: 'Task', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    requestId: 'starpulse-kanban',
  })
  // A folded lane's header reads "›"; the fold state outlives a mount, so open only what is shut.
  for (const button of await ui.findAll({ type: 'Button' })) {
    const key = String(button.props.key)
    if (key.startsWith('lane:') && button.props.label === '›') await ui.press({ key })
  }
  const root = (await ui.find({ type: 'Box' })) as El
  const drawn = new Map<string, El>()
  for (const client of clients(root)) {
    const key = String(client.props?.key)
    await ui.resize({ columns: columns - ROW_INSET, rows: 1, in: key })
    drawn.set(key, await ui.drawn({ in: key }))
  }
  const tree = renderTree(root, { drawClient: el => drawn.get(String(el.props?.key)) })
  await ui.unmount()
  return tree
}

// Presses Make interactive when `isPressed`, and says what the band toasted for it.
const drawBand = async ($: any, columns: number, isPressed = false) => {
  const ui = await $.ui.mount({
    plugin: 'starpulse-board',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: columns, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  if (isPressed) {
    await ui.press({ key: 'make-interactive' })
    await settle()
  }
  const tree = renderTree((await ui.find({ type: 'Box' })) as El)
  await ui.unmount()
  return tree
}

// What each test of this file draws, in order; the last test prints them as one page.
const SECTIONS: Section[] = []

// A task this session holds, and the skill machine its band draws.
const BUILD = { name: 'build', states: ['test', 'red', 'pass', 'refactor'], current: 'pass', next: { kind: 'skill', name: 'deliver' } }
const DELIVER = { name: 'deliver', states: ['lint', 'body', 'ci'], current: 'ci', next: { kind: 'operation', name: 'agent-cmd review' } }
const REVIEW_FIX = { name: 'review-fix', states: ['read', 'fix', 'reply'], current: 'fix', next: null }
const REFUSAL = 'TASK-7308 has no running workflow to take over'

// The band's states the operator approves, each a held task: its lane, phase, skill and what pressing Make interactive answers.
const BAND_STATES: { name: string; note: string; held: Record<string, unknown> | null; takeOver?: string }[] = [
  { name: 'Unattended', note: 'Make interactive is offered.', held: { skill: BUILD } },
  { name: 'Interactive', note: 'The harness reports the task interactive: the band shows driving.', held: { skill: BUILD, interactive: true } },
  { name: 'Deliver', note: 'The deliver skill declares an operation next: a square node.', held: { phase: 'deliver', substate: 'pr_opened', skill: DELIVER, prs: pr(5664, 'pending') } },
  { name: 'No next', note: 'The skill declares no next edge: no arrow.', held: { phase: 'review_fix', skill: REVIEW_FIX, prs: pr(5664, 'pass') } },
  { name: 'Attention', note: 'Needs attention: the running state takes the failure colour.', held: { skill: BUILD, lane: 'needs_attention', pause_reason: 'pick the skill blue' } },
  { name: 'Waiting', note: 'Parked: the running state takes the hold colour.', held: { phase: 'deliver', skill: DELIVER, lane: 'waiting', waiting_on: ['TASK-7310'] } },
  { name: 'Unreported', note: 'No phase and no skill reported: one line, no skill row.', held: { skill: null, phase: '', substate: '' } },
  { name: 'Empty', note: 'No task held: the band has nothing to draw.', held: null },
  { name: 'Gone', note: `The session is gone: pressing Make interactive toasts "${REFUSAL}".`, held: { skill: BUILD }, takeOver: `{"error": "${REFUSAL}"}\n409` },
]

for (const { name, note, held, takeOver } of BAND_STATES) {
  test(`the band draws the ${name} state at 100, 125 and 150 percent`, async ($, on) => {
    const { lane = 'in_progress', ...fields } = held ?? {}
    const toasts: string[] = []
    const column = [lane, String(lane), [task('TASK-7308', 'Design the next-skill and take-over controls', { assignee: SESSION, phase: 'build', substate: 'red', ...fields })]] as const
    host(on, { held: boardJson(held ? [column] : []), takeOver, toasts })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
    await settle()

    const band = await drawBand($, 100, takeOver !== undefined)
    for (const zoom of [1, 1.25, 1.5]) SECTIONS.push({ heading: `Band · ${name}`, columns: 100, note: [note, ...toasts.map(t => `Toast: ${t}`)].join(' '), tree: band, zoom })
    expect(band.unmapped.filter(u => u.endsWith('not drawn'))).toEqual([])
    if (held) expect(band.html, 'the band draws its Make interactive button or its driving text').toMatch(/Make interactive|driving/)
    if (takeOver) expect(toasts).toEqual([REFUSAL])
  })
}

test('the demo page draws every demo task at a narrow and a wide width, and the band', { timeoutMs: 60_000 }, async ($, on) => {
  host(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle()
  await $.command.run({ command: 'kanban', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await settle()

  const [narrow, wide, band] = [await drawPane($, 40), await drawPane($, 100), await drawBand($, 100)]
  SECTIONS.unshift(
    { heading: 'Board pane, narrow', columns: 40, note: 'A docked pane at its narrowest.', tree: narrow },
    { heading: 'Board pane, wide', columns: 100, tree: wide },
    { heading: 'Band above the prompt', columns: 100, note: 'The task this demo session holds.', tree: band },
  )

  const ids = DEMO_LANES.flatMap(([, , tasks]) => tasks.map(t => t.id))
  for (const id of ids) expect(wide.html, `${id} is drawn`).toContain(`>${id}<`)
  for (const tree of [narrow, wide, band]) expect(tree.unmapped.filter(u => u.endsWith('not drawn')), 'every row is drawn').toEqual([])
  expect(wide.html).toContain('TASK-103')
})

test('the demo page prints every band state at 100, 125 and 150 percent', async () => {
  const html = page({ title: 'starpulse-board desktop demo', sections: SECTIONS })

  console.log(`PAGE_START\n${html}PAGE_END`)

  for (const { name } of BAND_STATES) expect(SECTIONS.filter(s => s.heading === `Band · ${name}`).map(s => s.zoom)).toEqual([1, 1.25, 1.5])
})
