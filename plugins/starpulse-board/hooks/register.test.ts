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


// Every Text a terminal band draws, as its words, a Link read as its label.
const words = async (ui: any): Promise<string[]> =>
  (await ui.findAll({ type: 'Text' })).map((el: any) => el.children.map((c: any) => (typeof c === 'object' ? (c?.props?.label ?? '') : String(c))).join(''))

const heldOne = (fields: Record<string, unknown>) => board([[String(fields.lane ?? 'in_progress'), String(fields.column ?? 'In Progress'), [task({ id: 'PROJ-1', title: 'Add the verbs', ...fields })]]])

test('terminal band: the head carries the lane icon, ID, title, AC bar and k/n, lane, PR checks and number', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'terminal')
  const seen = await words(ui)

  for (const text of ['PROJ-1', 'Add the verbs', '██████', '░░░░░░', '2/4', 'In Progress', '#392']) {
    expect(seen, text).toContain(text)
  }
  expect(await checkColor(ui, 'PROJ-1')).toBe('#fbbf24')
  expect((await ui.findAll({ type: 'Link' })).map((l: any) => l.props.href)).toEqual([`${PULL}/392`])
  expect(seen, 'the band draws the first held task, as the desktop does').not.toContain('PROJ-2')
  expect(await ui.find({ key: 'details-PROJ-1' }), 'no Details button: there is no task pane').toBeUndefined()
})

// The head line's direct children, each with its text and whether it may shrink.
const headItems = async (ui: any) => {
  const head = await ui.find({ key: 'head' })
  return (head?.children ?? []).filter((c: any) => typeof c === 'object' && c).map((c: any) => ({ ...c, key: c.props.key })) as any[]
}

const cellsOf = (el: any): string => (typeof el === 'string' ? el : el?.props?.label && el.type === 'Link' ? el.props.label : (el?.children ?? []).map(cellsOf).join(''))

for (const columns of [60, 100, 160]) {
  test(`terminal band: at ${columns} columns the head is one row only the title gives way in`, async ($, on) => {
    serve(on, heldOne({ title: 'Let any agent session edit a held task without waiting for the board to answer' }))

    await $.command.run(RUN)
    const ui = await band($, 'terminal', { ...PROPS, bodyColumns: columns })
    const items = await headItems(ui)
    const fixed = items.filter(c => c.key !== 'head-title')

    expect(items.find(c => c.key === 'head-title')?.props.flexShrink, 'the title shrinks').toBe(1)
    for (const c of fixed) {
      expect(c.props.flexShrink, `${c.key} keeps its width`).toBe(0)
    }
    const used = fixed.reduce((n, c) => n + Math.max(cellsOf(c).length, 1), 0) + items.length - 1
    expect(used, 'the fixed items leave the title room').toBeLessThanOrEqual(columns - 16)
    const kept = fixed.map(c => c.key)
    for (const key of ['head-icon', 'head-id', 'head-ratio', 'head-lane', 'checks-PROJ-1', 'head-pr', 'head-fold']) {
      expect(kept, key).toContain(key)
    }
    const text = (key: string) => cellsOf(fixed.find(c => c.key === key))
    expect([text('head-id'), text('head-ratio'), text('head-lane'), text('head-pr')]).toEqual(['PROJ-1', '2/4', 'In Progress', '#392'])
    expect(kept.includes('head-bar'), 'the AC bar shows only with room').toBe(columns >= 100)
    expect(kept.includes('head-take-over'), 'the take-over shows with room').toBe(columns >= 100)
  })
}

test('terminal band: the head names the PR in plain text and the facts row carries its link', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'terminal')

  const links = (el: any): any[] => (typeof el !== 'object' || !el ? [] : [...(el.type === 'Link' ? [el] : []), ...(el.children ?? []).flatMap(links)])
  expect(links(await ui.find({ key: 'head' })), 'a terminal without hyperlinks spells the URL out, so the head holds none').toEqual([])
  expect(links(await ui.find({ key: 'facts' })).map(l => l.props.label)).toEqual(['#392'])
})

