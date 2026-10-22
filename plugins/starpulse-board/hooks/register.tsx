import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface as Engine, Register, RenderChildren } from 'claude-code'
import type { BoardTask, HeldTask, Stats } from '../types'
import { BAND_HEIGHT, CHECKS, LANES as LANE_STYLES, LEAN_HEIGHT, NO_STATS, SP, alt, bandBodySvg, bandHeadSvg, currentSvg, glyphs, idChars, leanRowSvg, leanWidth, laneIcon, laneOf, miniSvg, paneSvg, progress, ratio, statLines, subline, termBar } from './draw'
import type { Glyphs } from './draw'
import { LANES, events, follow, heldOf, newRun, openLanes, post, readBoard, stop, streamOf } from './starpulse'
import type { Board, Run } from './starpulse'

const PANE = 'starpulse-board'
const KANBAN = 'starpulse-kanban'

const tasks = atom({ plugin: 'starpulse-board', key: 'tasks' } as const, null)
const openTask = atom({ plugin: 'starpulse-board', key: 'openTask' } as const, null)
const lanes = atom({ plugin: 'starpulse-board', key: 'lanes' } as const, null)
const folded = atom({ plugin: 'starpulse-board', key: 'folded' } as const, ['ready', 'waiting', 'done'])
// A lane shows this many rows until it is expanded.
const LANE_PAGE = 6
const expanded = atom({ plugin: 'starpulse-board', key: 'expanded' } as const, [])
const pickedTask = atom({ plugin: 'starpulse-board', key: 'pickedTask' } as const, null)
const stats = atom({ plugin: 'starpulse-board', key: 'stats' } as const, NO_STATS)
const isMini = atom({ plugin: 'starpulse-board', key: 'isMini' } as const, false)

// The StarPulse page for a task, where "Copy StarPulse link" and the band's Copy point.
const pageOf = async ($: Engine, id: string) =>
  `${((await $.env.get('STARPULSE_URL').catch(() => undefined)) || 'http://localhost:8766').replace(/\/+$/, '')}/?view=kanban&task=${id}`

// The tasks this session last claimed, from the StarPulse server `starpulse board` reads; null when it cannot be read.
const held = async ($: Engine): Promise<HeldTask[] | null> => {
  const session = await $.session.id().catch(() => null)
  const board = session === null ? null : await readBoard($, ['--assignee', session])

  return board && heldOf(board)
}


// The server sends this session's held tasks once and again whenever they change; nothing here asks it twice.
const followHeld = async ($: Engine) => {
  const session = await $.session.id()
  const { argv, input } = await streamOf($, `/api/held?assignee=${encodeURIComponent(session)}`)
  const onFrame = async (event: string, data: string) => {
    if (event === 'held') {
      await update($, tasks, () => heldOf(JSON.parse(data) as Board))
    }
  }

  await follow($, argv, input, events(onFrame))
}

// The stream the open Board tab follows: set while the tab is open, ended when it closes.
let lanesRun: Run | null = null

// Ends the stream the Board tab followed; it starts again when the tab opens.
const endLanes = () => {
  if (lanesRun) {
    stop(lanesRun)
    lanesRun = null
  }
}

// While the Board tab is open the server sends the open lanes on connect and again whenever they change.
const followLanes = async ($: Engine) => {
  if (lanesRun && !lanesRun.isStopped) {
    return
  }
  const run = (lanesRun = newRun())
  const { argv, input } = await streamOf($, `/api/lanes?${LANES.map(state => `state=${state}`).join('&')}`)
  const onFrame = async (event: string, data: string) => {
    if (event === 'lanes') {
      const now = await $.clock.now()
      await update($, lanes, () => openLanes(JSON.parse(data) as Board, now))
    }
  }
  if (!run.isStopped) {
    await follow($, argv, input, events(onFrame), run)
  }
}

let hasOpened = false
let isStarting = true

const tmux = ($: Engine, ...args: string[]) => $.process.run(['tmux', ...args]).catch(() => null)

// The Board tab opens, with the keys unless asked not to, and follows the server's lanes stream until it closes.
const openBoard = async ($: Engine, hasKeys = true) => {
  await $.ui.open(hasKeys ? { id: KANBAN, title: 'Board', focus: true } : { id: KANBAN, title: 'Board' })
  void followLanes($)
}


// A lane whose task StarPulse can start a session for; any other task already has one to go to.
const STARTABLE = new Set(['ready', 'waiting', 'needs_attention'])

