import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PULL = 'https://github.com/trantor-org/starpulse/pull'
const CRITERIA = [true, true, false, false].map((checked, i) => ({ text: `Criterion ${i + 1}`, checked }))

// A task as `starpulse board --assignee` prints it.
const task = (fields: Record<string, unknown>) => ({
  assignee: 'session-1',
  criteria: CRITERIA,
  pause_reason: '',
  waiting_on: [],
  prs: [{ url: `${PULL}/392`, number: 392, checks: 'pending' }],
  ...fields,
})

const board = (columns: [string, string, unknown[]][]) =>
  JSON.stringify({ columns: columns.map(([state, name, tasks]) => ({ state, name, tasks })) })

const BOARD = board([
  ['in_progress', 'In Progress', [task({ id: 'PROJ-1', title: 'Add the verbs' })]],
  [
    'review',
    'Review',
    [task({ id: 'PROJ-2', title: 'Rotate the secret', criteria: CRITERIA.map(c => ({ ...c, checked: true })), prs: [{ url: `${PULL}/388`, checks: 'pass' }] })],
  ],
])

const SESSION = 'session-1'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const PANE_PROPS = {
  title: 'Task',
  isFocused: false,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const RUN = { command: 'board', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

// The test runner's timer; the plugin's own lib (es2023, no DOM) declares none.
declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

// Lets a refresh the engine did not await finish.
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
}

const answer = (exitCode: number, stdout: string) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

type Calls = { run?: (e: { argv: readonly string[] }) => ReturnType<typeof answer>; open?: (id: string) => void; close?: (id: string) => void }

// Serves `stdout` as the board and stands in for the engine's own drawing and panes.
const serve = (on: any, stdout: string, calls: Calls = {}) => {
  on('ui.render', ($: any, e: any) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('session.id', () => ({ value: SESSION }))
  on('process.run', (_$: any, e: any) => calls.run?.(e) ?? answer(0, stdout))
  on('ui.open', (_$: any, e: any) => {
    calls.open?.(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$: any, e: any) => {
    calls.close?.(e.id)
    return { value: undefined }
  })
}

const band = ($: any, surface: string, props: object = PROPS) =>
  $.ui.mount({ plugin: 'starpulse-board', surface, component: 'AbovePrompt', props })

const pane = ($: any, surface: string) =>
  $.ui.mount({ plugin: 'starpulse-board', surface, component: 'Pane', props: PANE_PROPS, requestId: 'starpulse-board' })

// The colour of the dot a terminal row draws for its task's PR checks.
const checkColor = async (ui: any, id: string) => ((await ui.find({ key: `checks-${id}` }))?.children[0] as { props: { color: string } } | undefined)?.props.color

// The Svg a desktop band or pane draws.
const drawn = async (ui: any) => (await ui.find({ type: 'Svg' }))?.props as { source: string; alt: string } | undefined

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/board lists the tasks this session holds (${surface})`, async ($, on) => {
    let argv: readonly string[] = []
    serve(on, BOARD, {
      run: e => {
        argv = e.argv
        return answer(0, BOARD)
      },
    })

    const { text } = await $.command.run(RUN)

    expect(argv).toEqual(['starpulse', 'board', '--assignee', SESSION])
    expect(text).toBe('PROJ-1 [In Progress] Add the verbs\nPROJ-2 [Review] Rotate the secret')
  })

  test(`an older starpulse on PATH falls back to ~/.local/bin (${surface})`, async ($, on) => {
    const argv0: string[] = []
    serve(on, BOARD, {
      run: e => {
        if (e.argv[0] === 'tmux') return answer(1, '')
        argv0.push(e.argv[0] ?? '')
        return e.argv[0] === 'starpulse' ? answer(2, '') : answer(0, BOARD)
      },
    })
    on('env.get', () => ({ value: '/home/me' }))

    const { text } = await $.command.run(RUN)

    expect(argv0).toEqual(['starpulse', '/home/me/.local/bin/starpulse'])
    expect(text).toBe('PROJ-1 [In Progress] Add the verbs\nPROJ-2 [Review] Rotate the secret')
  })

  test(`no starpulse on PATH falls back to ~/.local/bin and draws the band (${surface})`, async ($, on) => {
    const argv0: string[] = []
    serve(on, BOARD, {
      run: e => {
        if (e.argv[0] === 'tmux') return answer(1, '')
        argv0.push(e.argv[0] ?? '')
        if (e.argv[0] === 'starpulse') {
          throw new Error('ENOENT: Executable not found in $PATH: "starpulse"')
        }
        return answer(0, BOARD)
      },
    })
    on('env.get', () => ({ value: '/home/me' }))

    const { text } = await $.command.run(RUN)
    const ui = await band($, surface)

    expect(argv0).toEqual(['starpulse', '/home/me/.local/bin/starpulse'])
    expect(text).toBe('PROJ-1 [In Progress] Add the verbs\nPROJ-2 [Review] Rotate the secret')
    expect(await ui.find({ key: 'hide' })).toBeDefined()
  })

  test(`✕ takes the band down to Show task until /board (${surface})`, async ($, on) => {
    serve(on, BOARD)

    await $.command.run(RUN)
    const ui = await band($, surface)
    await ui.press({ key: 'hide' })

    expect(await ui.find({ key: 'hide' })).toBeUndefined()
    expect(await ui.find({ key: 'show' })).toBeDefined()
    await ui.press({ key: 'show' })
    expect(await ui.find({ key: 'hide' })).toBeDefined()
  })

  for (const [why, exitCode, stdout] of [
    ['no server', 3, ''],
    ['no held task', 0, board([['ready', 'Ready', []]])],
  ] as const) {
    test(`no band with ${why} (${surface})`, async ($, on) => {
      serve(on, '', { run: () => answer(exitCode, stdout) })

      const { text } = await $.command.run(RUN)
      const ui = await band($, surface)

      expect(text).toBe(exitCode ? '`starpulse board` failed: is the StarPulse server running?' : 'This session holds no tasks.')
      expect(await ui.find({ key: 'hide' })).toBeUndefined()
      expect(await ui.find({ key: 'show' })).toBeUndefined()
    })
  }

  test(`Details opens the pane and Close closes it (${surface})`, async ($, on) => {
    const opened: string[] = []
    serve(on, BOARD, { open: id => opened.push(`open ${id}`), close: id => opened.push(`close ${id}`) })

    await $.command.run(RUN)
    const ui = await band($, surface)
    await ui.press({ key: 'details-PROJ-1' })
    expect((await ui.find({ key: 'details-PROJ-1' }))?.props.label).toBe('Close')
    expect((await ui.find({ key: 'details-PROJ-2' }))?.props.label).toBe('Details')
    await ui.press({ key: 'details-PROJ-1' })

    expect(opened).toEqual(['open starpulse-board', 'close starpulse-board'])
    expect((await ui.find({ key: 'details-PROJ-1' }))?.props.label).toBe('Details')
  })
}

test('terminal row: ID, title, AC bar and k/n, column, PR and its checks, buttons', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'terminal')

  for (const text of ['PROJ-1', 'Add the verbs', '██████', '░░░░░░', '2/4', 'In Progress', '#392', 'PROJ-2', '████████████', '4/4', 'Review', '#388']) {
    expect(await ui.find({ type: 'Text', text }), text).toBeDefined()
  }
  expect(await checkColor(ui, 'PROJ-1')).toBe('#fbbf24')
  expect(await checkColor(ui, 'PROJ-2')).toBe('#34d399')
  expect((await ui.find({ key: 'hide' }))?.props.label).toBe('✕')
  expect((await ui.find({ key: 'details-PROJ-1' }))?.props.label).toBe('Details')
})

test('terminal row: a Needs attention reason replaces the title, a Waiting task names what it waits on', async ($, on) => {
  serve(
    on,
    board([
      ['waiting', 'Waiting', [task({ id: 'PROJ-3', title: 'Retro the milestone', waiting_on: ['PROJ-8', 'PROJ-9'], prs: [] })]],
      [
        'needs_attention',
        'Needs Attention',
        [task({ id: 'PROJ-4', title: 'Investigate the alert', pause_reason: 'Operator: confirm the target was retired', prs: [] })],
      ],
    ]),
  )

  await $.command.run(RUN)
  const ui = await band($, 'terminal')

  expect(await ui.find({ type: 'Text', text: 'waiting on PROJ-8, PROJ-9' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Retro the milestone' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Operator: confirm the target was retired' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Investigate the alert' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Needs attention' })).toBeDefined()
  expect(await ui.find({ key: 'checks-PROJ-3' })).toBeUndefined()
})

test('terminal row: no checked data draws a count without a bar, no criteria draws neither', async ($, on) => {
  serve(
    on,
    board([
      [
        'in_progress',
        'In Progress',
        [
          task({ id: 'PROJ-5', title: 'Text only', criteria: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }] }),
          task({ id: 'PROJ-6', title: 'Older starpulse', criteria: undefined }),
        ],
      ],
    ]),
  )

  await $.command.run(RUN)
  const ui = await band($, 'terminal')

  expect(await ui.find({ type: 'Text', text: '3 criteria' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[█░]/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\d\/\d/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Older starpulse' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /criteria/ })).toBeDefined()
})

test('desktop row: one Svg carries the ID, title, bar, k/n, lane and PR, with alt text', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const svg = await drawn(ui)

  expect(svg?.alt).toBe('PROJ-1: In Progress, 2 of 4 criteria, PR #392 checks running')
  for (const text of ['PROJ-1', 'Add the verbs', '2/4', 'In Progress', '#392', '#fbbf24']) {
    expect(svg?.source, text).toContain(text)
  }
  expect((await ui.find({ key: 'details-PROJ-1' }))?.props.label).toBe('Details')
  expect((await ui.find({ key: 'hide' }))?.props.label).toBe('Hide')
})

test('desktop row: a Needs attention reason replaces the title; no checked data drops the bar', async ($, on) => {
  serve(
    on,
    board([
      [
        'needs_attention',
        'Needs Attention',
        [task({ id: 'PROJ-4', title: 'Investigate the alert', pause_reason: 'Operator: confirm the target was retired', criteria: [{ text: 'One' }], prs: [] })],
      ],
    ]),
  )

  await $.command.run(RUN)
  const svg = await drawn(await band($, 'desktop'))

  expect(svg?.source).toContain('Operator: confirm the target was retired')
  expect(svg?.source).not.toContain('Investigate the alert')
  expect(svg?.source).toContain('1 criterion')
  expect(svg?.source).not.toMatch(/\d\/\d/)
  expect(svg?.alt).toBe('PROJ-4: Needs attention, 1 criterion')
})

test('desktop row: a narrow band drops the title, then the PR; the ID, bar and count stay', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const svg = await drawn(await band($, 'desktop', { ...PROPS, bodyColumns: 36 }))

  expect(svg?.source).toContain('PROJ-1')
  expect(svg?.source).toContain('2/4')
  expect(svg?.source).not.toContain('Add the verbs')
  expect(svg?.source).not.toContain('#392')
})

test('desktop row: the Svg animates only under no-preference motion, and only a live lane or running check animates', async ($, on) => {
  const quiet = board([['review', 'Review', [task({ id: 'PROJ-2', title: 'Rotate the secret', prs: [{ url: `${PULL}/388`, checks: 'pass' }] })]]])
  let current = BOARD
  serve(on, '', { run: () => answer(0, current) })

  await $.command.run(RUN)
  const live = (await drawn(await band($, 'desktop')))?.source ?? ''
  const gated = '@media (prefers-reduced-motion: no-preference){'
  expect(live).toContain(gated)
  expect(live).not.toContain('prefers-reduced-motion: reduce')
  expect(live).toContain('class="live"')
  expect(live.indexOf('animation:'), 'no animation outside the media query').toBeGreaterThan(live.indexOf(gated))
  expect(live).toContain('.t0,.t1,.t2,.t3{animation:tw')

  current = quiet
  await $.command.run(RUN)
  const still = (await drawn(await band($, 'desktop')))?.source ?? ''

  expect(still).not.toContain('class="live"')
  expect(still).not.toContain('.t0,.t1,.t2,.t3{animation:tw')
})

test('terminal pane: ID, title, lane and holder, reason, criteria with ticks, PR and its checks', async ($, on) => {
  serve(
    on,
    board([
      [
        'needs_attention',
        'Needs Attention',
        [task({ id: 'PROJ-4', title: 'Investigate the alert', pause_reason: 'Operator: confirm it', assignee: SESSION })],
      ],
    ]),
  )

  await $.command.run(RUN)
  const ui = await band($, 'terminal')
  await ui.press({ key: 'details-PROJ-4' })
  const pane_ = await pane($, 'terminal')

  for (const text of ['PROJ-4', 'Investigate the alert', 'Needs attention', 'Operator: confirm it', 'Acceptance criteria 2/4', '✓ Criterion 1', '○ Criterion 3', 'trantor-org/starpulse#392', 'checks running']) {
    expect(await pane_.find({ type: 'Text', text }), text).toBeDefined()
  }
  expect(await pane_.find({ type: 'Text', text: /held by session-1/ })).toBeDefined()
})

test('terminal pane: a task with no checked data lists its criteria without ticks', async ($, on) => {
  serve(on, board([['in_progress', 'In Progress', [task({ id: 'PROJ-5', title: 'Text only', criteria: [{ text: 'One' }, { text: 'Two' }], prs: [] })]]]))

  await $.command.run(RUN)
  await (await band($, 'terminal')).press({ key: 'details-PROJ-5' })
  const pane_ = await pane($, 'terminal')

  expect(await pane_.find({ type: 'Text', text: 'Acceptance criteria 2' })).toBeDefined()
  expect(await pane_.find({ type: 'Text', text: '· One' })).toBeDefined()
  expect(await pane_.find({ type: 'Text', text: /[✓○]/ })).toBeUndefined()
})

for (const surface of ['desktop', 'mobile'] as const) {
  test(`pane Svg: ID, title, lane and holder, reason, criteria list and PR (${surface})`, async ($, on) => {
    serve(
      on,
      board([
        [
          'needs_attention',
          'Needs Attention',
          [task({ id: 'PROJ-4', title: 'Investigate the alert', pause_reason: 'Operator: confirm it' })],
        ],
      ]),
    )

    await $.command.run(RUN)
    await (await band($, 'desktop')).press({ key: 'details-PROJ-4' })
    const svg = await drawn(await pane($, surface))

    for (const text of ['PROJ-4', 'Investigate the alert', 'Needs attention', 'held by session-1', 'Operator: confirm it', 'ACCEPTANCE CRITERIA', '2/4', 'Criterion 1', 'Criterion 4', 'trantor-org/starpulse#392', 'checks running']) {
      expect(svg?.source, text).toContain(text)
    }
    expect(svg?.alt).toContain('PROJ-4')
    expect(svg?.source).toContain('@media (prefers-reduced-motion: no-preference)')
  })
}

test('the pane shows the first held task when none was picked', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const svg = await drawn(await pane($, 'desktop'))

  expect(svg?.source).toContain('PROJ-1')
})

// Registered sessions besides the key files beside them: this one, one in tmux session task-7, an interactive one in no
// tmux pane (a desktop app session), and a background one in no tmux pane.
// Stands in for another dock plugin (filetree): a second plugin that opens its own pane a second into the session, then one more.
const FILES = {
  name: 'files',
  register(on: On) {
    on('session.start', async ($, e, next) => {
      $.clock.after(1000, async () => {
        await $.ui.open({ id: 'filetree', title: 'Files' })
        await $.ui.open({ id: 'other', title: 'Other' })
      })

      return next(e)
    })
  },
}

// A second plugin that closes the Board tab the way the person does, on /close-board.
const CLOSER = {
  name: 'closer',
  register(on: On) {
    on('command.run', { command: 'close-board' }, async $ => {
      await $.ui.close({ id: 'starpulse-kanban' })

      return { text: 'closed' }
    })
  },
}

// A child's output the test writes as it goes; end() exits the child, as a server restart ends curl.
const feed = () => {
  const queue: (string | null)[] = []
  let wake = () => {}
  const state = { isClosed: false }
  const push = (text: string | null) => {
    queue.push(text)
    wake()
  }
  return {
    state,
    write: (text: string) => push(text),
    // One frame of the held-task stream, carrying `board` as the server sends it.
    held: (board: string) => push(`event: held\ndata: ${board}\n\n`),
    // One frame of the lanes stream.
    lanes: (board: string) => push(`event: lanes\ndata: ${board}\n\n`),
    end: () => push(null),
    // The engine kills the child when the loop is left or `signal` aborts; the fake notes it and ends the stream.
    async *chunks(signal?: AbortSignal) {
      signal?.addEventListener('abort', () => push(null))
      try {
        while (true) {
          while (!queue.length) await new Promise<void>(r => (wake = r))
          const text = queue.shift()
          if (text === null || text === undefined) return { value: { code: 0, signal: null } }
          yield { stream: 'stdout' as const, text }
        }
      } finally {
        state.isClosed = true
      }
    },
  }
}
type Feed = ReturnType<typeof feed>

type Host = {
  switched?: string[][]
  opened?: string[]
  ran?: string[][]
  spawned?: string[][]
  everys?: number[]
  held?: Feed[]
  lanes?: Feed[]
  afters?: number[]
  hasClock?: boolean
  noFrame?: boolean
  frame?: string
  board?: () => Promise<ReturnType<typeof answer>> | ReturnType<typeof answer>
  posted?: string[][]
  post?: (argv: readonly string[]) => ReturnType<typeof answer>
  toasts?: string[]
}

// Stands in for the engine and the host: tmux, and held-task and lanes streams
// that send nothing until the test feeds them.
// A test that mocks the clock says so with hasClock, since mock.clock answers clock.every itself.
const sessionsHost = (on: On, host: Host = {}) => {
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('session.id', () => ({ value: SESSION }))
  on('session.start', ($, e) => e)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (!host.hasClock) {
    on('clock.every', ($, e) => {
      host.everys?.push(e.ms)
      return { value: undefined }
    })
  }
  if (!host.hasClock) on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  if (host.toasts) on('ui.toast', ($, e) => {
    host.toasts?.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    host.opened?.push(`${e.id} focus=${e.focus === true}`)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    host.opened?.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    host.ran?.push([...e.argv])
    if (e.argv[0] === 'tmux') {
      host.switched?.push([...e.argv])
      return answer(0, '')
    }
    if (e.argv[0] === 'curl') {
      host.posted?.push([...e.argv])
      return host.post?.(e.argv) ?? answer(0, '{}\n200')
    }
    return host.board?.() ?? answer(0, JSON.stringify({ columns: [] }))
  })
  if (host.afters) {
    // A wait that never ends, so a retry that is scheduled shows up in `afters` and does not run.
    on('clock.after', (_$, e) => {
      host.afters?.push(e.ms)
      return new Promise(() => {})
    })
  }
  on('process.spawn', async function* ($, e, next) {
    host.spawned?.push([...e.argv])
    const isLanes = e.argv.at(-1)?.includes('/api/lanes')
    const child = (isLanes ? host.lanes : host.held)?.shift() ?? feed()
    return yield* child.chunks(next.signal)
  })
}

const start = async ($: any, surface: string) => {
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await settle()
}

// The whole Board as `starpulse board` prints it: a Ready task, one In Progress held by session-2 (tmux session task-7),
// and the New and Done columns the Board tab leaves out.
const KANBAN = board([
  ['new', 'New', [task({ id: 'TASK-9', title: 'Unshaped' })]],
  ['ready', 'Ready', [task({ id: 'TASK-10', title: 'Ready one', assignee: '@agent-standard-medium', moves: { in_progress: { allowed: true }, waiting: { allowed: true } } })]],
  ['waiting', 'Waiting', []],
  ['in_progress', 'In Progress', [task({ id: 'TASK-7', title: 'Busy one', assignee: 'session-2', moves: { review: { allowed: true }, ready: { allowed: false, reason: 'made by operator, not agent' } } })]],
  ['review', 'Review', []],
  ['needs_attention', 'Needs Attention', []],
  ['done', 'Done', [task({ id: 'TASK-1', title: 'Old' })]],
])

// The Board with Ready open first, so a desktop test need not unfold it.
const KANBAN_OPEN = board([
  ['ready', 'Ready', [task({ id: 'TASK-10', title: 'Ready one', assignee: '@agent-standard-medium', moves: { in_progress: { allowed: true }, waiting: { allowed: true } } })]],
])

const kanbanPane = ($: any, surface = 'terminal') =>
  $.ui.mount({ plugin: 'starpulse-board', surface, component: 'Pane', props: { ...PANE_PROPS, placement: 'dock' }, requestId: 'starpulse-kanban' })

// The Board tab, opened from /kanban the way a person would. Each test unmounts its drawing.
const openKanban = async ($: any, on: On, host: Host = {}, surface = 'terminal') => {
  const stream = host.lanes?.[0] ?? feed()
  sessionsHost(on, { lanes: [stream], ...host })
  await start($, surface)
  await $.command.run({ ...RUN, command: 'kanban' })
  if (!host.noFrame) stream.lanes(host.frame ?? KANBAN)
  await settle()
  return kanbanPane($, surface)
}

// The JSON body a curl call sends.
const sent = (argv: readonly string[]) => JSON.parse(argv[argv.indexOf('--data') + 1] ?? 'null')

// Every lane the Board tab draws holds a task.
const FULL = board([
  ['ready', 'Ready', [task({ id: 'TASK-10', title: 'Ready one' })]],
  ['waiting', 'Waiting', [task({ id: 'TASK-11', title: 'Waiting one', waiting_on: ['TASK-7'] })]],
  ['in_progress', 'In Progress', [task({ id: 'TASK-7', title: 'Busy one', assignee: 'session-2' })]],
  ['review', 'Review', [task({ id: 'TASK-12', title: 'Reviewed one' })]],
  ['needs_attention', 'Needs attention', [task({ id: 'TASK-13', title: 'Stuck one', pause_reason: 'operator' })]],
  ['done', 'Done', [task({ id: 'TASK-1', title: 'Old' })]],
])

const laneButtons = async (ui: any) =>
  (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label)).filter((label: string) => /^[▾▸] /.test(label))

test('the Board tab lists the lanes Ready, Waiting, In Progress, Review, Needs attention, Done', async ($, on) => {
  const ui = await openKanban($, on, { frame: FULL })

  expect(await laneButtons(ui)).toEqual(['▸ Ready 1', '▸ Waiting 1', '▾ In Progress 1', '▾ Review 1', '▾ Needs attention 1', '▸ Done 1'])
  await ui.unmount()
})

test('the Board tab hides a lane with no task', async ($, on) => {
  const ui = await openKanban($, on)

  expect(await laneButtons(ui)).toEqual(['▸ Ready 1', '▾ In Progress 1', '▸ Done 1'])
  expect(await ui.find({ key: 'lane:waiting' })).toBeUndefined()
  expect(await ui.find({ key: 'lane:review' })).toBeUndefined()
  expect(await ui.find({ key: 'lane:needs_attention' })).toBeUndefined()
  await ui.unmount()
})

test('In Progress, Review and Needs attention start open; Ready, Waiting and Done start folded', async ($, on) => {
  const ui = await openKanban($, on, { frame: FULL })

  for (const id of ['TASK-7', 'TASK-12', 'TASK-13']) expect(await ui.find({ key: `task:${id}` }), `${id} is open`).toBeDefined()
  for (const id of ['TASK-10', 'TASK-11', 'TASK-1']) expect(await ui.find({ key: `task:${id}` }), `${id} is folded`).toBeUndefined()
  expect((await ui.find({ key: 'lane:done' }))?.props.label, 'Done folds to its count').toBe('▸ Done 1')
  await ui.unmount()
})

// A pane body scrolls its tree, so flexGrow has no height to fill: the root takes the body's rows to paint the dock navy to its floor.
for (const [state, noFrame] of [['lanes', false], ['no frame yet', true]] as const) {
  test(`the Board tab paints navy down the whole dock body with ${state}`, async ($, on) => {
    const ui = await openKanban($, on, { noFrame })

    expect((await ui.find({ key: 'board-fill' }))?.props).toMatchObject({ minHeight: PANE_PROPS.scroll.bodyRows, backgroundColor: '#0b1224' })
    await ui.unmount()
  })
}

test('pressing a lane header folds and unfolds it', async ($, on) => {
  const ui = await openKanban($, on)

  await ui.press({ key: 'lane:in_progress' })
  await ui.press({ key: 'lane:ready' })

  expect((await ui.find({ key: 'lane:in_progress' }))?.props.label).toBe('▸ In Progress 1')
  expect(await ui.find({ key: 'task:TASK-7' })).toBeUndefined()
  expect((await ui.find({ key: 'task:TASK-10' }))?.props.label).toBe('TASK-10 Ready one')
  await ui.unmount()
})

test('a Ready task starts a session through StarPulse, then switches tmux to it', async ($, on) => {
  const posted: string[][] = []
  const switched: string[][] = []
  const ui = await openKanban($, on, { posted, switched })

  await ui.press({ key: 'lane:ready' })
  await ui.press({ key: 'task:TASK-10' })
  expect((await ui.find({ key: 'session:TASK-10' }))?.props.label).toBe('Start session')
  await ui.press({ key: 'session:TASK-10' })

  expect(posted.map(a => a.find(x => x.startsWith('http')))).toEqual(['http://localhost:8766/api/start'])
  expect(sent(posted[0]!)).toEqual({ task: 'TASK-10', assignee: '@agent-standard-medium', harness: 'claude' })
  expect(switched).toEqual([['tmux', 'switch-client', '-t', 'task-10']])
  await ui.unmount()
})

test('an In Progress task goes to its live session without starting one', async ($, on) => {
  const posted: string[][] = []
  const switched: string[][] = []
  const ui = await openKanban($, on, { posted, switched })

  await ui.press({ key: 'task:TASK-7' })
  expect((await ui.find({ key: 'session:TASK-7' }))?.props.label).toBe('Go to session')
  await ui.press({ key: 'session:TASK-7' })

  expect(posted).toEqual([])
  expect(switched).toEqual([['tmux', 'switch-client', '-t', 'task-7']])
  await ui.unmount()
})

test('a move button moves the task through StarPulse and reads no Board', async ($, on) => {
  const posted: string[][] = []
  const ran: string[][] = []
  const ui = await openKanban($, on, { posted, ran })

  await ui.press({ key: 'task:TASK-7' })
  expect((await ui.find({ key: 'move:TASK-7:review' }))?.props.label).toBe('→ Review')
  const before = ran.length
  await ui.press({ key: 'move:TASK-7:review' })
  await settle()

  expect(posted.map(a => a.find(x => x.startsWith('http')))).toEqual(['http://localhost:8766/api/move'])
  expect(sent(posted[0]!)).toEqual({ task: 'TASK-7', to: 'review' })
  expect(ran.slice(before).filter(argv => argv[0] !== 'curl')).toEqual([])
  await ui.unmount()
})

test('a lanes frame from the stream redraws the open Board tab with no starpulse run', async ($, on) => {
  const stream = feed()
  const ran: string[][] = []
  const spawned: string[][] = []
  const ui = await openKanban($, on, { lanes: [stream], ran, spawned })
  const before = ran.length

  stream.lanes(board([['review', 'Review', [task({ id: 'TASK-11', title: 'Just arrived', assignee: 'session-3' })]]]))
  await settle()

  expect((await ui.find({ key: 'task:TASK-11' }))?.props.label).toBe('TASK-11 Just arrived')
  expect(await ui.find({ key: 'task:TASK-7' })).toBeUndefined()
  expect(ran.slice(before)).toEqual([])
  expect(spawned.find(argv => argv.at(-1)?.includes('/api/lanes'))?.at(-1)).toBe(
    'http://localhost:8766/api/lanes?state=ready&state=waiting&state=in_progress&state=review&state=needs_attention&state=done',
  )
  await ui.unmount()
})

test('a Board tab drawn with no lanes, as one left in the dock across /clear, follows the lanes stream', async ($, on) => {
  const stream = feed()
  const spawned: string[][] = []
  sessionsHost(on, { lanes: [stream], spawned })
  await start($, 'terminal')
  const ui = await kanbanPane($)
  await settle()

  stream.lanes(KANBAN)
  await settle()

  expect(spawned.filter(argv => argv.at(-1)?.includes('/api/lanes')).length).toBe(1)
  expect((await ui.find({ key: 'task:TASK-7' }))?.props.label).toBe('TASK-7 Busy one')
  await ui.unmount()
})

test('closing the Board tab ends the stream child and registers no timer', { plugins: [CLOSER] }, async ($, on) => {
  const stream = feed()
  const afters: number[] = []
  const everys: number[] = []
  const ui = await openKanban($, on, { lanes: [stream], afters, everys })
  expect(stream.state.isClosed).toBe(false)

  await $.command.run({ ...RUN, command: 'close-board' })
  await settle()

  expect(stream.state.isClosed).toBe(true)
  expect(afters).toEqual([])
  expect(everys).toEqual([])
  await ui.unmount()
})

test('reopening the Board tab follows a new stream, and opening it twice follows one', { plugins: [CLOSER] }, async ($, on) => {
  const [first, second] = [feed(), feed()]
  const spawned: string[][] = []
  const ui = await openKanban($, on, { lanes: [first, second], spawned })
  await $.command.run({ ...RUN, command: 'kanban' })
  await settle()
  const lanesStreams = () => spawned.filter(argv => argv.at(-1)?.includes('/api/lanes')).length
  expect(lanesStreams()).toBe(1)

  await $.command.run({ ...RUN, command: 'close-board' })
  await $.command.run({ ...RUN, command: 'kanban' })
  second.lanes(KANBAN)
  await settle()

  expect(lanesStreams()).toBe(2)
  expect(first.state.isClosed).toBe(true)
  expect((await ui.find({ key: 'task:TASK-7' }))?.props.label).toBe('TASK-7 Busy one')
  await ui.unmount()
})

test('a refused move shows the server\'s reason as a toast', async ($, on) => {
  const toasts: string[] = []
  const ui = await openKanban($, on, { toasts, post: () => answer(0, '{"error": "TASK-7 cannot move from in_progress to review"}\n409') })

  await ui.press({ key: 'task:TASK-7' })
  await ui.press({ key: 'move:TASK-7:review' })

  expect(toasts).toEqual(['TASK-7 cannot move from in_progress to review'])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band's Board button opens the Board tab with the keys (${surface})`, async ($, on) => {
    const opened: string[] = []
    const stream = feed()
    sessionsHost(on, { opened, held: [stream] })

    const ui = await band($, surface)
    await start($, surface)
    stream.held(BOARD)
    await settle()
    await ui.press({ key: 'kanban' })

    expect(opened.at(-1)).toBe('starpulse-kanban focus=true')
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band draws what the held-task stream sends, with no starpulse run (${surface})`, async ($, on) => {
    const stream = feed()
    const ran: string[][] = []
    const spawned: string[][] = []
    sessionsHost(on, { held: [stream], ran, spawned })

    const ui = await band($, surface)
    await start($, surface)
    stream.held(BOARD)
    await settle()

    expect(await ui.find({ key: 'details-PROJ-1' })).toBeDefined()
    expect(await ui.find({ key: 'details-PROJ-2' })).toBeDefined()
    expect(spawned.find(argv => argv[0] === 'curl')?.at(-1)).toBe('http://localhost:8766/api/held?assignee=session-1')
    expect(ran.filter(argv => argv.join(' ').includes('--assignee'))).toEqual([])
  })

  test(`a tool call and a turn's end read no board (${surface})`, async ($, on) => {
    const ran: string[][] = []
    sessionsHost(on, { ran })
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))
    on('turn.complete', () => ({ text: '' }))

    await start($, surface)
    const before = ran.length
    await $.tool.call({ tool: 'Bash', command: 'claim the task' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't-1', reason: 'answer' })
    await settle()

    expect(ran.slice(before)).toEqual([])
  })

  test(`a held-task stream that ends is opened again and its frames draw (${surface})`, async ($, on) => {
    const [first, second] = [feed(), feed()]
    const clock = mock.clock(on)
    sessionsHost(on, { held: [first, second], hasClock: true })

    const ui = await band($, surface)
    await start($, surface)
    first.held(board([['in_progress', 'In Progress', [task({ id: 'PROJ-1', title: 'Add the verbs' })]]]))
    first.end()
    await settle()
    await clock.advance(30_000)
    second.held(board([['review', 'Review', [task({ id: 'PROJ-9', title: 'After the restart' })]]]))
    await settle()

    expect(await ui.find({ key: 'details-PROJ-9' })).toBeDefined()
    expect(await ui.find({ key: 'details-PROJ-1' })).toBeUndefined()
  })

}