test('terminal band: the delivery path draws the phases reached and the current substates, the running one ringed', async ($, on) => {
  serve(on, heldOne({ phase: 'deliver', substate: 'committed' }))

  await $.command.run(RUN)
  const ui = await band($, 'terminal')
  const seen = await texts(ui)

  for (const text of ['Build', '5/5', 'Deliver', '2/6', 'lint', 'commit', 'push', 'PR', 'CI', 'ready']) {
    expect(has(seen, text), text).toBe(true)
  }
  expect(has(seen, 'Review'), 'a phase not reached is not drawn').toBe(false)
  const marks = seen.filter(t => ['●', '◉', '○'].includes(t.text))
  expect(marks.map(t => t.text)).toEqual(['●', '◉', '●', '●', '◉', '○', '○', '○'])
  expect(marks[1]?.color, 'the running phase in the run colour').toBe('#fbbf24')
  expect(marks[0]?.color, 'a finished phase in the done colour').toBe('#34d399')
})

test('terminal band: a task the board reports no phase for says so rather than guessing one', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const seen = await words(await band($, 'terminal'))

  expect(seen).toContain('Delivery phase not reported by the board')
  expect(seen).not.toContain('Build')
})

test('terminal band: a Needs attention reason replaces the title and shows on the path, in the failure colour', async ($, on) => {
  serve(on, heldOne({ lane: 'needs_attention', column: 'Needs Attention', phase: 'build', substate: 'red_proven', pause_reason: 'Operator: confirm the target was retired', prs: [] }))

  await $.command.run(RUN)
  const seen = await texts(await band($, 'terminal'))

  expect(seen.filter(t => t.text === 'Operator: confirm the target was retired').map(t => t.color)).toEqual(['#fda4af', '#fda4af'])
  expect(has(seen, 'Add the verbs')).toBe(false)
  expect(has(seen, 'Needs attention')).toBe(true)
})

test('terminal band: a Waiting task names what it waits on', async ($, on) => {
  serve(on, heldOne({ lane: 'waiting', column: 'Waiting', waiting_on: ['PROJ-8', 'PROJ-9'], prs: [] }))

  await $.command.run(RUN)
  const seen = await words(await band($, 'terminal'))

  expect(seen).toContain('waiting on PROJ-8, PROJ-9')
  expect(seen).not.toContain('Add the verbs')
})

test('terminal band: no checked data draws a count without a bar, no criteria draws neither', async ($, on) => {
  let current = heldOne({ criteria: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }] })
  serve(on, '', { run: () => answer(0, current) })

  await $.command.run(RUN)
  const seen = await words(await band($, 'terminal'))
  expect(seen).toContain('3 criteria')
  expect(seen.some(t => /[█░]/.test(t))).toBe(false)

  current = heldOne({ criteria: undefined })
  await $.command.run(RUN)
  const none = await words(await band($, 'terminal'))
  expect(none.some(t => /[█░]|criteri/.test(t))).toBe(false)
})

const TERM_SKILL = { name: 'build', states: ['test', 'red', 'pass', 'refactor'], current: 'pass' }

test('terminal band: the active skill draws its own blue row, with an arrow to a declared next skill', async ($, on) => {
  serve(on, heldOne({ phase: 'build', substate: 'red_proven', skill: { ...TERM_SKILL, next: { kind: 'skill', name: 'deliver' } } }))

  await $.command.run(RUN)
  const ui = await band($, 'terminal')
  const seen = await texts(ui)

  expect(seen.find(t => t.text === 'build')?.color).toBe('#60a5fa')
  for (const state of TERM_SKILL.states) {
    expect(has(seen, state), state).toBe(true)
  }
  expect(await ui.find({ key: 'next-skill' })).toBeDefined()
  expect(has(seen, 'deliver')).toBe(true)
})

test('terminal band: a next operation is a square node; no next edge draws no arrow; no skill draws no row', async ($, on) => {
  let current = heldOne({ skill: { ...TERM_SKILL, next: { kind: 'operation', name: 'agent-cmd review' } } })
  serve(on, '', { run: () => answer(0, current) })
  await $.command.run(RUN)
  let ui = await band($, 'terminal')
  expect(await ui.find({ key: 'next-operation' })).toBeDefined()
  expect(await words(ui)).toContain('agent-cmd review')
  await ui.unmount()

  current = heldOne({ skill: { ...TERM_SKILL, next: null } })
  await $.command.run(RUN)
  ui = await band($, 'terminal')
  expect(await ui.find({ key: 'skill' })).toBeDefined()
  expect(await ui.find({ key: 'next-skill' })).toBeUndefined()
  expect(await ui.find({ key: 'next-operation' })).toBeUndefined()
  await ui.unmount()

  current = heldOne({ skill: null })
  await $.command.run(RUN)
  ui = await band($, 'terminal')
  expect(await ui.find({ key: 'skill' })).toBeUndefined()
})

