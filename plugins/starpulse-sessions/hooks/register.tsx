import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface as Engine, Register } from 'claude-code'
import type { ArchivedSession, PeerSession } from '../types'
import { LANE_STYLES, SP, glyphs } from './glyphs'
import { follow, readLanes } from './starpulse'
import { CHIPS, GROUPS, ago, alive, countOf, focusedId, groupOf, holdersOf, lanesOf, matches, ordered, rowLabel, rowsOf } from './sessions'
import type { Group, Row, Status } from './sessions'

const SESSIONS = 'starpulse-sessions'

// The table every surface that draws the pane shares: the terminal's elements plus the desktop's Input, which the filter needs.
type Remote = ElementTable<'desktop'>

const sessions = atom({ plugin: 'starpulse-sessions', key: 'sessions' } as const, [])
const lanes = atom({ plugin: 'starpulse-sessions', key: 'lanes' } as const, null)
const archived = atom({ plugin: 'starpulse-sessions', key: 'archived' } as const, [])
const query = atom({ plugin: 'starpulse-sessions', key: 'query' } as const, '')
const chips = atom({ plugin: 'starpulse-sessions', key: 'chips' } as const, [])
const sessionFolds = atom({ plugin: 'starpulse-sessions', key: 'sessionFolds' } as const, ['archived'])
const focused = atom({ plugin: 'starpulse-sessions', key: 'focused' } as const, null)

type Registered = {
  sessionId: string
  pid: number
  name?: string
  status?: string
  kind?: string
  cwd?: string
  updatedAt?: number
  bridgeSessionId?: string | null
}

// Where Claude Code keeps a session's transcript: under its cwd with every character but a letter or digit made a dash.
const transcriptOf = (home: string, s: Registered) => `${home}/.claude/projects/${(s.cwd ?? '').replace(/[^A-Za-z0-9]/g, '-')}/${s.sessionId}.jsonl`

// The sessions claude.ai archived: Remote Control once bridged them, as their transcript's bridge-session row says, and
// archiving dropped the bridge from the registry while the process runs on. One grep reads every unbridged transcript.
const archivedRemotely = async ($: Engine, home: string, known: Registered[]) => {
  const unbridged = known.filter(s => !s.bridgeSessionId && s.cwd)
  const paths = new Map(unbridged.map(s => [transcriptOf(home, s), s.sessionId]))
  const ran = paths.size ? await $.process.run(['grep', '-l', '-s', '-F', '"type":"bridge-session"', ...paths.keys()]).catch(() => null) : null
  const lines = ran?.stdout.split('\n') ?? []

  return new Set(lines.flatMap(line => paths.get(line) ?? []))
}

type TitleRow = { type: string; aiTitle?: string; customTitle?: string }

// A transcript line cut mid-write reads as no title, not as a fault that empties the pane.
const titleRow = (text: string): TitleRow | null => {
  try {
    return JSON.parse(text) as TitleRow
  } catch {
    return null
  }
}

// The title Claude gives each session in its transcript: the last custom-title (/rename), else the last ai-title, which
// it rewrites as the work goes. One grep reads every transcript; a session with neither keeps its registry name.
const titlesOf = async ($: Engine, home: string, known: Registered[]) => {
  const paths = new Map(known.filter(s => s.cwd).map(s => [transcriptOf(home, s), s.sessionId]))
  const ran = paths.size ? await $.process.run(['grep', '-H', '-s', '-E', '"type":"(custom|ai)-title"', ...paths.keys()]).catch(() => null) : null
  const custom = new Map<string, string>()
  const ai = new Map<string, string>()
  for (const line of ran?.stdout.split('\n') ?? []) {
    const at = line.indexOf('.jsonl:') + '.jsonl'.length
    const id = paths.get(line.slice(0, at))
    const row = id ? titleRow(line.slice(at + 1)) : null
    if (id && row?.customTitle) custom.set(id, row.customTitle)
    if (id && row?.aiTitle) ai.set(id, row.aiTitle)
  }

  return new Map([...ai, ...custom])
}