// The Nerd Font v3 icons the mod draws by default, and the plain characters `glyphs: plain` swaps in.
const NERD = { inProgress: '', pending: '', pass: '', move: '', refresh: '', board: '', go: '', pr: '' }
const PLAIN = { inProgress: '▶', pending: '●', pass: '✓', move: '→', refresh: '↻', board: '▦', go: '↗', pr: '#' }

const LANE_COLORS = { in_progress: '#fbbf24', review: '#a78bfa', needs_attention: '#fb7185', ready: '#60a5fa', waiting: '#94a3b8', done: '#34d399' }

// Every lane, each with one task that holds a PR and criteria, for the Board pane's colours.
const COLOURED = board([
  ['ready', 'Ready', [task({ id: 'TASK-10', title: 'Ready one', moves: { in_progress: { allowed: true } } })]],
  ['waiting', 'Waiting', [task({ id: 'TASK-11', title: 'Waits', waiting_on: ['TASK-7'] })]],
  ['in_progress', 'In Progress', [task({ id: 'TASK-7', title: 'Busy one', assignee: 'session-2', moves: { review: { allowed: true }, done: { allowed: true } } })]],
  ['review', 'Review', [task({ id: 'TASK-12', title: 'Reviewed', prs: [{ url: `${PULL}/9`, checks: 'pass' }] })]],
  ['needs_attention', 'Needs Attention', [task({ id: 'TASK-13', title: 'Stuck', pause_reason: 'Operator: pick one', prs: [] })]],
])

