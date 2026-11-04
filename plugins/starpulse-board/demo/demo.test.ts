import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { type El, page, renderTree, type Section } from './render'

// Mounts the band on Desktop and in the terminal, with a demo task, and draws them as one HTML
// page. A hooks module can import no file system, so the page goes to the test output between PAGE_START and PAGE_END
// and the pull request workflow cuts it out; the test itself checks that the held task is drawn.
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

const boardJson = (columns: readonly (readonly [string, string, readonly unknown[]])[]) =>
  JSON.stringify({ columns: columns.map(([state, name, tasks]) => ({ state, name, tasks })) })

// The task this demo session holds, which the band draws.
const HELD_TASK = task('TASK-103', 'Partly met, pull request pending', { assignee: SESSION, criteria: criteria([true, true, false, false, false]), prs: pr(15, 'pending'), phase: 'deliver', substate: 'pushed' })
const HELD = boardJson([['in_progress', 'In Progress', [HELD_TASK]]])

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
  on('ui.toast', ($, e) => {
    feed.toasts?.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => answer(e.argv[0] === 'curl' ? (feed.takeOver ?? '{}\n200') : held))
  on('process.spawn', async function* ($, e, next) {
    return yield* stream('held', held, next.signal)
  })
}

// Presses Make interactive when `isPressed`, and says what the band toasted for it.
const drawBand = async ($: any, columns: number, isPressed = false, surface = 'desktop') => {
  const ui = await $.ui.mount({
    plugin: 'starpulse-board',
    surface,
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

test('the demo page draws the band this demo session holds, on Desktop and in the terminal', async ($, on) => {
  host(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle()

  const [desktop, terminal] = [await drawBand($, 100), await drawBand($, 100, false, 'terminal')]
  SECTIONS.unshift(
    { heading: 'Band above the prompt, Desktop', columns: 100, note: 'The task this demo session holds.', tree: desktop },
    { heading: 'Band above the prompt, terminal', columns: 100, note: 'The same band in cells, as the terminal draws it.', tree: terminal },
  )

  for (const tree of [desktop, terminal]) {
    expect(tree.html).toContain('TASK-103')
    expect(tree.unmapped.filter(u => u.endsWith('not drawn')), 'every element is drawn').toEqual([])
  }
  expect(terminal.html).toContain('Deliver')
})

test('the demo page prints every band state at 100, 125 and 150 percent', async () => {
  const html = page({ title: 'starpulse-board desktop demo', sections: SECTIONS })

  console.log(`PAGE_START\n${html}PAGE_END`)

  for (const { name } of BAND_STATES) expect(SECTIONS.filter(s => s.heading === `Band · ${name}`).map(s => s.zoom)).toEqual([1, 1.25, 1.5])
})