test('terminal band: the PR facts, the tests and the session stats', async ($, on) => {
  serve(on, heldOne({ phase: 'deliver', substate: 'pushed', prs: [{ url: `${PULL}/392`, number: 392, checks: 'pending', threads: 2, behind_main: 0 }] }))

  await $.command.run(RUN)
  const seen = await words(await band($, 'terminal'))

  for (const text of ['checks running', '2 open threads', 'up to date', 'tests GREEN', 'cost', '$0.00', 'turns', 'reuse']) {
    expect(seen, text).toContain(text)
  }
})

test('terminal band: the fold arrow folds it to its head line with the cost and turns, and back', async ($, on) => {
  serve(on, heldOne({ phase: 'deliver', substate: 'pushed' }))

  await $.command.run(RUN)
  const ui = await band($, 'terminal')
  expect((await ui.find({ key: 'fold' }))?.props.label).toBe('▾')
  await ui.press({ key: 'fold' })
  expect((await ui.find({ key: 'fold' }))?.props.label).toBe('▴')
  const folded = await words(ui)
  expect(await ui.find({ key: 'stats' })).toBeUndefined()
  expect(await ui.find({ key: 'phases' })).toBeUndefined()
  for (const text of ['PROJ-1', '$0.00', 'turns', 'tests GREEN']) {
    expect(folded, text).toContain(text)
  }
  await ui.press({ key: 'fold' })
  expect(await ui.find({ key: 'stats' })).toBeDefined()
  await ui.unmount()
})

test('terminal band: with no held task it stays on and says so, with no take-over or PR', async ($, on) => {
  serve(on, '', { run: () => answer(0, board([['ready', 'Ready', []]])) })

  await $.command.run(RUN)
  const ui = await band($, 'terminal')

  expect(await words(ui)).toContain('No task held')
  expect(await ui.find({ key: 'band' })).toBeDefined()
  expect(await ui.find({ key: 'make-interactive' })).toBeUndefined()
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
})

const svgs = async (ui: any) => ((await ui.findAll({ type: 'Svg' })) as any[]).map(x => x.props as { source: string; alt: string })

test('desktop band: the AC bar is one segment per criterion, the done ones filled, taller than a hairline', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const [head] = await svgs(await band($, 'desktop'))
  const segs = [...(head?.source ?? '').matchAll(/<rect class="seg"[^>]*height="(\d+)"[^>]*fill="([^"]+)"/g)]
  expect(segs.length, 'four criteria, four segments').toBe(4)
  expect(segs.map(m => m[2] === '#fbbf24'), 'two done in the lane colour, two open').toEqual([true, true, false, false])
  expect(Number(segs[0][1])).toBeGreaterThanOrEqual(14)
  expect(head?.source, 'the ratio sits beside the segments').toContain('>2/4<')
})

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

for (const surface of ['desktop', 'terminal']) {
  test(`${surface} band: stays drawn above a survey, with the survey's own drawing below`, async ($, on) => {
    serve(on, BOARD)

    await $.command.run(RUN)
    const ui = await band($, surface, { ...PROPS, hasSurvey: true })

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
  afters?: number[]
  hasClock?: boolean
  noFrame?: boolean
  frame?: string
  board?: () => Promise<ReturnType<typeof answer>> | ReturnType<typeof answer>
  posted?: string[][]
  post?: (argv: readonly string[]) => ReturnType<typeof answer>
  toasts?: string[]
  registered?: string[]
}

// Stands in for the engine and the host: tmux, and a held-task stream
// that send nothing until the test feeds them.
// A test that mocks the clock says so with hasClock, since mock.clock answers clock.every itself.
const sessionsHost = (on: On, host: Host = {}) => {
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('session.id', () => ({ value: SESSION }))
  on('session.start', ($, e) => e)
  on('command.register', ($, e) => {
    host.registered?.push(e.name)
    return { value: { command: e.name } }
  })
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
    const child = host.held?.shift() ?? feed()
    return yield* child.chunks(next.signal)
  })
}

const start = async ($: any, surface: string) => {
  await $.session.start({ cwd: '/work', surface, isInteractive: true })
  await settle()
}

