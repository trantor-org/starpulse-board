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
    expect(await ui.find({ key: 'band' })).toBeDefined()
  })

  test(`the band stays on with no hide button (${surface})`, async ($, on) => {
    serve(on, BOARD)

    await $.command.run(RUN)
    const ui = await band($, surface)

    expect(await ui.find({ key: 'hide' })).toBeUndefined()
    expect(await ui.find({ key: 'band' })).toBeDefined()
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
}

test('Details opens the pane and Close closes it (terminal)', async ($, on) => {
  const opened: string[] = []
  serve(on, BOARD, { open: id => opened.push(`open ${id}`), close: id => opened.push(`close ${id}`) })

  await $.command.run(RUN)
  const ui = await band($, 'terminal')
  await ui.press({ key: 'details-PROJ-1' })
  expect((await ui.find({ key: 'details-PROJ-1' }))?.props.label).toBe('Close')
  expect((await ui.find({ key: 'details-PROJ-2' }))?.props.label).toBe('Details')
  await ui.press({ key: 'details-PROJ-1' })

  expect(opened).toEqual(['open starpulse-board', 'close starpulse-board'])
  expect((await ui.find({ key: 'details-PROJ-1' }))?.props.label).toBe('Details')
})

test('terminal row: ID, title, AC bar and k/n, column, PR and its checks, buttons', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'terminal')

  for (const text of ['PROJ-1', 'Add the verbs', '██████', '░░░░░░', '2/4', 'In Progress', '#392', 'PROJ-2', '████████████', '4/4', 'Review', '#388']) {
    expect(await ui.find({ type: 'Text', text }), text).toBeDefined()
  }
  expect(await checkColor(ui, 'PROJ-1')).toBe('#fbbf24')
  expect(await checkColor(ui, 'PROJ-2')).toBe('#34d399')
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

const svgs = async (ui: any) => ((await ui.findAll({ type: 'Svg' })) as any[]).map(x => x.props as { source: string; alt: string })

test('desktop band: the head carries the lane dot, ID, title and bar; the body the PR; native text the stats', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const [head, body] = await svgs(ui)

  expect(head?.alt).toBe('PROJ-1: In Progress, 2 of 4 criteria, PR #392 checks running')
  for (const text of ['PROJ-1', 'Add the verbs', '#fbbf24']) {
    expect(head?.source, text).toContain(text)
  }
  expect(body?.source).toContain('checks running')
  expect(body?.source).not.toContain('turns')
  for (const text of ['cost', 'turns', 'reuse', '$0.00']) {
    expect(await ui.find({ type: 'Text', text }), text).toBeDefined()
  }
})

for (const surface of ['desktop', 'terminal']) {
  test(`${surface} band: the plugins beneath still draw, below the band`, async ($, on) => {
    serve(on, BOARD)

    await $.command.run(RUN)
    const ui = await band($, surface)

    expect(await ui.find({ key: 'band' })).toBeDefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
  })
}

test('the band cost counts up with each main-agent step, before the turn ends', async ($, on) => {
  serve(on, BOARD)
  let usd = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } }))
  const usage = { model: 'm', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage }
  })
  const step = async (index: number, agentId?: string) => {
    const s = $.turn.step({ turnId: 't-1', index, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
    for await (const _ of s) {
    }
    await s.result
    await settle()
  }

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const drawn = await svgs(ui)
  usd = 0.25
  await step(0)
  expect(await ui.find({ type: 'Text', text: '$0.25' })).toBeDefined()
  usd = 0.5
  await step(0, 'sub-1')
  expect(await ui.find({ type: 'Text', text: '$0.25' })).toBeDefined()
  await step(1)
  expect(await ui.find({ type: 'Text', text: '$0.50' })).toBeDefined()
  // The drawings hold still while the numbers move: a step redraws text, not the band's art.
  expect(await svgs(ui)).toEqual(drawn)
})

