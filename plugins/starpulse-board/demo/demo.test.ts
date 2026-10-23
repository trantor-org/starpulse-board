import type { On, RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { type El, page, renderTree } from './render'

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

const host = (on: On) => {
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('session.id', () => ({ value: SESSION }))
  on('session.start', ($, e) => e)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => answer(HELD))
  on('process.spawn', async function* ($, e, next) {
    const isLanes = e.argv.at(-1)?.includes('/api/lanes')
    return yield* (isLanes ? stream('lanes', LANES, next.signal) : stream('held', HELD, next.signal))
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

const drawBand = async ($: any, columns: number) => {
  const ui = await $.ui.mount({
    plugin: 'starpulse-board',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: columns, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const tree = renderTree((await ui.find({ type: 'Box' })) as El)
  await ui.unmount()
  return tree
}

test('the demo page draws every demo task at a narrow and a wide width, and the band', { timeoutMs: 60_000 }, async ($, on) => {
  host(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle()
  await $.command.run({ command: 'kanban', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await settle()

  const [narrow, wide, band] = [await drawPane($, 40), await drawPane($, 100), await drawBand($, 100)]
  const html = page({
    title: 'starpulse-board desktop demo',
    sections: [
      { heading: 'Board pane, narrow', columns: 40, note: 'A docked pane at its narrowest.', tree: narrow },
      { heading: 'Board pane, wide', columns: 100, tree: wide },
      { heading: 'Band above the prompt', columns: 100, note: 'The task this demo session holds.', tree: band },
    ],
  })

  console.log(`PAGE_START\n${html}PAGE_END`)

  const ids = DEMO_LANES.flatMap(([, , tasks]) => tasks.map(t => t.id))
  for (const id of ids) expect(wide.html, `${id} is drawn`).toContain(`>${id}<`)
  for (const tree of [narrow, wide, band]) expect(tree.unmapped.filter(u => u.endsWith('not drawn')), 'every row is drawn').toEqual([])
  expect(html).toContain('TASK-103')
})