// The JSON body a curl call sends.
const sent = (argv: readonly string[]) => JSON.parse(argv[argv.indexOf('--data') + 1] ?? 'null')

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
      expect(await ui.find({ type: 'Text', text: 'PROJ-1' })).toBeDefined()
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
      expect(await ui.find({ type: 'Text', text: 'PROJ-9' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'PROJ-1' })).toBeUndefined()
    } else {
      expect((await drawn(ui))?.alt).toContain('PROJ-9')
    }
  })

}

// The Nerd Font v3 icons the mod draws by default, and the plain characters `glyphs: plain` swaps in.
const NERD = { inProgress: '', pending: '' }
const PLAIN = { inProgress: '▶', pending: '●' }

// A task in every lane but Done, each with a PR and criteria.
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
}

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

test('desktop band: native buttons, a head and body drawing, no icon font, no bracketed text, no fill or frame', async ($, on) => {
  const stream = feed()
  sessionsHost(on, { held: [stream] })

  const ui = await band($, 'desktop')
  await start($, 'desktop')
  stream.held(BOARD)
  await settle()

  const buttons = await everyButton(ui)
  expect(buttons.map(b => b.key), 'no Copy or Board button: Make interactive, the PR link and fold only').toEqual(['make-interactive', 'fold'])
  expect(buttons.some(b => b.props.plain), 'native buttons, not plain text').toBe(false)
  const drawings = await ui.findAll({ type: 'Svg' })
  expect(drawings.length, 'head and body').toBe(2)
  expect(drawings.every((s: any) => s.props.isInteractive), 'drawn in a frame, so CSS animation runs').toBe(true)
  const seen = (await everyText(ui)).join('|')
  expect(seen).not.toMatch(NERD_ICON)
  expect(seen).not.toContain('[')
  expect(seen).not.toContain('✕')
  expect((await ui.findAll({})).filter((el: any) => el.props.backgroundColor), 'the band shows the page background').toEqual([])
  expect((await ui.find({ key: 'band' }))?.props.borderStyle, 'no frame').toBeUndefined()
  await ui.unmount()
})

const textOf = (t: any) => t.children.join('')
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