// Every Text of a tree as [text, color, bold], read once: each `find` costs a round trip and a test has five seconds.
type Seen = { text: string; color?: string; bold?: boolean }[]
const texts = async (tree: any): Promise<Seen> =>
  (await tree.findAll({ type: 'Text' })).map((el: any) => ({ text: el.children.join(''), color: el.props.color, bold: el.props.bold }))
const has = (seen: Seen, text: string) => seen.some(t => t.text === text)
const colorOf = (seen: Seen, text: string) => seen.find(t => t.text === text)?.color

for (const glyphs of ['nerd', 'plain'] as const) {
  const set = glyphs === 'nerd' ? NERD : PLAIN

  test(`glyphs=${glyphs}: the band draws ${glyphs} icons`, { options: { glyphs } }, async ($, on) => {
    const stream = feed()
    sessionsHost(on, { held: [stream] })
    await start($, 'terminal')
    stream.held(BOARD)
    await settle()
    const held = await texts(await band($, 'terminal'))

    // The held task's lane icon and PR checks glyph, and the summary line's Board icon.
    expect(has(held, set.inProgress), 'lane icon').toBe(true)
    expect(has(held, set.pending), 'checks glyph').toBe(true)
    expect(has(held, `${set.board} Board`), 'board icon').toBe(true)
  })

  test(`glyphs=${glyphs}: the Board tab draws ${glyphs} icons`, { options: { glyphs } }, async ($, on) => {
    const ui = await openKanban($, on, { frame: COLOURED })
    await ui.press({ key: 'task:TASK-7' })
    const tab = await texts(ui)

    // Refresh, lane icon, PR glyph, then the move arrow and the go icon once a task is picked.
    expect(has(tab, set.refresh), 'refresh').toBe(true)
    expect(has(tab, set.inProgress), 'lane icon').toBe(true)
    expect(has(tab, `${set.move} Review`), 'move arrow').toBe(true)
    expect(has(tab, `${set.go} Go to session`), 'go icon').toBe(true)
    expect(has(tab, `${set.pr} #392`), 'pr icon').toBe(true)
    await ui.unmount()
  })
}

