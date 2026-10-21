import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface as Engine, Register, RenderChildren } from 'claude-code'
import type { BoardTask, HeldTask } from '../types'
import { CHECKS, LANES as LANE_STYLES, LEAN_HEIGHT, ROW_HEIGHT, SP, alt, currentSvg, glyphs, laneHeaderSvg, leanRowSvg, laneIcon, laneOf, paneSvg, progress, ratio, rowSvg, subline, termBar } from './draw'
import type { Glyphs } from './draw'
import { LANES, events, follow, heldOf, newRun, openLanes, post, readBoard, readLanes, stop, streamOf } from './starpulse'
import type { Board, Run } from './starpulse'

const PANE = 'starpulse-board'
const KANBAN = 'starpulse-kanban'

const tasks = atom({ plugin: 'starpulse-board', key: 'tasks' } as const, null)
const isHidden = atom({ plugin: 'starpulse-board', key: 'isHidden' } as const, false)
const openTask = atom({ plugin: 'starpulse-board', key: 'openTask' } as const, null)
const lanes = atom({ plugin: 'starpulse-board', key: 'lanes' } as const, null)
const folded = atom({ plugin: 'starpulse-board', key: 'folded' } as const, ['ready', 'waiting', 'done'])
const pickedTask = atom({ plugin: 'starpulse-board', key: 'pickedTask' } as const, null)

// The tasks this session last claimed, from the StarPulse server `starpulse board` reads; null when it cannot be read.
const held = async ($: Engine): Promise<HeldTask[] | null> => {
  const session = await $.session.id().catch(() => null)
  const board = session === null ? null : await readBoard($, ['--assignee', session])

  return board && heldOf(board)
}

