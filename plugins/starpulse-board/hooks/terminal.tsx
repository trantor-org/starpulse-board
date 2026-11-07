import type { ElementTable, RenderElement } from 'claude-code'
import type { HeldTask, Stats } from '../types'
import { CHECKS, DC, SP, TC, laneIcon, laneOf, pathSteps, prFacts, progress, ratio, miniStats, skillInk, skillSteps, statLines, subline, termBar, testsOf } from './draw'
import type { Glyphs, Step } from './draw'

type Terminal = ElementTable<'terminal'>

/** What the terminal band draws with, and what its controls do. */
export type TermBand = {
  ui: Terminal
  t: HeldTask | null
  stats: Stats
  isMini: boolean
  /** The cells the band draws into; the head line drops its optional items to fit. */
  columns: number
  g: Glyphs
  onTakeOver: (id: string) => unknown
  onFold: () => unknown
}

// Cells the head line's title keeps before an optional head item drops.
const TITLE_MIN = 16

// A node's mark: the DAG orb in cells. One not reached is hollow; the running one is a ringed dot.
const orb = (st: string) => (st === 'now' ? '◉' : st ? '●' : '○')

// The skill machine's mark colour: its blue, the failure or hold colour on a flag, the track when not reached.
const skillDot = (st: string) => (st === 'bad' ? SP.fail : st === 'hold' ? SP.hold : st ? SP.skill : SP.track)

/** The eighth-block bar as two Texts: the filled cells in `color`, the empty track dim. */
export const barTexts = (Text: Terminal['Text'], k: number, n: number, cells: number, color: string) => {
  const [fill, track] = termBar(k, n, cells)

  return [fill && <Text color={color}>{fill}</Text>, track && <Text color={SP.track}>{track}</Text>]
}

// Nodes in a wrapping row, a dashed link between each pair coloured as the node it leads into.
const chain = (ui: Terminal, key: string, nodes: (Step & { draw: RenderElement })[], link: (st: string) => string) => {
  const { Box, Text } = ui

  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
      {nodes.flatMap((n, i) => [
        ...(i ? [<Text key={`${key}-link-${i}`} color={link(n.st)}>{'╌╌'}</Text>] : []),
        n.draw,
      ])}
    </Box>
  )
}

// The delivery path: the phases reached with their substates reached of all, then the current phase's substates and the
// flag's note; one line when the board reports no phase.
const pathRows = (ui: Terminal, t: HeldTask) => {
  const { Box, Text } = ui
  const { phases, steps, flag, why } = pathSteps(t)
  const noteColor = flag === 'bad' ? SP.failText : flag === 'hold' ? SP.holdText : SP.slate
  if (!phases) {
    return [
      <Box key="path">
        <Text color={noteColor}>{['Delivery phase not reported by the board', why].filter(Boolean).join(' · ')}</Text>
      </Box>,
    ]
  }
  const node = (key: string, n: Step, extra?: string) => ({
    ...n,
    draw: (
      <Box key={key} gap={1}>
        <Text color={DC[n.st]}>{orb(n.st)}</Text>
        <Text bold={extra !== undefined} color={TC[n.st]}>
          {n.name}
        </Text>
        {extra !== undefined && <Text color={SP.slate}>{extra}</Text>}
      </Box>
    ),
  })

  return [
    chain(ui, 'phases', phases.map(p => node(`phase-${p.name}`, p, p.count)), st => DC[st] ?? SP.track),
    <Box key="steps" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {chain(ui, 'substates', steps.map(s => node(`step-${s.name}`, s)), st => DC[st] ?? SP.track)}
      {why && <Text color={noteColor}>{why}</Text>}
    </Box>,
  ]
}

// The active skill's machine in its blue: its name, its states, and an arrow to what runs next only when it declares one.
const skillRow = (ui: Terminal, t: HeldTask) => {
  const { Box, Text } = ui
  const skill = t.skill
  if (!skill) {
    return null
  }
  const nodes = skillSteps(t, skill).map(s => ({
    ...s,
    draw: (
      <Box key={`skill-${s.name}`} gap={1}>
        <Text color={skillDot(s.st)}>{orb(s.st)}</Text>
        <Text color={skillInk(s.st)}>{s.name}</Text>
      </Box>
    ),
  }))
  const next = skill.next

  return (
    <Box key="skill" flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text bold color={SP.skillText}>
        {skill.name}
      </Text>
      {chain(ui, 'skill-states', nodes, () => SP.skill)}
      {next && (
        <Box key={`next-${next.kind}`} gap={1}>
          <Text color={next.kind === 'skill' ? SP.skill : SP.slate}>{next.kind === 'skill' ? '──▶ ◯' : '──▶ □'}</Text>
          <Text color={next.kind === 'skill' ? SP.skillText : SP.slate}>{next.name}</Text>
        </Box>
      )}
    </Box>
  )
}

// Keys in slate and values bright, as the desktop's native stats read.
const figures = (ui: Terminal, pairs: [string, string][]) =>
  pairs.map(([k, v]) => (
    <ui.Box key={`stat-${k || 'cost'}`} gap={1}>
      {k && <ui.Text color={SP.slate}>{k}</ui.Text>}
      <ui.Text color={SP.inkHi}>{v}</ui.Text>
    </ui.Box>
  ))

