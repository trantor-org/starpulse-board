import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface as Engine, Register } from 'claude-code'
import type { HeldTask, Stats } from '../types'
import { BAND_HEIGHT, NO_STATS, SP, alt, bandBodySvg, bandHeadSvg, glyphs, miniStats, miniSvg, statLines } from './draw'
import { events, follow, heldOf, post, readBoard, streamOf } from './starpulse'
import type { Board } from './starpulse'
import { termBand } from './terminal'

const tasks = atom({ plugin: 'starpulse-board', key: 'tasks' } as const, null)
const stats = atom({ plugin: 'starpulse-board', key: 'stats' } as const, NO_STATS)
const isMini = atom({ plugin: 'starpulse-board', key: 'isMini' } as const, false)

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

// Hands the task's session to the operator; StarPulse refuses one with no running workflow, and the refusal toasts.
const takeOver = async ($: Engine, id: string) => {
  const refused = await post($, '/api/take-over', { task: id })
  if (refused) {
    $.ui.toast(refused)
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
// A drawing's pixel width from the surface's columns; a surface not yet measured has none, so it takes the narrowest.
const pxWidth = (columns: number, lo: number, hi: number) => (Number.isFinite(columns) && columns > 0 ? clamp(Math.floor(columns * CELL_PX), lo, hi) : lo)

// Pixels a monospace cell takes on the remote surfaces, and the room the band's PR link and fold button take over its
// head drawing.
const CELL_PX = 7.5
const TOOLS_PX = 96
// Folded, the tools also carry the cost and turns.
const MINI_TOOLS_PX = 230

type Terminal = ElementTable<'terminal'>
// Every surface but the terminal draws the Svg; the desktop's table stands for them (Box, Text and Button are the same).
type Remote = ElementTable<'desktop'>

export const register: Register = (on, options) => {
  const g = glyphs(options.glyphs)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: 'List the Board tasks this session holds' })
    void followHeld($)

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

  // The band is always on, on every surface: the held task's path, PR facts and stats, drawn in cells on the terminal. A survey
  // holding the slot draws below it, in what `next` returns, so the band does not vanish until the survey ends.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const found = (await read($, tasks)) ?? []
    const { Box, Button, Text, Svg, Link } = $.ui.resolve(e) as Remote
    // The plugins beneath (a skin, the engine's own row) draw below the band, as claude-skins composes its own.
    const theirs = await next(e)
    const t = found[0] ?? null
    const s = await read($, stats)
    const mini = await read($, isMini)
    if (e.surface === 'terminal') {
      return (
        <Box key="band-wrap" flexDirection="column">
          {termBand({
            ui: $.ui.resolve(e) as Terminal,
            t,
            stats: s,
            isMini: mini,
            g,
            onTakeOver: id => takeOver($, id),
            onFold: () => update($, isMini, x => !x),
          })}
          {theirs}
        </Box>
      )
    }
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
      <Box key="band" flexDirection="column" overflow="hidden">
        {/* The band draws on the page's own background with no frame; its head is one centred row, the drawing then its tools. */}
        <Box key="head" flexDirection="row" alignItems="center">
          <Svg
            source={mini ? miniSvg(t, W - MINI_TOOLS_PX, 0) : bandHeadSvg(t, W - TOOLS_PX, 0)}
            alt={t ? alt(t) : 'No task held'}
            width={W - (mini ? MINI_TOOLS_PX : TOOLS_PX)}
            height={BAND_HEIGHT}
            isInteractive
          />
          <Box key="tools" flexGrow={1} flexDirection="row" justifyContent="flex-end" alignItems="center" gap="xs" paddingX="sm">
            {mini && figures(miniStats(s))}
            {t && !t.interactive && <Button key="make-interactive" label="Make interactive" onPress={() => takeOver($, t.id)} />}
            {t?.interactive && (
              <Text key="driving" color={SP.skillText}>
                driving
              </Text>
            )}
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
}