const reloadLanes = async ($: Engine) => {
  const found = await readLanes($)
  await update($, lanes, () => found)
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

// Pixels a monospace cell takes on the remote surfaces, and the room the Details and ✕ buttons beside the Svg row need.
const CELL_PX = 7.5
const BUTTONS_PX = 100
// The room the Expand/Collapse and Details buttons take beside a Board card.
const FOLD_PX = 48
const ID_PX = 112

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
    await update($, isHidden, () => false)
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const found = (await read($, tasks)) ?? []
    if (e.props.hasSurvey || !found.length) {
      return next(e)
    }

    const { Box, Button, Text, Svg } = $.ui.resolve(e) as Remote
    // A desktop draws its native buttons and the Svg cards; the terminal draws bracketed text and cells.
    const isDesktop = e.surface !== 'terminal'
    if (await read($, isHidden)) {
      return (
        <Button key="show" label="Show task" plain={!isDesktop || undefined} onPress={() => update($, isHidden, () => false)}>
          {isDesktop ? undefined : <Text color={SP.slate}>Show task</Text>}
        </Button>
      )
    }
    const hide = isDesktop ? (
      <Button key="hide" label="Hide" role="dismiss" onPress={() => update($, isHidden, () => true)} />
    ) : (
      <Button key="hide" label="✕" plain onPress={() => update($, isHidden, () => true)}>
        <Text color={SP.faint}>✕</Text>
      </Button>
    )

    const opened = await read($, openTask)
    const width = clamp(Math.floor(e.props.bodyColumns * CELL_PX) - BUTTONS_PX, 280, 860)

    return (
      <Box flexDirection="column" gap={isDesktop ? 1 : 0}>
        {found.map((t, i) => {
          const label = opened === t.id ? 'Close' : 'Details'

          return (
            <Box flexDirection="row" alignItems="center" gap={1}>
              {isDesktop ? (
                <Svg source={rowSvg(t, width)} alt={alt(t)} width={width} height={ROW_HEIGHT} />
              ) : (
                termRow(Box, Text, t, g)
              )}
              {isDesktop ? (
                <Button key={`details-${t.id}`} label={label} onPress={() => toggle($, t.id)} />
              ) : (
                <Button key={`details-${t.id}`} label={label} plain onPress={() => toggle($, t.id)}>
                  <Text color={SP.slate}>{`[${label}]`}</Text>
                </Button>
              )}
              {i === 0 && hide}
            </Box>
          )
        })}
        {isDesktop ? (
          <Box flexDirection="row">
            <Button key="kanban" label="Open board" onPress={() => openBoard($)} />
          </Box>
        ) : (
          <Box flexDirection="row" alignItems="center" gap={2}>
            <Button key="kanban" label="Board" plain onPress={() => openBoard($)}>
              <Text color={SP.agent}>{`${g('board')} Board`}</Text>
            </Button>
          </Box>
        )}
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
      const width = clamp(Math.floor(e.props.bodyColumns * CELL_PX), 240, 720)
      const { source, height } = paneSvg(t, width)

      return <Svg source={source} alt={`${alt(t)}. ${t.title}`} width={width} height={height} />
    }

    return termPane(Box, Text, t, g)
  })

  on('ui.render', { component: 'Pane', requestId: KANBAN }, async ($, e) => {
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
    const picked = await read($, pickedTask)
    const mine = await read($, tasks)
    const { Box, Button, Text, Svg } = $.ui.resolve(e) as Remote
    if (e.surface !== 'terminal') {
      // The desktop's pane takes the page's own background: no fill, no key hints, drawings for the dividers and chips.
      const width = clamp(Math.floor(e.props.bodyColumns * CELL_PX) - 8, 240, 720)
      if (found === null || !found.length) {
        return (
          <Box key="board" flexDirection="column">
            <Text dimColor>{found === null ? 'Reading the Board…' : '`starpulse board` failed: is the StarPulse server running?'}</Text>
          </Box>
        )
      }
      const open = found.reduce((sum, l) => sum + l.tasks.length, 0)
      const fold = (state: string) => update($, folded, f => (f.includes(state) ? f.filter(x => x !== state) : [...f, state]))
      // This session's task has its own card, so its lane row goes and a lane it empties is hidden.
      const current = mine?.[0] ?? null
      const lanesShown = found.map(l => ({ ...l, tasks: l.tasks.filter(t => t.id !== current?.id) })).filter(l => l.tasks.length)
      const card = current ? currentSvg(current, width) : null

      return (
        <Box key="board" flexDirection="column" gap={1}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text bold color={SP.slate}>BOARD</Text>
            <Text color={SP.ok}>●</Text>
            <Text dimColor>{`${open} ${open === 1 ? 'task' : 'tasks'} · live`}</Text>
            <Box flexGrow={1} />
            <Button key="refresh" label="Refresh" onPress={() => reloadLanes($)} />
          </Box>
          {current && card && <Svg source={card.source} alt={`Current task ${current.id}: ${current.title}`} width={width} height={card.height} />}
          {lanesShown.map(l => {
            const isFolded = shut.includes(l.state)
            const [laneName, color] = LANE_STYLES[l.state] ?? [l.name, SP.slate]
            const header = laneHeaderSvg(laneName, color, l.tasks.length, width - FOLD_PX, l.state === 'done' ? 'last 24h' : '')

            return (
              <Box key={`lane-${l.state}`} flexDirection="column" gap={1}>
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Button key={`lane:${l.state}`} label={isFolded ? '▸' : '▾'} onPress={() => fold(l.state)} />
                  <Svg source={header.source} alt={`${l.name}, ${l.tasks.length}`} width={width - FOLD_PX} height={header.height} />
                </Box>
                {!isFolded &&
                  l.tasks.map(t => {
                    const isPicked = picked === t.id
                    const isStartable = STARTABLE.has(l.state)
                    const detail = isPicked ? paneSvg(t, width) : null

                    return (
                      <Box key={`row-${t.id}`} flexDirection="column" gap={1}>
                        <Box flexDirection="row" alignItems="center" gap={1}>
                          <Button key={`task:${t.id}`} label={t.id} onPress={() => update($, pickedTask, x => (x === t.id ? null : t.id))} />
                          <Svg source={leanRowSvg(t, width - ID_PX, isPicked)} alt={alt(t)} width={width - ID_PX} height={LEAN_HEIGHT} />
                        </Box>
                        {detail && (
                          <Box key={`detail-${t.id}`} flexDirection="column" gap={1}>
                            <Svg source={detail.source} alt={`${alt(t)}. ${t.title}`} width={width} height={detail.height} />
                            <Box flexWrap="wrap" columnGap={1} rowGap={1}>
                              {isStartable && (
                                <Button key={`session:${t.id}`} label="Start session" variant="primary" onPress={() => toSession($, t, l.state)} />
                              )}
                              {t.moves.map(m => (
                                <Button key={`move:${t.id}:${m.to}`} label={`Move to ${LANE_STYLES[m.to]?.[0] ?? m.name}`} onPress={() => moveTask($, t.id, m.to)} />
                              ))}
                            </Box>
                          </Box>
                        )}
                      </Box>
                    )
                  })}
              </Box>
            )
          })}
        </Box>
      )
    }
    // The dock paints grey behind every cell a pane draws, and a pane body scrolls its tree, so flexGrow has no height to fill:
    // the root takes the body's rows and fills them navy, and a longer Board still scrolls.
    const fill = (children: RenderChildren) => (
      <Box key="board-fill" flexDirection="column" minHeight={e.props.scroll.bodyRows} backgroundColor={SP.navy}>
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
          <Box flexGrow={1} />
          <Button key="refresh" label="Refresh" plain onPress={() => reloadLanes($)}>
            <Text color={SP.faint}>{g('refresh')}</Text>
          </Button>
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
  })
}