// StarPulse starts a task's session in tmux session task-<n>; a task already in progress is switched to where it runs.
const toSession = async ($: Engine, t: BoardTask, lane: string) => {
  const name = t.id.toLowerCase()
  if (!STARTABLE.has(lane)) {
    const ran = await tmux($, 'switch-client', '-t', name)
    if (ran?.exitCode !== 0) {
      $.ui.toast(`${t.id} has no live tmux session to switch to`)
    }
    return
  }
  const refused = await post($, '/api/start', { task: t.id, assignee: t.assignee, harness: 'claude' })
  if (refused) {
    $.ui.toast(refused)
    return
  }
  const ran = await tmux($, 'switch-client', '-t', name)
  if (ran?.exitCode !== 0) {
    $.ui.toast(`Started ${t.id}: tmux attach -t ${name}`)
  }
}

const moveTask = async ($: Engine, id: string, to: string) => {
  const refused = await post($, '/api/move', { task: id, to })
  if (refused) {
    $.ui.toast(refused)
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
// A drawing's pixel width from the surface's columns; a dock not yet measured has none, so it takes the narrowest.
const pxWidth = (columns: number, lo: number, hi: number) => (Number.isFinite(columns) && columns > 0 ? clamp(Math.floor(columns * CELL_PX), lo, hi) : lo)

// Pixels a monospace cell takes on the remote surfaces; the room the band's PR link and fold button take
// over its head drawing; and the room a Board row's ID button takes beside its lean row, which a spacer pads so every row's
// drawing, and so its bar, starts at one x.
const CELL_PX = 7.5
const TOOLS_PX = 96
// Folded, the tools also carry the cost and turns.
const MINI_TOOLS_PX = 230

type Terminal = ElementTable<'terminal'>
// Every surface but the terminal draws the Svg; the desktop's table stands for them (Box, Text and Button are the same).
type Remote = ElementTable<'desktop'>

// The eighth-block bar as two Texts: the filled cells in `color`, the empty track dim.
const barTexts = (Text: Terminal['Text'], k: number, n: number, cells: number, color: string) => {
  const [fill, track] = termBar(k, n, cells)

  return [fill && <Text color={color}>{fill}</Text>, track && <Text color={SP.track}>{track}</Text>]
}

// The terminal's row as Ink draws it: lane icon, ID, title cut to fit, bar and count, lane, PR and its checks.
const termRow = (Box: Terminal['Box'], Text: Terminal['Text'], t: HeldTask, g: Glyphs) => {
  const [laneName, color] = laneOf(t)
  const p = progress(t)
  const sub = subline(t)
  const checks = t.pull ? CHECKS[t.pull.checks] : null

  return (
    <Box flexGrow={1} flexShrink={1} gap={1}>
      <Text color={color}>{laneIcon(g, t.lane)}</Text>
      <Text bold color={SP.ink}>
        {t.id}
      </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" color={sub.color}>
          {sub.text}
        </Text>
      </Box>
      {p && p.k !== null && <Box>{barTexts(Text, p.k, p.n, 12, color)}</Box>}
      {p && <Text color={SP.ink}>{ratio(p)}</Text>}
      <Text color={color}>{laneName}</Text>
      {t.pull && checks && (
        <Box gap={1}>
          <Text color={SP.muted}>{`#${t.pull.number}`}</Text>
          <Box key={`checks-${t.id}`}>
            <Text color={checks.color}>{g(t.pull.checks)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// The terminal's pane: the same facts as the Svg pane, one Text a line.
const termPane = (Box: Terminal['Box'], Text: Terminal['Text'], t: HeldTask, g: Glyphs) => {
  const [laneName, color] = laneOf(t)
  const p = progress(t)
  const checks = t.pull ? CHECKS[t.pull.checks] : null

  return (
    <Box flexDirection="column">
      <Text bold>{t.id}</Text>
      <Text>{t.title}</Text>
      <Box>
        <Text color={color}>{laneName}</Text>
        {t.holder && <Text dimColor>{` · held by ${t.holder}`}</Text>}
      </Box>
      {t.reason && <Text color={t.lane === 'needs_attention' ? SP.failText : undefined}>{t.reason}</Text>}
      {t.lane === 'waiting' && t.waitingOn.length > 0 && <Text dimColor>{`Waiting on ${t.waitingOn.join(' · ')}`}</Text>}
      {p && <Text dimColor>{`Acceptance criteria ${p.k === null ? p.n : `${p.k}/${p.n}`}`}</Text>}
      {(t.criteria ?? []).map(c => (
        <Text dimColor={c.checked === true}>{`${c.checked === true ? '✓' : c.checked === false ? '○' : '·'} ${c.text}`}</Text>
      ))}
      {t.pull && checks && (
        <Box gap={1}>
          <Text color={checks.color}>{g(t.pull.checks)}</Text>
          <Text>{`${t.pull.repo}#${t.pull.number}`}</Text>
          <Text dimColor>{checks.phrase}</Text>
        </Box>
      )}
    </Box>
  )
}

// The room a Board row leaves its title, in cells: the indent, the ID, a space either side of the title, the bar (four
// cells and its space) and the PR icon. One cell is left spare so a row never wraps.
const BAR_CELLS = 4
const titleRoom = (cols: number, idWidth: number, hasBar: boolean) => cols - (idWidth + 8 + (hasBar ? BAR_CELLS + 1 : 0)) - 1

// A title cut to `room` cells with an ellipsis, and the blanks that pad a short one to it.
const cut = (text: string, room: number): [shown: string, pad: string] => {
  const chars = [...text]
  if (chars.length <= room) {
    return [text, ' '.repeat(room - chars.length)]
  }

  return [`${chars.slice(0, Math.max(0, room - 1)).join('')}…`, '']
}

const toggle = async ($: Engine, id: string) => {
  if ((await read($, openTask)) === id) {
    await update($, openTask, () => null)
    await $.ui.close({ id: PANE })
  } else {
    await update($, openTask, () => id)
    await $.ui.open({ id: PANE, title: id })
  }
}

export const register: Register = (on, options) => {
  const g = glyphs(options.glyphs)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: 'List the Board tasks this session holds' })
    await $.command.register({ name: 'kanban', description: 'Open the Board tab in the dock with the keys' })
    void followHeld($)
    // The dock opens on the Board without taking the keys; a plugin that opens a pane after this one does not take its tab.
    void openBoard($, false).then(() => {
      hasOpened = true
    })

    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    const found = await held($)
    await update($, tasks, () => found)
    if (found === null) {
      return { text: '`starpulse board` failed: is the StarPulse server running?' }
    }

    return {
      text: found.length ? found.map(t => `${t.id} [${t.column}] ${t.title}`).join('\n') : 'This session holds no tasks.',
    }
  })

  on('command.run', { command: 'kanban' }, async $ => {
    await openBoard($)

    return { text: 'Opened the Board tab.' }
  })

  // Until the first prompt, the first pane another plugin opens would take the dock's shown tab: reopen the Board over it, once.
  on('ui.open', async ($, e, next) => {
    const result = await next(e)
    if (isStarting && hasOpened && e.id !== PANE && e.id !== KANBAN) {
      isStarting = false
      // Opening an open pane only retitles it: close it first so the open lands as the newest tab.
      $.clock.after(0, async () => {
        await $.ui.close({ id: KANBAN })
        await openBoard($, false)
      })
    }

    return result
  })

  on('prompt.submit', ($, e, next) => {
    isStarting = false

    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, openTask, () => null)

    return next(e)
  })

  on('ui.close', { id: KANBAN }, ($, e, next) => {
    endLanes()

    return next(e)
  })

  // Cost and tokens move with each main-agent step, so the band counts up mid-turn; a subagent's step is in the
  // session's cost all the same, read at the main agent's next step. `last` is the running turn's cost so far.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId) {
      return result
    }
    const usd = (await $.session.usage().catch(() => null))?.cost?.usd
    const u = result.usage
    const input = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    const output = u?.output_tokens ?? 0
    // A step that moved nothing writes nothing, so the band's readers don't redraw for it.
    if (!input && !output && (usd === undefined || usd === (await read($, stats)).cost)) {
      return result
    }
    await update($, stats, (s): Stats => {
      const cost = usd ?? s.cost
      const spent = cost - s.cost

      return {
        ...s,
        cost,
        last: e.index === 0 ? spent : s.last + spent,
        tokens: s.tokens + input + output,
        output: s.output + output,
        cacheRead: s.cacheRead + (u?.cache_read_input_tokens ?? 0),
        inputAll: s.inputAll + input,
      }
    })

    return result
  })

  // A turn's end counts the turn and its time: its cost and tokens arrived step by step.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await update($, stats, (s): Stats => ({ ...s, turns: s.turns + 1, agentMs: s.agentMs + e.durationMs }))
    }

    return result
  })

  // The band is always on: banner D's path, PR facts and stats on a desktop, the held rows on the terminal.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const found = (await read($, tasks)) ?? []
    const { Box, Button, Text, Svg, Link } = $.ui.resolve(e) as Remote
    // The plugins beneath (a skin, the engine's own row) draw below the band, as claude-skins composes its own.
    const theirs = await next(e)
    if (e.surface === 'terminal') {
      const opened = await read($, openTask)

      return (
        <Box key="band-wrap" flexDirection="column">
        <Box key="band" flexDirection="column">
          {found.map(t => {
            const label = opened === t.id ? 'Close' : 'Details'

            return (
              <Box flexDirection="row" alignItems="center" gap={1}>
                {termRow(Box, Text, t, g)}
                <Button key={`details-${t.id}`} label={label} plain onPress={() => toggle($, t.id)}>
                  <Text color={SP.slate}>{`[${label}]`}</Text>
                </Button>
              </Box>
            )
          })}
          {!found.length && <Text color={SP.slate}>No task held</Text>}
        </Box>
        {theirs}
        </Box>
      )
    }
    const t = found[0] ?? null
    const s = await read($, stats)
    const mini = await read($, isMini)
    const W = pxWidth(e.props.bodyColumns, 420, 1100)
    // The drawings depend on the task alone; the stats are native text, so a step changes only the numbers.
    const body = mini ? null : bandBodySvg(t, W)
    const figures = (pairs: [string, string][]) =>
      pairs.map(([k, v]) => (
        <Box key={`stat-${k || 'cost'}`} flexDirection="row" alignItems="center" gap="xs">
          {k && <Text color={SP.slate} size="caption">{k}</Text>}
          <Text color={SP.inkHi} size="footnote" weight="medium" mono tabular>{v}</Text>
        </Box>
      ))
    const lines = statLines(s)

    return (
      <Box key="band-wrap" flexDirection="column">
      <Box key="band" flexDirection="column" borderStyle="round" borderColor={`${SP.edge}2e`} backgroundColor={SP.stack} overflow="hidden">
        {/* The head spans the band and its tools sit over its right edge, as skins lays buttons over its art. */}
        <Box key="head" position="relative">
          <Svg
            source={mini ? miniSvg(t, W, MINI_TOOLS_PX) : bandHeadSvg(t, W, TOOLS_PX)}
            alt={t ? alt(t) : 'No task held'}
            width={W}
            height={BAND_HEIGHT}
            isInteractive
          />
          <Box key="tools" position="absolute" top={0} right={1} flexDirection="row" alignItems="center" gap="xs">
            {mini && figures([['', lines[0][1]], lines[5]])}
            {t?.pull && (
              <Text key="pr">
                <Link href={`https://github.com/${t.pull.repo}/pull/${t.pull.number}`} label={`#${t.pull.number}`} />
              </Text>
            )}
            <Button key="fold" label={mini ? '▴' : '▾'} onPress={() => update($, isMini, x => !x)} />
          </Box>
        </Box>
        {body && <Svg key="body" source={body.source} alt={`Delivery path of ${t?.id}, its pull request and tests`} width={W} height={body.height} isInteractive />}
        {!mini && (
          <Box key="stats" flexDirection="row" flexWrap="wrap" alignItems="center" gap="md" paddingX="sm" paddingY="xs">
            {figures(lines)}
          </Box>
        )}
      </Box>
      {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const found = await read($, tasks)
    const picked = await read($, openTask)
    const t = found?.find(x => x.id === picked) ?? found?.[0]
    if (!t) {
      return next(e)
    }

    const { Box, Text, Svg } = $.ui.resolve(e) as Remote
    if (e.surface !== 'terminal') {
      const width = pxWidth(e.props.bodyColumns, 240, 720)
      const { source, height } = paneSvg(t, width)

      return <Svg source={source} alt={`${alt(t)}. ${t.title}`} width={width} height={height} />
    }

    return termPane(Box, Text, t, g)
  })

  on('ui.render', { component: 'Pane', requestId: KANBAN }, async ($, e) => {
    // A hook that throws leaves the tab blank, so the Board says why it could not draw instead.
    try {
      return await (async () => {
          if (e.surface === 'terminal' && e.props.placement === 'inline') {
            endLanes()
            void $.ui.close({ id: KANBAN }).catch(() => undefined)
            const { Box } = $.ui.resolve(e)
            return <Box />
          }
          // A tab /kanban did not open, as one left in the dock across /clear, has no stream yet; one already running is kept.
          void followLanes($)
          const found = await read($, lanes)
          const shut = await read($, folded)
          const shown = await read($, expanded)
          const picked = await read($, pickedTask)
          const mine = await read($, tasks)
          const { Box, Button, Text, Svg } = $.ui.resolve(e) as Remote
          if (e.surface !== 'terminal') {
            // The desktop's pane takes the page's own background; a picked task's detail replaces the lanes until "‹ Board".
            const width = pxWidth(e.props.bodyColumns - 1, 240, 720)
            if (found === null || !found.length) {
              return (
                <Box key="board" flexDirection="column">
                  <Text dimColor>{found === null ? 'Reading the Board…' : '`starpulse board` failed: is the StarPulse server running?'}</Text>
                </Box>
              )
            }
            const pick = found.flatMap(l => l.tasks.map(t => ({ t, state: l.state }))).find(x => x.t.id === picked)
            if (pick) {
              const { t, state } = pick
              const [laneName, color] = laneOf(t)
              const detail = paneSvg(t, width)
              const url = await pageOf($, t.id)

              return (
                <Box key="board" flexDirection="column" gap={1}>
                  <Box flexDirection="row" alignItems="center" gap={1}>
                    <Button key="back" label="‹ Board" onPress={() => update($, pickedTask, () => null)} />
                    <Box flexGrow={1} />
                    <Text color={color}>{`● ${laneName}`}</Text>
                  </Box>
                  <Svg source={detail.source} alt={`${alt(t)}. ${t.title}`} width={width} height={detail.height} />
                  <Box flexWrap="wrap" columnGap={1} rowGap={1}>
                    <Button key={`session:${t.id}`} label={STARTABLE.has(state) ? 'Start session' : 'Go to session'} variant="primary" onPress={() => toSession($, t, state)} />
                    <Button key={`open:${t.id}`} label="Copy StarPulse link" onPress={press => $.ui.copy({ text: url, surface: press.surface })} />
                    {t.moves.map(m => (
                      <Button key={`move:${t.id}:${m.to}`} label={`Move to ${LANE_STYLES[m.to]?.[0] ?? m.name}`} onPress={() => moveTask($, t.id, m.to)} />
                    ))}
                  </Box>
                </Box>
              )
            }
            const open = found.reduce((sum, l) => sum + l.tasks.length, 0)
            const fold = (state: string) => update($, folded, f => (f.includes(state) ? f.filter(x => x !== state) : [...f, state]))
            const expand = (state: string) => update($, expanded, x => (x.includes(state) ? x.filter(y => y !== state) : [...x, state]))
            // This session's task has its own card, so its lane row goes and a lane it empties is hidden.
            const current = mine?.[0] ?? null
            const lanesShown = found.map(l => ({ ...l, tasks: l.tasks.filter(t => t.id !== current?.id) })).filter(l => l.tasks.length)
            const card = current ? currentSvg(current, width) : null
            const shownIds = lanesShown.flatMap(l => l.tasks.map(t => t.id))
            const [leanW, idW] = [leanWidth(width, shownIds), idChars(shownIds)]

            return (
              <Box key="board" flexDirection="column" gap={1}>
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Text color={SP.ok}>●</Text>
                  <Text bold color={SP.slate}>BOARD</Text>
                  <Box flexGrow={1} />
                  <Text color={SP.muted}>{`${open} ${open === 1 ? 'task' : 'tasks'} · live`}</Text>
                </Box>
                {current && card && <Svg source={card.source} alt={`Current task ${current.id}: ${current.title}`} width={width} height={card.height} isInteractive />}
                {lanesShown.map(l => {
                  const isFolded = shut.includes(l.state)
                  const [laneName, color] = LANE_STYLES[l.state] ?? [l.name, SP.slate]
                  const count = `${l.tasks.length}${l.state === 'done' ? ' · last 24h' : ''}`
                  // A busy lane draws its first rows only, so the pane stays short and few bars animate, until "Show N more".
                  const isWhole = shown.includes(l.state)
                  const rest = l.tasks.length - LANE_PAGE
                  const rows = isWhole || rest <= 0 ? l.tasks : l.tasks.slice(0, LANE_PAGE)

                  return (
                    <Box key={`lane-${l.state}`} flexDirection="column" gap="xs">
                      {/* A desktop draws any Button as a native one sized to its label, so the lane head is a flat full-width
                          row with only its fold arrow a button; its tasks share one silver-edged card, each row one plain button
                          (the ID, padded to one column) with its bar right after, so every bar starts at one x. */}
                      <Box key={`head-${l.state}`} flexDirection="row" alignItems="center" gap={1} paddingX={1}>
                        <Button key={`lane:${l.state}`} label={isFolded ? '›' : '⌄'} plain onPress={() => fold(l.state)} />
                        <Text bold color={color}>
                          {laneName.toUpperCase()}
                        </Text>
                        <Box flexGrow={1} />
                        <Text color={SP.muted}>{count}</Text>
                      </Box>
                      {!isFolded && (
                        <Box
                          key={`rows-${l.state}`}
                          flexDirection="column"
                          paddingX={1}
                          borderStyle="round"
                          borderColor={`${SP.edge}2e`}
                          hover={{ borderColor: `${SP.edge}55` }}
                        >
                          {rows.map(t => (
                            // The row draws only the ID, padded with no-break spaces to one mono column so the bar right after it
                            // starts at one x; a title sized from an estimated text width pushed the bar off a narrow pane.
                            <Box key={`row-${t.id}`} flexDirection="row" alignItems="center" gap={1}>
                              <Button key={`task:${t.id}`} label={`${t.id} ${t.title}`} plain onPress={() => update($, pickedTask, () => t.id)}>
                                <Text mono color={SP.slate}>
                                  {t.id.padEnd(idW, '\u00a0')}
                                </Text>
                              </Button>
                              <Svg source={leanRowSvg(t, leanW)} alt={alt(t)} width={leanW} height={LEAN_HEIGHT} />
                            </Box>
                          ))}
                          {rest > 0 && (
                            <Button key={`more:${l.state}`} label={isWhole ? 'Show fewer' : `Show ${rest} more`} plain onPress={() => expand(l.state)} />
                          )}
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )
          }
          // The dock paints Claude Code's own grey behind every cell a pane draws; the Board draws on it with no fill of its own.
          const fill = (children: RenderChildren) => (
            <Box key="board-fill" flexDirection="column" minHeight={e.props.scroll.bodyRows}>
              {children}
            </Box>
          )
          if (found === null || !found.length) {
            return fill(<Text dimColor>{found === null ? 'Reading the Board…' : '`starpulse board` failed: is the StarPulse server running?'}</Text>)
          }
          const fold = (state: string) => update($, folded, f => (f.includes(state) ? f.filter(x => x !== state) : [...f, state]))
          const cols = e.props.bodyColumns
          const open = found.reduce((sum, l) => sum + l.tasks.length, 0)
          const idWidth = Math.max(...found.flatMap(l => l.tasks.map(t => t.id.length)), 0)
          // The bar goes first when the dock is too narrow to leave a title any room.
          const hasBar = titleRoom(cols, idWidth, true) >= 6
          const room = Math.max(0, titleRoom(cols, idWidth, hasBar))

          const row = (t: BoardTask, color: string, isPicked: boolean) => {
            const p = progress(t)
            const sub = subline(t)
            const [shown, pad] = cut(sub.text, room)
            const checks = t.pull ? CHECKS[t.pull.checks] : null
            const [fill, track] = p && p.k !== null ? termBar(p.k, p.n, BAR_CELLS) : ['', ' '.repeat(BAR_CELLS)]

            return (
              <Button key={`task:${t.id}`} label={`${t.id} ${t.title}`} plain onPress={() => update($, pickedTask, x => (x === t.id ? null : t.id))}>
                {'  '}
                <Text bold={isPicked} color={isPicked ? color : SP.slate}>
                  {t.id}
                </Text>
                {' '}
                <Text color={sub.color}>{shown}</Text>
                {pad}
                {hasBar && ' '}
                {hasBar && fill && <Text color={p?.k === p?.n ? SP.ok : color}>{fill}</Text>}
                {hasBar && <Text color={SP.track}>{track}</Text>}
                {' '}
                {checks && t.pull ? <Text color={checks.color}>{g(t.pull.checks)}</Text> : ' '}
              </Button>
            )
          }

          const detail = (t: BoardTask, state: string) => {
            const p = progress(t)
            const isStartable = STARTABLE.has(state)
            const holder = /^[0-9a-f]{8}-/.test(t.holder) ? t.holder.slice(0, 8) : t.holder
            const checks = t.pull ? CHECKS[t.pull.checks] : null
            const facts = [
              t.holder && (
                <Box key="holder">
                  <Text color={SP.muted}>held by </Text>
                  <Text color={SP.slate}>{holder}</Text>
                </Box>
              ),
              p && (
                <Text key="criteria" color={p.k === p.n ? SP.ok : SP.muted}>
                  {p.k === null ? ratio(p) : `${ratio(p)} criteria`}
                </Text>
              ),
              t.pull && checks && (
                <Box key="pr" gap={1}>
                  <Text color={SP.agent}>{`${g('pr')} #${t.pull.number}`}</Text>
                  <Text color={checks.color}>{checks.phrase}</Text>
                </Box>
              ),
            ].filter(Boolean)

            return (
              <Box key={`detail-${t.id}`} flexDirection="column" paddingLeft={4}>
                <Text bold color={SP.ink}>
                  {t.title}
                </Text>
                {facts.length > 0 && (
                  <Box flexWrap="wrap" columnGap={1}>
                    {facts.flatMap((fact, i) => (i ? [<Text key={`sep-${i}`} color={SP.faint}>·</Text>, fact] : [fact]))}
                  </Box>
                )}
                {t.reason && <Text color={SP.failText}>{t.reason}</Text>}
                <Box flexWrap="wrap" columnGap={2}>
                  <Button key={`session:${t.id}`} label={isStartable ? 'Start session' : 'Go to session'} plain onPress={() => toSession($, t, state)}>
                    <Text bold color={SP.ok}>{`${g(isStartable ? 'start' : 'go')} ${isStartable ? 'Start session' : 'Go to session'}`}</Text>
                  </Button>
                  {t.moves.map(m => (
                    <Button key={`move:${t.id}:${m.to}`} label={`→ ${m.name}`} plain onPress={() => moveTask($, t.id, m.to)}>
                      <Text color={LANE_STYLES[m.to]?.[1] ?? SP.slate}>{`${g('move')} ${LANE_STYLES[m.to]?.[0] ?? m.name}`}</Text>
                    </Button>
                  ))}
                </Box>
              </Box>
            )
          }

          return fill(
            <Box flexDirection="column">
              <Box>
                <Text bold color={SP.agent}>{`${g('board')} Board`}</Text>
                <Text color={SP.muted}>{` · ${open} open`}</Text>
              </Box>
              {found.map(l => {
                const isFolded = shut.includes(l.state)
                const [laneName, color] = LANE_STYLES[l.state] ?? [l.name, SP.slate]
                const header = `${laneName.toUpperCase()} ${l.tasks.length}`

                return (
                  <Box key={`lane-${l.state}`} flexDirection="column" marginTop={1}>
                    <Box>
                      <Button key={`lane:${l.state}`} label={`${isFolded ? '▸' : '▾'} ${l.name} ${l.tasks.length}`} plain onPress={() => fold(l.state)}>
                        <Text color={SP.faint}>{g(isFolded ? 'right' : 'down')}</Text>
                        {' '}
                        <Text color={color}>{laneIcon(g, l.state)}</Text>
                        {' '}
                        <Text bold color={color}>
                          {laneName.toUpperCase()}
                        </Text>
                        {' '}
                        <Text color={SP.muted}>{String(l.tasks.length)}</Text>
                      </Button>
                      <Text color={SP.track}>{` ${'─'.repeat(Math.max(0, cols - header.length - 6))}`}</Text>
                    </Box>
                    {!isFolded &&
                      l.tasks.map(t => (
                        <Box key={`row-${t.id}`} flexDirection="column">
                          {row(t, color, picked === t.id)}
                          {picked === t.id && detail(t, l.state)}
                        </Box>
                      ))}
                  </Box>
                )
              })}
              <Box marginTop={1}>
                <Text color={SP.faint}>↑↓ move · ↵ pick · lane header folds</Text>
              </Box>
            </Box>,
          )
      })()
    } catch (err) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box key="board">
          <Text color={SP.failText}>{`The Board could not draw: ${err instanceof Error ? err.message : String(err)}`}</Text>
        </Box>
      )
    }
  })
}