test('the Board tab colours each lane header and icon by its lane', async ($, on) => {
  const ui = await openKanban($, on, { frame: COLOURED })
  const seen = await texts(ui)

  const names = { in_progress: 'IN PROGRESS', review: 'REVIEW', needs_attention: 'NEEDS ATTENTION', ready: 'READY', waiting: 'WAITING' } as const
  for (const [lane, name] of Object.entries(names)) {
    const header = seen.find(t => t.text === name)
    expect(header?.color, name).toBe(LANE_COLORS[lane as keyof typeof LANE_COLORS])
    expect(header?.bold, name).toBe(true)
  }
  // The lane's count sits beside it, dimmer.
  expect(colorOf(seen, '1')).toBe('#6b7a93')
  await ui.unmount()
})

test('a Board row draws the ID, title, four-cell bar and PR check icon', async ($, on) => {
  const ui = await openKanban($, on, { frame: COLOURED })

  const seen = await texts(ui)
  expect(colorOf(seen, 'TASK-7')).toBe('#94a3b8')
  expect(colorOf(seen, 'Busy one')).toBe('#dbe4f3')
  expect(colorOf(seen, '██')).toBe('#fbbf24')
  expect(colorOf(seen, '░░')).toBe('#334155')
  expect(colorOf(seen, NERD.pending)).toBe('#fbbf24')
  // A reason replaces the title in fail-text; a waiting task says what it waits on.
  expect(colorOf(seen, 'Operator: pick one')).toBe('#fda4af')
  await ui.press({ key: 'lane:waiting' })
  expect(colorOf(await texts(ui), 'waiting on TASK-7')).toBe('#94a3b8')
  await ui.unmount()
})