// Each tmux pane's pid and the tmux session it sits in; empty when no tmux server runs.
const tmuxPanes = async ($: Engine): Promise<Map<number, string>> => {
  const panes = new Map<number, string>()
  const ran = await $.process.run(['tmux', 'list-panes', '-a', '-F', '#{pane_pid} #{session_name}']).catch(() => null)
  if (ran?.exitCode !== 0) {
    return panes
  }
  for (const row of ran.stdout.split('\n')) {
    const [pid, ...name] = row.split(' ')
    if (name.length) {
      panes.set(Number(pid), name.join(' '))
    }
  }

  return panes
}

// The tmux session this session's own pane sits in, for a session started by hand: its pid is the shell's child, not the pane's.
const ownTmux = async ($: Engine): Promise<string | null> => {
  const pane = await $.env.get('TMUX_PANE')
  const ran = pane ? await $.process.run(['tmux', 'display-message', '-p', '-t', pane, '#{session_name}']).catch(() => null) : null

  return ran?.exitCode === 0 ? ran.stdout.trim() || null : null
}

// The host's sessions, this one included, from the registry every Claude Code session writes under ~/.claude/sessions.
// A session StarPulse started runs as its tmux pane's own process, so its pid finds the tmux session to switch to.
const peers = async ($: Engine): Promise<PeerSession[]> => {
  try {
    const home = await $.env.get('HOME')
    const dir = `${home}/.claude/sessions`
    const own = await $.session.id()
    const [entries, panes] = await Promise.all([$.fs.list(dir), tmuxPanes($)])
    const files = entries.filter(f => f.name.endsWith('.json'))
    // A session that exits between the listing and the read is skipped, not fatal.
    const found = await Promise.all(
      files.map(f =>
        $.fs
          .read(`${dir}/${f.name}`)
          .then(text => JSON.parse(String(text)) as Registered)
          .catch(() => null),
      ),
    )
    const known = found.filter((s): s is Registered => s !== null)
    const mine = known.find(s => s.sessionId === own)
    const handTmux = mine && !panes.has(mine.pid) ? await ownTmux($) : null
    const [remote, titles] = await Promise.all([archivedRemotely($, String(home), known), titlesOf($, String(home), known)])

    return known
      .map(s => {
        const tmux = panes.get(s.pid) ?? (s === mine ? handTmux : null)
        const label = tmux ?? s.name ?? s.sessionId.slice(0, 8)
        return {
          id: s.sessionId,
          label,
          name: titles.get(s.sessionId) ?? s.name ?? label,
          status: s.status ?? 'unknown',
          tmux,
          isBackground: s.kind === 'bg',
          isOwn: s.sessionId === own,
          cwd: s.cwd ?? '',
          updatedAt: s.updatedAt ?? 0,
          isArchivedRemotely: remote.has(s.sessionId),
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    return []
  }
}


// The sessions other than this one that are not archived: what the band counts and a task's Go to session looks through.
const elsewhere = (all: PeerSession[], kept: ArchivedSession[]) => alive(all, kept).filter(s => !s.isOwn)

const reloadLanes = async ($: Engine) => {
  const found = await readLanes($)
  await update($, lanes, () => found)
}


let hasOpened = false
// The Sessions rows name the task each session holds, so a registry change rereads the whole Board, at most twice a minute.
let lanesReadAt = 0
const LANES_EVERY_MS = 30_000
const listPeers = async ($: Engine) => {
  const all = await peers($)
  await update($, sessions, () => all)
  const now = await $.clock.now()
  if (now - lanesReadAt >= LANES_EVERY_MS) {
    lanesReadAt = now
    void reloadLanes($)
  }
  // The first list opens the dock unasked: Sessions when another session runs, the prompt keeps the keys.
  if (!hasOpened) {
    hasOpened = true
    if (elsewhere(all, await read($, archived)).length) {
      await $.ui.open({ id: SESSIONS, title: 'Sessions' })
    }
  }
}

// Rereads the registry without holding up the watch, one read at a time, rereading once if a change came in during it.
let reading: Promise<unknown> | null = null
let isStale = false
const listPeersSoon = ($: Engine) => {
  if (reading) {
    isStale = true
    return
  }
  reading = listPeers($).finally(() => {
    reading = null
    if (isStale) {
      isStale = false
      listPeersSoon($)
    }
  })
}

// Each write to the registry (a session starting, ending, or going busy or idle) rereads it.
const followPeers = async ($: Engine) => {
  const dir = `${await $.env.get('HOME')}/.claude/sessions`
  const argv = ['inotifywait', '-mq', '-e', 'create,delete,modify,moved_to,moved_from', '--format', '%f', dir]

  await follow($, argv, undefined, () => listPeersSoon($))
}


const tmux = ($: Engine, ...args: string[]) => $.process.run(['tmux', ...args]).catch(() => null)

// A session in a tmux pane is switched to. A background session has no pane, so it is first opened with `claude attach`
// in a tmux session of its own (-A reuses one already open). `claude attach` takes the job id, the session id's first 8
// characters (~/.claude/jobs/<job>), and refuses the full id. Fails visibly: switch-client needs this session's own
// terminal to be a tmux client.
const switchTo = async ($: Engine, s: PeerSession) => {
  let target = s.tmux
  if (target === null) {
    const job = s.id.slice(0, 8)
    target = `bg-${job}`
    const opened = await tmux($, 'new-session', '-A', '-d', '-s', target, 'claude', 'attach', job)
    if (opened?.exitCode !== 0) {
      $.ui.toast(`Cannot open ${s.label} in tmux: is tmux installed?`)
      return
    }
  }
  const ran = await tmux($, 'switch-client', '-t', target)
  if (ran?.exitCode !== 0) {
    $.ui.toast(`Cannot switch to ${s.label}: start Claude inside tmux to switch sessions`)
  }
}

// A tmux session named claude-<six digits> running `command` at `cwd`, started detached: its name, or null when tmux refused.
const startTmux = async ($: Engine, cwd: string, command: string[]): Promise<string | null> => {
  const name = `claude-${String((await $.clock.now()) % 1_000_000).padStart(6, '0')}`
  const ran = await $.process.run(['tmux', 'new-session', '-d', '-s', name, '-c', cwd, ...command]).catch(() => null)

  return ran?.exitCode === 0 ? name : null
}

// Runs `command` in a tmux session of its own and switches to it: the session's name, or null once a toast says why not.
const launch = async ($: Engine, cwd: string, command: string[], failure: string): Promise<string | null> => {
  const name = await startTmux($, cwd, command)
  if (name === null) {
    $.ui.toast(failure)
    return null
  }
  const ran = await tmux($, 'switch-client', '-t', name)
  if (ran?.exitCode !== 0) {
    $.ui.toast(`Started ${name}: tmux attach -t ${name}`)
  }

  return name
}

const newSession = async ($: Engine) => {
  await launch($, await $.session.root(), ['claude'], 'Cannot start a tmux session: is tmux installed?')
}

// The archived list, newest first, kept in $.store and drawn from the atom.
const saveArchived = async ($: Engine, list: ArchivedSession[]) => {
  await $.store.set('archived', list)
  await update($, archived, () => list)
}

const currentRows = async ($: Engine): Promise<Row[]> => {
  const found = await read($, lanes)

  return rowsOf(await read($, sessions), await read($, archived), holdersOf(found), lanesOf(found))
}

// Hides the session and kills its tmux session. This session's own is first replaced by a fresh one that is switched to,
// since killing it ends this process: the list is saved before the kill for the same reason.
const archive = async ($: Engine, r: Row) => {
  if (r.isOwn) {
    const fresh = r.tmux === null ? null : await startTmux($, await $.session.root(), ['claude'])
    const ran = fresh === null ? null : await tmux($, 'switch-client', '-t', fresh)
    if (ran?.exitCode !== 0) {
      if (fresh !== null) {
        await tmux($, 'kill-session', '-t', fresh)
      }
      $.ui.toast('Not archived: no fresh tmux session to switch to first')
      return
    }
  }
  const entry = { sessionId: r.id, name: r.name, cwd: r.cwd, task: r.task, archivedAt: await $.clock.now() }
  await saveArchived($, [entry, ...(await read($, archived)).filter(a => a.sessionId !== r.id)])
  if (r.tmux !== null) {
    await tmux($, 'kill-session', '-t', r.tmux)
  }
}

// Reopens an archived session with `claude --resume` in a new tmux session at its recorded directory.
const resume = async ($: Engine, r: Row) => {
  const cwd = r.cwd || (await $.session.root())
  const name = await launch($, cwd, ['claude', '--resume', r.id], `Cannot resume ${r.name}: is tmux installed?`)
  if (name !== null) {
    await saveArchived($, (await read($, archived)).filter(a => a.sessionId !== r.id))
  }
}

// A row's press goes to its session: an archived one resumes, this one only says so, any other is in a tmux pane,
// a session archived in claude.ai included.
const enter = async ($: Engine, r: Row) => {
  if (r.status === 'archived' && !r.peer) {
    await resume($, r)
  } else if (r.isOwn) {
    $.ui.toast('This is the session you are in')
  } else if (r.peer) {
    await switchTo($, r.peer)
  }
}

// The `a` key: archives the row under the focus, or resumes it when it is archived and no longer runs.
const actOnFocused = async ($: Engine) => {
  const id = focusedId(await read($, focused))
  const r = (await currentRows($)).find(x => x.id === id)
  if (!r) {
    $.ui.toast('Focus a session with ↑↓ first')
  } else if (r.status === 'archived' && !r.peer) {
    await resume($, r)
  } else {
    await archive($, r)
  }
}


const cut = (text: string, room: number): [shown: string, pad: string] => {
  const chars = [...text]
  if (chars.length <= room) {
    return [text, ' '.repeat(room - chars.length)]
  }

  return [`${chars.slice(0, Math.max(0, room - 1)).join('')}…`, '']
}

export const register: Register = (on, options) => {
  const g = glyphs(options.glyphs)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sessions', description: 'Open the Sessions tab in the dock' })
    const kept = await $.store.get('archived').catch(() => undefined)
    await update($, archived, () => (Array.isArray(kept) ? (kept as ArchivedSession[]) : []))
    listPeersSoon($)
    void followPeers($)

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await $.ui.open({ id: SESSIONS, title: 'Sessions', focus: true })

    return { text: 'Opened the Sessions tab.' }
  })

  // The ring's position is what `a` acts on.
  on('ui.focus', { requestId: SESSIONS }, async ($, e, next) => {
    const result = await next(e)
    if (!result.deny) {
      await update($, focused, () => e.element ?? null)
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: SESSIONS }, async ($, e) => {
    // Outside the fullscreen layout the terminal places a pane inline above the prompt; like Files, Sessions shows only in the dock.
    if (e.surface === 'terminal' && e.props.placement === 'inline') {
      void $.ui.close({ id: SESSIONS }).catch(() => undefined)
      const { Box } = $.ui.resolve(e)
      return <Box />
    }
    const found = await read($, lanes)
    const text = await read($, query)
    const active = await read($, chips)
    const shut = await read($, sessionFolds)
    const now = await $.clock.now()
    const cols = e.props.bodyColumns
    const { Box, Button, Input, Text } = $.ui.resolve(e) as Remote

    const all = rowsOf(await read($, sessions), await read($, archived), holdersOf(found), lanesOf(found))
    const shown = all.filter(r => matches(r, text, active))
    const statusStyle: Record<Status, string> = { working: SP.run, idle: SP.slate, archived: SP.muted }
    const groupStyle: Record<Group, string> = { active: SP.ink, archived: SP.muted }
    const fold = (group: string) => update($, sessionFolds, f => (f.includes(group) ? f.filter(x => x !== group) : [...f, group]))
    const flip = async (c: Status) => {
      const isOn = active.includes(c)
      await update($, chips, list => (isOn ? list.filter(x => x !== c) : [...list, c]))
      if (c === 'archived' && !isOn) {
        await update($, sessionFolds, f => f.filter(x => x !== 'archived'))
      }
    }

    const chip = (c: Status) => {
      const label = `${c} ${countOf(all, c)}`
      const isOn = active.includes(c)

      return (
        <Button key={`chip:${c}`} label={label} plain onPress={() => flip(c)}>
          <Text color={isOn ? statusStyle[c] : SP.faint}>{`${g(c)} `}</Text>
          <Text bold={isOn} color={isOn ? statusStyle[c] : SP.muted}>
            {label}
          </Text>
        </Button>
      )
    }

    // Name room: what the columns leave once the icon, the facts and the age are drawn; one cell stays spare.
    const row = (r: Row) => {
      const age = ago(now, r.updatedAt)
      const fixed = 2 + 1 + 1 + (r.isOwn ? 6 : 0) + (r.task ? r.task.length + 1 : 0) + 4 + 1 + 2
      const [name, pad] = cut(r.name, Math.max(1, cols - fixed))
      const isArchived = r.status === 'archived'
      const isResumable = isArchived && !r.peer
      const taskColor = LANE_STYLES[r.lane]?.[1] ?? SP.slate

      return (
        <Box key={`row-${r.id}`}>
          <Button key={`session:${r.id}`} label={rowLabel(r, age)} plain onPress={() => enter($, r)}>
            {'  '}
            <Text color={statusStyle[r.status]}>{g(r.status)}</Text>
            {' '}
            <Text bold={r.isOwn} color={isArchived ? SP.muted : SP.ink}>
              {name}
            </Text>
            {pad}
            {r.isOwn && <Text color={SP.agent}>{` ${g('you')} you`}</Text>}
            {r.task && <Text color={taskColor}>{` ${r.task}`}</Text>}
            <Text color={SP.muted}>{` ${age.padStart(3)}`}</Text>
          </Button>
          {isResumable ? (
            <Button key={`resume:${r.id}`} label={`Resume ${r.name}`} plain onPress={() => resume($, r)}>
              {' '}
              <Text color={SP.ok}>{g('start')}</Text>
            </Button>
          ) : (
            <Button key={`archive:${r.id}`} label={`Archive ${r.name}`} plain onPress={() => archive($, r)}>
              {' '}
              <Text color={SP.faint}>{g('archive')}</Text>
            </Button>
          )}
        </Box>
      )
    }

    // The dock paints grey behind every cell a pane draws, and a pane body scrolls its tree, so the root takes the body's rows and fills them black.
    return (
      <Box key="sessions-fill" flexDirection="column" minHeight={e.props.scroll.bodyRows} backgroundColor={SP.black}>
        <Box>
          <Button key="new" label="New session" hotkey="n" plain onPress={() => newSession($)}>
            <Text bold color={SP.agent}>{`${g('new')} New session`}</Text>
          </Button>
          <Box flexGrow={1} />
          <Button key="refresh" label="Refresh" plain onPress={() => {
              lanesReadAt = 0
              listPeersSoon($)
            }}
          >
            <Text color={SP.faint}>{g('refresh')}</Text>
          </Button>
        </Box>
        <Box>
          <Button key="focus-filter" label="Filter" hotkey="f" plain onPress={() => $.ui.focus({ requestId: SESSIONS, key: 'filter' })}>
            <Text color={SP.muted}>{`${g('filter')} `}</Text>
          </Button>
          <Input
            key="filter"
            placeholder="filter sessions, tmux or task"
            value={text}
            onInput={v => update($, query, () => v)}
            onSubmit={() => $.ui.focus({ requestId: SESSIONS, key: `session:${ordered(shown)[0]?.id}` }).catch(() => undefined)}
          />
        </Box>
        <Box flexWrap="wrap" columnGap={2}>
          {CHIPS.map(chip)}
        </Box>
        {GROUPS.map(([group, name]) => {
          const rows = ordered(shown.filter(r => groupOf(r) === group))
          const isFolded = shut.includes(group)
          const header = `${name.toUpperCase()} ${rows.length}`

          return (
            rows.length > 0 && (
              <Box key={`group-${group}`} flexDirection="column" marginTop={1}>
                <Box>
                  <Button key={`fold:${group}`} label={`${isFolded ? '▸' : '▾'} ${name} ${rows.length}`} plain onPress={() => fold(group)}>
                    <Text color={SP.faint}>{g(isFolded ? 'right' : 'down')}</Text>
                    {' '}
                    <Text bold color={groupStyle[group]}>
                      {name.toUpperCase()}
                    </Text>
                    {' '}
                    <Text color={SP.muted}>{String(rows.length)}</Text>
                  </Button>
                  <Text color={SP.track}>{` ${'─'.repeat(Math.max(0, cols - header.length - 6))}`}</Text>
                </Box>
                {!isFolded && rows.map(row)}
              </Box>
            )
          )
        })}
        {!shown.length && (
          <Box marginTop={1}>
            <Text color={SP.muted}>{text ? `  No session matches “${text}”` : '  No sessions'}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={SP.faint}>↑↓ move · ↵ open · n new · f filter · </Text>
          <Button key="archive-focused" label="Archive or resume the focused session" hotkey="a" plain onPress={() => actOnFocused($)}>
            <Text color={SP.faint}>{!shut.includes('archived') && shown.some(r => r.status === 'archived') ? 'archive/resume' : 'archive'}</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