/**
 * The band in cells, the desktop band's facts in the same order: a head line (lane icon, ID, title, AC bar and k/n,
 * lane, Make interactive or driving, the PR's checks and number, and the fold arrow) sized to `columns`, then the
 * delivery path, the skill machine, the PR's link and facts with the tests, and the session's stats. Folded, the head
 * line alone carries the tests, cost and turns.
 */
export const termBand = ({ ui, t, stats, isMini, columns, g, onTakeOver, onFold }: TermBand) => {
  const { Box, Button, Link, Text } = ui
  const lines = statLines(stats)
  const tests = t ? testsOf(t) : null
  const p = t && progress(t)
  const [laneName, color] = t ? laneOf(t) : ['', SP.slate]
  const sub = t && subline(t)
  const checks = t?.pull ? CHECKS[t.pull.checks] : null
  const facts = t ? [...(t.pull ? prFacts(t.pull) : []), ...(tests ? [tests] : [])] : []
  const mini = miniStats(stats)

  // Every head item but the title keeps its width, so none wraps a cell at a time. Required items always draw; the
  // optional ones, most wanted first, draw while the title keeps TITLE_MIN cells; one too wide is skipped, so a
  // narrower one after it may still draw.
  const item = (key: string, cells: number, el: RenderElement) => ({ key, cells, el })
  const required = [
    t && item('head-icon', 2, <Text color={color}>{laneIcon(g, t.lane)}</Text>),
    t && item('head-id', t.id.length, <Text bold color={SP.ink}>{t.id}</Text>),
    t?.pull && checks && item(`checks-${t.id}`, 1, <Text color={checks.color}>{g(t.pull.checks)}</Text>),
    t?.pull && item('head-pr', String(t.pull.number).length + 1, <Text color={SP.muted}>{`#${t.pull.number}`}</Text>),
    item(
      'head-fold',
      1,
      <Button key="fold" label={isMini ? '▴' : '▾'} plain onPress={() => onFold()}>
        <Text color={SP.slate}>{isMini ? '▴' : '▾'}</Text>
      </Button>,
    ),
  ]
  const optional = [
    t && item('head-lane', laneName.length, <Text color={color}>{laneName}</Text>),
    isMini && tests && item('head-tests', tests.text.length, <Text color={tests.color}>{tests.text}</Text>),
    isMini && item('head-stats', mini.reduce((n, [k, v]) => n + (k ? k.length + 1 : 0) + v.length + 1, -1), <Box gap={1}>{figures(ui, mini)}</Box>),
    !isMini && p && item('head-ratio', ratio(p).length, <Text color={SP.ink}>{ratio(p)}</Text>),
    t?.interactive && item('head-driving', 7, <Text color={SP.skillText}>driving</Text>),
    t &&
      !t.interactive &&
      item(
        'head-take-over',
        18,
        <Button key="make-interactive" label="Make interactive" plain onPress={() => onTakeOver(t.id)}>
          <Text color={SP.skillText}>[Make interactive]</Text>
        </Button>,
      ),
    !isMini && p && p.k !== null && item('head-bar', 12, <Box>{barTexts(Text, p.k, p.n, 12, color)}</Box>),
  ]
  // Each item drawn costs its cells and the gap beside it; a surface not yet measured lays out at 80.
  let room = (columns > 0 ? columns : 80) - TITLE_MIN
  const shown = new Set<string>()
  for (const it of [...required, ...optional]) {
    if (it && (required.includes(it) || it.cells + 1 <= room)) {
      shown.add(it.key)
      room -= it.cells + 1
    }
  }
  const cell = (it: (typeof required)[number] | (typeof optional)[number]) =>
    it && shown.has(it.key) ? (
      <Box key={it.key} flexShrink={0}>
        {it.el}
      </Box>
    ) : null
  const [icon, id, checksMark, prNumber, fold] = required
  const [lane, miniTests, miniFigures, ratioCell, driving, takeOver, bar] = optional

  const head = (
    <Box key="head" flexDirection="row" gap={1}>
      {cell(icon)}
      {cell(id)}
      <Box key="head-title" flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" color={sub ? sub.color : SP.slate}>
          {sub ? sub.text : 'No task held'}
        </Text>
      </Box>
      {cell(bar)}
      {cell(ratioCell)}
      {cell(lane)}
      {cell(miniTests)}
      {cell(miniFigures)}
      {cell(takeOver)}
      {cell(driving)}
      {cell(checksMark)}
      {cell(prNumber)}
      {cell(fold)}
    </Box>
  )
  // A terminal without hyperlinks spells a Link's URL out after its label, so the link rides the facts row, which wraps.
  const prLink = t?.pull && (
    <Text key="pr" color={SP.muted}>
      <Link href={`https://github.com/${t.pull.repo}/pull/${t.pull.number}`} label={`#${t.pull.number}`} />
    </Text>
  )

  return (
    <Box key="band" flexDirection="column">
      {head}
      {!isMini && t && pathRows(ui, t)}
      {!isMini && t && skillRow(ui, t)}
      {!isMini && (facts.length > 0 || prLink) && (
        <Box key="facts" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {prLink}
          {facts.flatMap((f, i) => [
            ...(i || prLink ? [<Text key={`facts-sep-${i}`} color={SP.faint}>·</Text>] : []),
            <Text key={`fact-${i}`} color={f.color}>
              {f.text}
            </Text>,
          ])}
        </Box>
      )}
      {!isMini && (
        <Box key="stats" flexDirection="row" flexWrap="wrap" columnGap={2}>
          {figures(ui, lines)}
        </Box>
      )}
    </Box>
  )
}