test('desktop band: a Needs attention reason shows on the path', async ($, on) => {
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
  const [head, body] = await svgs(await band($, 'desktop'))

  expect(head?.alt).toContain('PROJ-4: Needs attention, 1 criterion')
  expect(body?.source).toContain('Operator: confirm the target was retired')
})

test('desktop band: with no held task it stays on and says so', async ($, on) => {
  serve(on, '', { run: () => answer(0, board([['ready', 'Ready', []]])) })

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const [head] = await svgs(ui)

  expect(head?.source).toContain('No task held')
  expect(await ui.find({ key: 'band' })).toBeDefined()
  expect(await ui.find({ key: 'kanban' }), 'the band has no Board button').toBeUndefined()
  expect(await ui.find({ key: 'copy' })).toBeUndefined()
})

test('desktop band: the head animates only under no-preference motion, and only for a live lane', async ($, on) => {
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

  current = quiet
  await $.command.run(RUN)
  const still = (await drawn(await band($, 'desktop')))?.source ?? ''

  expect(still).not.toContain('class="live"')
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
    const svg = await drawn(await pane($, surface))

    for (const text of ['PROJ-4', 'Investigate the alert', 'Operator: confirm it', 'ACCEPTANCE CRITERIA', '2/4', 'Criterion 1', 'Criterion 4', '#392', 'PULL REQUEST', 'checks running']) {
      expect(svg?.source, text).toContain(text)
    }
    expect(svg?.alt).toContain('PROJ-4')
    expect(svg?.alt).toContain('Needs attention')
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

// The dock's own grey is Claude Code's: the Board paints no root fill over it.
for (const [state, noFrame] of [['lanes', false], ['no frame yet', true]] as const) {
  test(`the Board tab draws on the dock's own grey with ${state}`, async ($, on) => {
    const ui = await openKanban($, on, { noFrame })

    expect((await ui.find({ key: 'board-fill' }))?.props.backgroundColor).toBeUndefined()
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
  test(`the band draws what the held-task stream sends, with no starpulse run (${surface})`, async ($, on) => {
    const stream = feed()
    const ran: string[][] = []
    const spawned: string[][] = []
    sessionsHost(on, { held: [stream], ran, spawned })

    const ui = await band($, surface)
    await start($, surface)
    stream.held(BOARD)
    await settle()

    if (surface === 'terminal') {
      expect(await ui.find({ key: 'details-PROJ-1' })).toBeDefined()
      expect(await ui.find({ key: 'details-PROJ-2' })).toBeDefined()
    } else {
      expect((await drawn(ui))?.alt).toContain('PROJ-1')
    }
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

    if (surface === 'terminal') {
      expect(await ui.find({ key: 'details-PROJ-9' })).toBeDefined()
      expect(await ui.find({ key: 'details-PROJ-1' })).toBeUndefined()
    } else {
      expect((await drawn(ui))?.alt).toContain('PROJ-9')
    }
  })

}

// The Nerd Font v3 icons the mod draws by default, and the plain characters `glyphs: plain` swaps in.
const NERD = { inProgress: '', pending: '', pass: '', move: '', board: '', go: '', pr: '' }
const PLAIN = { inProgress: '▶', pending: '●', pass: '✓', move: '→', board: '▦', go: '↗', pr: '#' }

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

    // The held task's lane icon and PR checks glyph.
    expect(has(held, set.inProgress), 'lane icon').toBe(true)
    expect(has(held, set.pending), 'checks glyph').toBe(true)
  })

  test(`glyphs=${glyphs}: the Board tab draws ${glyphs} icons`, { options: { glyphs } }, async ($, on) => {
    const ui = await openKanban($, on, { frame: COLOURED })
    await ui.press({ key: 'task:TASK-7' })
    const tab = await texts(ui)

    // Refresh, lane icon, PR glyph, then the move arrow and the go icon once a task is picked.
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
const fills = async (tree: any, root?: string) => {
  const buttons = await tree.findAll({ type: 'Button' })
  expect(buttons.length).toBeGreaterThan(0)
  for (const b of buttons) expect(b.props.plain, String(b.props.label)).toBe(true)
  const filled: string[] = []
  for (const type of ['Box', 'Text', 'Button'])
    for (const el of await tree.findAll({ type })) if (el.props.backgroundColor !== undefined) filled.push(`${type} ${el.props.backgroundColor}`)
  expect(filled).toEqual(root ? [`Box ${root}`] : [])
}

test('the Board tab sets no background: every Button is plain and the dock grey shows through', async ($, on) => {
  const ui = await openKanban($, on, { frame: COLOURED })
  await ui.press({ key: 'task:TASK-7' })

  await fills(ui)
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
// A Text's words, a Link child read as its label.
const everyText = async (ui: any) =>
  (await ui.findAll({ type: 'Text' })).map((el: any) => el.children.map((c: any) => (typeof c === 'object' ? (c?.props?.label ?? '') : String(c))).join(''))
const everyButton = async (ui: any) => (await ui.findAll({ type: 'Button' })) as any[]

test('desktop band: native buttons, a head and body drawing, no icon font, no bracketed text, a stack fill', async ($, on) => {
  const stream = feed()
  sessionsHost(on, { held: [stream] })

  const ui = await band($, 'desktop')
  await start($, 'desktop')
  stream.held(BOARD)
  await settle()

  const buttons = await everyButton(ui)
  expect(buttons.map(b => b.key), 'no Copy or Board button: the PR link and fold only').toEqual(['fold'])
  expect(buttons.some(b => b.props.plain), 'native buttons, not plain text').toBe(false)
  const drawings = await ui.findAll({ type: 'Svg' })
  expect(drawings.length, 'head and body').toBe(2)
  expect(drawings.every((s: any) => s.props.isInteractive), 'drawn in a frame, so CSS animation runs').toBe(true)
  const seen = (await everyText(ui)).join('|')
  expect(seen).not.toMatch(NERD_ICON)
  expect(seen).not.toContain('[')
  expect(seen).not.toContain('✕')
  expect((await ui.findAll({})).filter((el: any) => el.props.backgroundColor).map((el: any) => el.props.backgroundColor)).toEqual(['#30302e'])
  expect((await ui.find({ key: 'band' }))?.props.borderColor, 'a silver outline, not a lane tint').toMatch(/^#d4d2c8[0-9a-f]{2}$/)
  await ui.unmount()
})

test('desktop Board tab: a text header and flat lane headers, lean row drawings on one bordered card per lane, no rules, hints or icon font', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  const seen = (await everyText(ui)).join('|')
  expect(seen).not.toMatch(NERD_ICON)
  expect(seen).not.toContain('─')
  expect(seen).not.toContain('move')
  expect(seen).not.toContain('pick')
  expect(seen).toContain('BOARD')
  expect(seen).toContain('3 tasks · live')
  expect(seen).toContain('IN PROGRESS')
  expect(await ui.find({ key: 'rows-in_progress' }).then((r: any) => r?.props.backgroundColor), 'the lane card shows the chat grey').toBeUndefined()
  expect(await ui.find({ key: 'row-TASK-7' }).then((r: any) => r?.props.borderStyle), 'a row has no box of its own').toBeUndefined()
  const edge = /^#d4d2c8[0-9a-f]{2}$/
  const lane = (await ui.find({ key: 'rows-in_progress' })) as any
  expect(lane?.props.borderColor, 'the lane card has a silver outline').toMatch(edge)
  const buttons = await everyButton(ui)
  expect(buttons.map(b => b.key)).toEqual(expect.arrayContaining(['lane:in_progress', 'lane:ready', 'task:TASK-7']))
  expect(buttons.map(b => b.key)).not.toContain('refresh')
  const alts = (await ui.findAll({ type: 'Svg' })).map((s: any) => s.props.alt)
  expect(alts.some((a: string) => a.startsWith('TASK-7: In Progress'))).toBe(true)
  await ui.unmount()
})

test('desktop Board tab: the whole row is one plain button, a small ID and the title, with no Details, Close or status pill', async ($, on) => {
  const ui = await openKanban($, on, { frame: FULL }, 'desktop')

  const buttons = await everyButton(ui)
  expect(buttons.map(b => String(b.props.label))).not.toContain('Details')
  expect(buttons.map(b => String(b.props.label))).not.toContain('Close')
  const pick = (await ui.find({ key: 'task:TASK-7' })) as any
  expect(pick?.props).toMatchObject({ label: 'TASK-7 Busy one', plain: true })
  const [id, title] = pick.children.filter((c: any) => typeof c === 'object')
  expect(id.props, 'the ID is drawn small').toMatchObject({ size: 'caption', mono: true })
  expect(id.children.join('')).toBe('TASK-7')
  expect(title.children.join('')).toContain('Busy one')
  const row = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt.startsWith('TASK-7:')) as any
  expect(row.props.source, 'the title lives in the button, not the bar').not.toContain('Busy one')
  expect(row.props.source, 'no lane pill').not.toContain('In Progress')
  expect(row.props.height).toBe(24)
  await ui.unmount()
})

test('desktop Board tab: only Done carries the last 24h hint', async ($, on) => {
  const ui = await openKanban($, on, { frame: FULL }, 'desktop')

  const seen = await everyText(ui)
  expect(seen).toContain('1 · last 24h')
  expect(seen.filter((t: string) => t.includes('last 24h'))).toHaveLength(1)
  await ui.unmount()
})

test('desktop Board tab: the lane buttons are arrows that fold, and Ready starts folded', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  expect(await ui.find({ key: 'task:TASK-10' }), 'Ready is folded').toBeUndefined()
  const glyph = async (state: string) => String((await ui.find({ key: `lane:${state}` }))?.props.label)
  const head = (await ui.find({ key: 'head-ready' }))?.props
  expect(head, 'a lane head is a flat full-width row, folded or not').toMatchObject({ flexDirection: 'row' })
  expect(head?.borderStyle, 'a lane head draws no box').toBeUndefined()
  expect(await glyph('ready')).toBe('›')
  expect(await glyph('in_progress')).toBe('⌄')
  await ui.press({ key: 'lane:ready' })
  expect((await ui.find({ key: 'task:TASK-10' }))?.props.label).toBe('TASK-10 Ready one')
  expect(await glyph('ready')).toBe('⌄')
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
  expect(card.props.source, 'a silver outline, not the lane colour').toContain('stroke="#d4d2c8"')
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

test('desktop Board tab: a bar ends in a round cap, not a square tail', async ($, on) => {
  const ui = await openKanban($, on, {}, 'desktop')

  const row = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt.startsWith('TASK-7:')) as any
  expect(row.props.source).toMatch(/<clipPath id="c"><rect width="\d+" height="6" rx="3"\/>/)
  await ui.unmount()
})

test("desktop Board tab: every row's bar starts at one x, PR or not, whatever the ID", async ($, on) => {
  const frame = board([
    [
      'in_progress',
      'In Progress',
      [
        task({ id: 'TASK-7', title: 'Busy one', assignee: 'session-2' }),
        task({ id: 'TASK-1234', title: 'A much longer title that has to be fitted before the bar', assignee: 'session-3', prs: [] }),
      ],
    ],
    ['review', 'Review', [task({ id: 'TASK-12', title: 'Reviewed one', criteria: CRITERIA.map(c => ({ ...c, checked: true })) })]],
  ])
  const ui = await openKanban($, on, { frame }, 'desktop')

  const rows = (await ui.findAll({ type: 'Svg' })).filter((s: any) => /^TASK-\d+:/.test(s.props.alt)) as any[]
  const starts = rows.map(r => /<g transform="translate\(([\d.]+),[\d.]+\)"><clipPath/.exec(r.props.source)?.[1]).filter(Boolean)
  expect(starts.length).toBeGreaterThan(1)
  expect(new Set(starts).size).toBe(1)
  expect(new Set(rows.map(r => r.props.width)).size, 'one drawing width').toBe(1)
  await ui.unmount()
})

test('a move StarPulse marks allowed: false draws no button; an allowed one does', async ($, on) => {
  const ui = await openKanban($, on)

  await ui.press({ key: 'task:TASK-7' })
  expect(await ui.find({ key: 'move:TASK-7:review' })).toBeDefined()
  expect(await ui.find({ key: 'move:TASK-7:ready' })).toBeUndefined()
  await ui.unmount()
})

// The pane as the desktop mounts it before it has measured the dock: no columns yet.
const unmeasured = ($: any) =>
  $.ui.mount({ plugin: 'starpulse-board', surface: 'desktop', component: 'Pane', props: { ...PANE_PROPS, placement: 'dock', bodyColumns: undefined }, requestId: 'starpulse-kanban' })

test('Board tab draws its error: an unmeasured dock still draws the Board, every drawing a finite width', async ($, on) => {
  const stream = feed()
  const ui0 = await openKanban($, on, { lanes: [stream] }, 'desktop')
  await ui0.unmount()
  const ui = await unmeasured($)

  expect((await everyText(ui)).join('|')).toContain('BOARD')
  const widths = (await ui.findAll({ type: 'Svg' })).map((s: any) => s.props.width)
  expect(widths.length).toBeGreaterThan(0)
  expect(widths.every((w: number) => Number.isFinite(w) && w > 0 && w <= 4096), String(widths)).toBe(true)
  await ui.unmount()
})

test('Board tab draws its error: a task it cannot draw shows why in the tab, not a blank pane', async ($, on) => {
  const broken = board([['in_progress', 'In Progress', [task({ id: 'TASK-9', title: 42 })]]])
  const ui = await openKanban($, on, { frame: broken }, 'desktop')

  expect((await everyText(ui)).join('|')).toContain('could not draw')
  await ui.unmount()
})

test('PR chip opens the pull request: the band PR number is a native link, not a chip in the drawing', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const links = (await ui.findAll({ type: 'Link' })).map((l: any) => l.props)
  expect(links).toEqual([expect.objectContaining({ href: `${PULL}/392`, label: '#392' })])
  const [, body] = await svgs(ui)
  expect(body?.source).not.toContain('>#392<')
})

// The end colour of each streaming link: the step it streams into.
const hotEnds = (source: string) => [...source.matchAll(/<stop offset="1" stop-color="([^"]+)"\/><\/linearGradient><line class="hot"/g)].map(m => m[1])

const AT_PUSH = board([['in_progress', 'In Progress', [task({ id: 'PROJ-1', title: 'Add the verbs', phase: 'deliver', substate: 'committed' })]]])

test('steps are idle before live: a link streams only into the running step, never out toward one not started', async ($, on) => {
  serve(on, AT_PUSH)

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(hotEnds(body!.source).filter(c => c !== '#fbbf24'), 'no stream ends at an idle or finished step').toEqual([])
})

test('desktop band: a Review task streams nothing', async ($, on) => {
  serve(on, board([['review', 'Review', [task({ id: 'PROJ-2', title: 'Rotate the secret', criteria: CRITERIA.map(c => ({ ...c, checked: true })) })]]]))

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).not.toContain('class="hot"')
})

test('desktop band: the head spans the body width and its buttons sit over it, the way skins overlays', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const [head, body] = (await ui.findAll({ type: 'Svg' })).map((s: any) => s.props.width)
  expect(head).toBe(body)
  const tools = await ui.find({ key: 'tools' })
  expect(tools?.props.position).toBe('absolute')
})

test('desktop band: phases not reached yet are not drawn, and the running step pulses', async ($, on) => {
  serve(on, AT_PUSH)

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).toContain('Deliver')
  expect(body?.source, 'Review has not started').not.toContain('>Review<')
  expect(body?.source).toContain('class="ping"')
})

test('desktop band: a task the board reports no phase for says so rather than guessing one', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).toContain('Delivery phase not reported by the board')
  expect(body?.source).not.toContain('>Build<')
  expect(body?.source).not.toContain('class="hot"')
})