test('a picked task opens its title, holder, criteria, PR and actions coloured by target lane', async ($, on) => {
  const ui = await openKanban($, on, { frame: COLOURED })

  await ui.press({ key: 'task:TASK-7' })
  const seen = await texts(ui)
  const buttons = await ui.findAll({ type: 'Button' })
  const first = (key: string) => (buttons.find((b: any) => b.key === key) as any)?.children[0]?.props.color

  expect(seen.filter(t => t.text === 'Busy one').length, 'row and detail').toBe(2)
  expect(colorOf(seen, 'session-2'), 'holder').toBe('#94a3b8')
  expect(colorOf(seen, '2/4 criteria')).toBe('#6b7a93')
  expect(colorOf(seen, `${NERD.pr} #392`)).toBe('#a78bfa')
  expect(colorOf(seen, 'checks running')).toBe('#fbbf24')
  expect(first('session:TASK-7'), 'Go to session').toBe('#34d399')
  expect(first('move:TASK-7:review')).toBe('#a78bfa')
  expect(first('move:TASK-7:done')).toBe('#34d399')
  await ui.press({ key: 'task:TASK-7' })
  expect(await ui.find({ key: 'session:TASK-7' })).toBeUndefined()
  await ui.unmount()
})

test('a move to Done that StarPulse refuses toasts its reason and leaves the Board as read', async ($, on) => {
  const toasts: string[] = []
  const ui = await openKanban($, on, {
    toasts,
    frame: COLOURED,
    post: () => answer(0, '{"error": "only the operator moves TASK-7 to Done"}\n409'),
  })

  await ui.press({ key: 'task:TASK-7' })
  await ui.press({ key: 'move:TASK-7:done' })

  expect(toasts).toEqual(['only the operator moves TASK-7 to Done'])
  expect(await ui.find({ key: 'task:TASK-7' })).toBeDefined()
  await ui.unmount()
})