test('desktop band: the head is one centred row, its drawing then its tools, together as wide as the body', async ($, on) => {
  serve(on, BOARD)

  await $.command.run(RUN)
  const ui = await band($, 'desktop')
  const head = (await ui.find({ key: 'head' }))?.props
  expect(head).toMatchObject({ flexDirection: 'row', alignItems: 'center' })
  expect(head?.position).toBeUndefined()
  const tools = (await ui.find({ key: 'tools' }))?.props
  expect(tools?.position, 'the tools sit in the row, not over the drawing').toBeUndefined()
  expect(tools).toMatchObject({ flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center' })
  const [headW, bodyW] = (await ui.findAll({ type: 'Svg' })).map((s: any) => s.props.width)
  expect(headW).toBeLessThan(bodyW)
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

const SKILL = { name: 'build', states: ['test', 'red', 'pass', 'refactor'], current: 'pass' }
const withSkill = (skill: unknown) => board([['in_progress', 'In Progress', [task({ id: 'PROJ-1', title: 'Add the verbs', phase: 'build', substate: 'red', skill })]]])

test('desktop band: the active skill draws its own blue row, and a declared next skill gets a solid arrow to a ring', async ($, on) => {
  serve(on, withSkill({ ...SKILL, next: { kind: 'skill', name: 'deliver' } }))

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).toContain('data-row="skill"')
  expect(body?.source).toContain('#3b82f6')
  for (const state of SKILL.states) {
    expect(body?.source).toContain(`>${state}<`)
  }
  expect(body?.source).toContain('data-next="skill"')
  expect(body?.source).toContain('>deliver<')
})

test('desktop band: a next operation is a square node, not a ring', async ($, on) => {
  serve(on, withSkill({ ...SKILL, next: { kind: 'operation', name: 'agent-cmd review' } }))

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).toContain('data-next="operation"')
  expect(body?.source).toContain('>agent-cmd review<')
})

test('desktop band: a skill with no declared next edge draws no arrow', async ($, on) => {
  serve(on, withSkill({ ...SKILL, next: null }))

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).toContain('data-row="skill"')
  expect(body?.source).not.toContain('data-next=')
})

test('desktop band: a task reporting no skill draws no skill row', async ($, on) => {
  serve(on, withSkill(null))

  await $.command.run(RUN)
  const [, body] = await svgs(await band($, 'desktop'))
  expect(body?.source).not.toContain('data-row="skill"')
})

// A desktop band over the board `stdout`, whose curl calls `curl` answers; the toasts it shows are collected.
const takeOverBand = async ($: any, on: On, stdout: string, curl: (argv: readonly string[]) => ReturnType<typeof answer>, surface = 'desktop') => {
  const toasts: string[] = []
  const posted: string[][] = []
  serve(on, stdout, {
    run: e => {
      if (e.argv[0] !== 'curl') return answer(0, stdout)
      posted.push([...e.argv])
      return curl(e.argv)
    },
  })
  on('env.get', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(RUN)

  return { ui: await band($, surface), toasts, posted }
}

const INTERACTIVE = (interactive: boolean) => board([['in_progress', 'In Progress', [task({ id: 'PROJ-1', title: 'Add the verbs', interactive })]]])

test('desktop band: an unattended task has a native Make interactive button that posts the take-over', async ($, on) => {
  const { ui, posted } = await takeOverBand($, on, INTERACTIVE(false), () => answer(0, '{"sent": true}\n200'))

  expect((await ui.find({ key: 'make-interactive' }))?.props.label).toBe('Make interactive')
  await ui.press({ key: 'make-interactive' })
  await settle()

  expect(posted.map(a => a.find(x => x.startsWith('http')))).toEqual(['http://localhost:8766/api/take-over'])
  expect(sent(posted[0]!)).toEqual({ task: 'PROJ-1' })
  await ui.unmount()
})

test('desktop band: a take-over StarPulse refuses toasts its reason', async ($, on) => {
  const { ui, toasts } = await takeOverBand($, on, INTERACTIVE(false), () => answer(0, '{"error": "PROJ-1 has no running workflow to take over"}\n409'))

  await ui.press({ key: 'make-interactive' })
  await settle()

  expect(toasts).toEqual(['PROJ-1 has no running workflow to take over'])
  await ui.unmount()
})

test('desktop band: a take-over that cannot reach StarPulse toasts that', async ($, on) => {
  const { ui, toasts } = await takeOverBand($, on, INTERACTIVE(false), () => answer(7, ''))

  await ui.press({ key: 'make-interactive' })
  await settle()

  expect(toasts).toEqual(['Cannot reach StarPulse at http://localhost:8766'])
  await ui.unmount()
})

test('desktop band: once the harness reports the task interactive the band shows driving, not the button', async ($, on) => {
  const { ui } = await takeOverBand($, on, INTERACTIVE(true), () => answer(0, '{"sent": true}\n200'))

  expect(await ui.find({ key: 'make-interactive' })).toBeUndefined()
  const driving = (await ui.findAll({ type: 'Text' })).find((t: any) => textOf(t) === 'driving')
  expect(driving?.props.color, 'in the skill blue').toBe('#60a5fa')
  await ui.unmount()
})

test('desktop band: an unattended task shows no driving indicator', async ($, on) => {
  const { ui } = await takeOverBand($, on, INTERACTIVE(false), () => answer(0, ''))

  expect((await ui.findAll({ type: 'Text' })).map(textOf)).not.toContain('driving')
  await ui.unmount()
})

test('terminal band: an unattended task has a Make interactive button that posts the take-over; an interactive one shows driving', async ($, on) => {
  const { ui, posted } = await takeOverBand($, on, INTERACTIVE(false), () => answer(0, '{"sent": true}\n200'), 'terminal')

  expect((await ui.find({ key: 'make-interactive' }))?.props.label).toBe('Make interactive')
  await ui.press({ key: 'make-interactive' })
  await settle()
  expect(sent(posted[0]!)).toEqual({ task: 'PROJ-1' })
  expect(await words(ui)).not.toContain('driving')
  await ui.unmount()
})

test('terminal band: once the harness reports the task interactive it shows driving, not the button', async ($, on) => {
  const { ui } = await takeOverBand($, on, INTERACTIVE(true), () => answer(0, ''), 'terminal')

  expect(await ui.find({ key: 'make-interactive' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).find((t: any) => textOf(t) === 'driving')?.props.color).toBe('#60a5fa')
  await ui.unmount()
})

test('the session start opens no pane and registers /board alone', async ($, on) => {
  const opened: string[] = []
  const registered: string[] = []
  sessionsHost(on, { opened, registered })

  await start($, 'terminal')
  await start($, 'desktop')

  expect(opened).toEqual([])
  expect(registered).toEqual(['board', 'board'])
})