// No fill: a `plain` Button draws no chrome and nothing sets a background, so the terminal's own background shows through.
// The one exception is the Board pane's root Box, filled navy to cover the dock's own grey (the operator's call).
const fills = async (tree: any, root?: string) => {
  const buttons = await tree.findAll({ type: 'Button' })
  expect(buttons.length).toBeGreaterThan(0)
  for (const b of buttons) expect(b.props.plain, String(b.props.label)).toBe(true)
  const filled: string[] = []
  for (const type of ['Box', 'Text', 'Button'])
    for (const el of await tree.findAll({ type })) if (el.props.backgroundColor !== undefined) filled.push(`${type} ${el.props.backgroundColor}`)
  expect(filled).toEqual(root ? [`Box ${root}`] : [])
}

test('the Board tab fills its root navy to cover the dock grey, every Button is plain and nothing else sets a background', async ($, on) => {
  const ui = await openKanban($, on, { frame: COLOURED })
  await ui.press({ key: 'task:TASK-7' })

  await fills(ui, '#0b1224')
  await ui.unmount()
})

test('the band draws no fill: every Button is plain and no element sets a background', async ($, on) => {
  const stream = feed()
  sessionsHost(on, { board: () => answer(0, COLOURED), held: [stream] })
  await start($, 'terminal')
  stream.held(BOARD)
  await settle()

  await fills(await band($, 'terminal'))
})

// The private-use range Nerd Font icons live in: a Desktop without the font draws each as a missing-glyph box.
const NERD_ICON = /[\ue000-\uf8ff]/
const everyText = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((el: any) => String(el.children.join('')))
const everyButton = async (ui: any) => (await ui.findAll({ type: 'Button' })) as any[]

test('desktop band: native buttons, drawings for the cards, no icon font, no bracketed text, no fill', async ($, on) => {
  const stream = feed()
  sessionsHost(on, { held: [stream] })

  const ui = await band($, 'desktop')
  await start($, 'desktop')
  stream.held(BOARD)
  await settle()

  const buttons = await everyButton(ui)
  expect(buttons.map(b => b.key).sort()).toEqual(['details-PROJ-1', 'details-PROJ-2', 'hide', 'kanban'])
  expect(buttons.some(b => b.props.plain), 'native buttons, not plain text').toBe(false)
  expect((await ui.findAll({ type: 'Svg' })).length, 'one card a task').toBe(2)
  const seen = (await everyText(ui)).join('|')
  expect(seen).not.toMatch(NERD_ICON)
  expect(seen).not.toContain('[')
  expect(seen).not.toContain('✕')
  expect((await ui.findAll({})).some((el: any) => el.props.backgroundColor), 'no fill').toBe(false)
  await ui.unmount()
})

test('desktop Board tab: a header, lean rows and lane headers are drawings; buttons are native, no rules, hints, icon font or fill', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  const seen = (await everyText(ui)).join('|')
  expect(seen).not.toMatch(NERD_ICON)
  expect(seen).not.toContain('─')
  expect(seen).not.toContain('move')
  expect(seen).not.toContain('pick')
  expect(seen).toContain('BOARD')
  expect(seen).toContain('3 tasks · live')
  expect((await ui.findAll({})).some((el: any) => el.props.backgroundColor), 'the page behind shows through').toBe(false)
  const buttons = await everyButton(ui)
  expect(buttons.some(b => b.props.plain)).toBe(false)
  expect(buttons.map(b => b.key)).toEqual(expect.arrayContaining(['refresh', 'lane:in_progress', 'lane:ready', 'task:TASK-7']))
  const svgs = await ui.findAll({ type: 'Svg' })
  const alts = svgs.map((s: any) => s.props.alt)
  expect(alts).toContain('In Progress, 1')
  expect(alts.some((a: string) => a.startsWith('TASK-7: In Progress'))).toBe(true)
  const header = svgs.find((s: any) => s.props.alt === 'In Progress, 1') as any
  expect(header.props.source).toContain('IN PROGRESS')
  expect(header.props.source, 'no rule runs to the edge').not.toContain('<rect x=')
  expect(header.props.source, 'a hollow ring in the lane colour').toContain('fill="none" stroke="#fbbf24"')
  await ui.unmount()
})

test('desktop Board tab: a row is lean: its ID is the button, with no Details, Close or status pill', async ($, on) => {
  const ui = await openKanban($, on, { frame: FULL }, 'desktop')

  const buttons = await everyButton(ui)
  expect(buttons.map(b => String(b.props.label))).not.toContain('Details')
  expect(buttons.map(b => String(b.props.label))).not.toContain('Close')
  expect((await ui.find({ key: 'task:TASK-7' }))?.props.label).toBe('TASK-7')
  const row = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt.startsWith('TASK-7:')) as any
  expect(row.props.source).toContain('Busy one')
  expect(row.props.source, 'no lane pill').not.toContain('In Progress')
  expect(row.props.height).toBe(32)
  await ui.unmount()
})

test('desktop Board tab: only Done carries the last 24h hint', async ($, on) => {
  const ui = await openKanban($, on, { frame: FULL }, 'desktop')

  const svgs = await ui.findAll({ type: 'Svg' })
  const source = (alt: string) => (svgs.find((s: any) => s.props.alt === alt) as any).props.source as string
  expect(source('Done, 1')).toContain('last 24h')
  expect(source('In Progress, 1')).not.toContain('last 24h')
  await ui.unmount()
})

test('desktop Board tab: the lane buttons are arrows that fold, and Ready starts folded', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  expect(await ui.find({ key: 'task:TASK-10' }), 'Ready is folded').toBeUndefined()
  expect((await ui.find({ key: 'lane:ready' }))?.props.label).toBe('▸')
  expect((await ui.find({ key: 'lane:in_progress' }))?.props.label).toBe('▾')
  await ui.press({ key: 'lane:ready' })
  expect((await ui.find({ key: 'task:TASK-10' }))?.props.label).toBe('TASK-10')
  expect((await ui.find({ key: 'lane:ready' }))?.props.label).toBe('▾')
  await ui.unmount()
})

test('desktop Board tab: the ID opens the card with a primary Start session and a Move button a lane, which post to StarPulse', async ($, on) => {
  const posted: string[][] = []
  const ui = await openKanban($, on, { posted, frame: KANBAN_OPEN }, 'desktop')

  await ui.press({ key: 'lane:ready' })
  await ui.press({ key: 'task:TASK-10' })
  expect((await ui.find({ key: 'session:TASK-10' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'move:TASK-10:in_progress' }))?.props.label).toBe('Move to In Progress')
  expect((await ui.findAll({ type: 'Svg' })).some((s: any) => s.props.source.includes('Ready one'))).toBe(true)
  await ui.press({ key: 'move:TASK-10:in_progress' })

  expect(posted.map(sent)).toEqual([{ task: 'TASK-10', to: 'in_progress' }])
  await ui.unmount()
})

// The held stream this session's own task arrives on: TASK-7 is also in the KANBAN In Progress lane.
const HELD = board([['in_progress', 'In Progress', [task({ id: 'TASK-7', title: 'Busy one', pause_reason: '', prs: [{ url: `${PULL}/392`, number: 392, checks: 'pending' }] })]]])

test('desktop Board tab: a Current task card draws this session\'s held task and takes it out of its lane', async ($, on) => {
  const heldFeed = feed()
  heldFeed.held(HELD)
  const ui = await openKanban($, on, { held: [heldFeed] }, 'desktop')

  const card = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt.startsWith('Current task')) as any
  expect(card, 'a Current task card').toBeDefined()
  expect(card.props.alt).toContain('TASK-7')
  expect(card.props.source).toContain('THIS SESSION')
  expect(card.props.source).toContain('Busy one')
  expect(card.props.source).toContain('Criterion 1')
  expect(card.props.source).toContain('checks running')
  expect(await ui.find({ key: 'task:TASK-7' }), 'not repeated as a row').toBeUndefined()
  expect(await ui.find({ key: 'lane:in_progress' }), 'its lane is empty now, so hidden').toBeUndefined()
  expect(await ui.find({ key: 'lane:ready' })).toBeDefined()
  await ui.unmount()
})

test('desktop Board tab: the Current task card pulses yellow with no glowing border, and only under no-preference motion', async ($, on) => {
  const heldFeed = feed()
  heldFeed.held(HELD)
  const ui = await openKanban($, on, { held: [heldFeed] }, 'desktop')

  const card = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt.startsWith('Current task')) as any
  const source = card.props.source as string
  expect(source).toContain('@media (prefers-reduced-motion: no-preference){')
  expect(source).toContain('class="pulse"')
  expect(source).toContain('#fbbf24')
  expect(source, 'no glow').not.toContain('filter')
  expect(source).not.toContain('drop-shadow')
  await ui.unmount()
})

test('desktop Board tab: with no held task there is no Current task card', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  expect((await ui.findAll({ type: 'Svg' })).some((s: any) => s.props.alt.startsWith('Current task'))).toBe(false)
  await ui.unmount()
})

test('desktop Board tab: a bar ends in a square tail, not a round cap', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  const row = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt.startsWith('TASK-7:')) as any
  expect(row.props.source).toMatch(/<clipPath id="c"><rect width="\d+" height="12"\/>/)
  await ui.unmount()
})

test('a move StarPulse marks allowed: false draws no button; an allowed one does', async ($, on) => {
  const ui = await openKanban($, on)

  await ui.press({ key: 'task:TASK-7' })
  expect(await ui.find({ key: 'move:TASK-7:review' })).toBeDefined()
  expect(await ui.find({ key: 'move:TASK-7:ready' })).toBeUndefined()
  await ui.unmount()
})
