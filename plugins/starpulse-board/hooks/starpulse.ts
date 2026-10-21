import type { EngineInterface as Engine } from 'claude-code'
import type { BoardTask, Checks, HeldTask, Lane, Pull } from '../types'

// A task as `starpulse board` prints it. An older starpulse leaves out the criteria, the reason and each PR's checks.
export type RawTask = {
  id: string
  title: string
  assignee?: string
  holder?: string
  moves?: Record<string, unknown>
  waiting_on?: string[]
  criteria?: { text: string; checked?: boolean }[]
  pause_reason?: string
  prs?: { url: string; number?: number; checks?: string; merged?: boolean }[]
  done_at?: string
}
export type Board = { columns: { state: string; name: string; tasks: RawTask[] }[] }

export const CHECK_NAMES: Record<string, Checks> = { pass: 'pass', pending: 'pending', failing: 'fail' }

// The PR the row draws: the newest one still open, else the newest.
export const pullOf = (prs: RawTask['prs']): Pull | null => {
  const open = (prs ?? []).filter(pr => !pr.merged)
  const pr = open.at(-1) ?? prs?.at(-1)
  const parsed = pr?.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  const repo = parsed?.[1]
  const number = pr?.number ?? Number(parsed?.[2])
  if (!pr || !repo || !number) {
    return null
  }

  return { repo, number, checks: CHECK_NAMES[pr.checks ?? ''] ?? 'none' }
}

export const taskOf = (t: RawTask, c: Board['columns'][number]): HeldTask => ({
  id: t.id,
  title: t.title,
  column: c.name,
  lane: c.state,
  holder: t.assignee ?? t.holder ?? '',
  criteria: t.criteria ?? null,
  reason: t.pause_reason ?? '',
  waitingOn: t.waiting_on ?? [],
  pull: pullOf(t.prs),
})

export const heldOf = (board: Board): HeldTask[] => board.columns.flatMap(c => c.tasks.map(t => taskOf(t, c)))


// The Board as `starpulse board` prints it, narrowed by `filters`; null when it cannot be read.
export async function readBoard($: Engine, filters: string[]): Promise<Board | null> {
  try {
    const args = ['board', ...filters]
    // A start failure counts as a failed run: a non-login PATH (a Desktop SSH session's) lacks ~/.local/bin.
    const run = (argv0: string) => $.process.run([argv0, ...args]).catch(() => null)
    let ran = await run('starpulse')
    if (ran?.exitCode !== 0) {
      // A virtualenv on PATH can hold a starpulse older than --assignee; the user-wide install is current.
      ran = await run(`${await $.env.get('HOME')}/.local/bin/starpulse`)
    }
    if (ran?.exitCode !== 0) {
      return null
    }

    return JSON.parse(ran.stdout) as Board
  } catch {
    return null
  }
}


// The Board tab's lanes, in the order work moves through them; New and Archived stay off it.
export const LANES = ['ready', 'waiting', 'in_progress', 'review', 'needs_attention', 'done']

// A Done task leaves the Board tab this long after it reached Done.
export const DONE_WINDOW_MS = 24 * 3_600_000

// A Done task with no `done_at` (an older starpulse) stays: the lane is folded to its count.
const isRecent = (t: RawTask, state: string, now: number) => {
  const doneAt = Date.parse(t.done_at ?? '')
  return state !== 'done' || Number.isNaN(doneAt) || now - doneAt <= DONE_WINDOW_MS
}

// The lanes of a Board that hold a task, each task with the columns it may move to; empty when there is no Board.
export const openLanes = (board: Board | null, now = 0): Lane[] => {
  const columns = board?.columns ?? []
  const names = new Map(columns.map(c => [c.state, c.name]))
  const task = (t: RawTask, c: Board['columns'][number]): BoardTask => ({
    ...taskOf(t, c),
    assignee: t.assignee ?? '',
    // A move StarPulse marks `allowed: false` would only be refused, so it draws no button.
    moves: Object.entries(t.moves ?? {})
      .filter(([, m]) => (m as { allowed?: boolean } | null)?.allowed !== false)
      .map(([to]) => ({ to, name: names.get(to) ?? to })),
  })
  const lane = (c: Board['columns'][number]): Lane => ({
    state: c.state,
    name: c.name,
    tasks: c.tasks.filter(t => isRecent(t, c.state, now)).map(t => task(t, c)),
  })

  return LANES.flatMap(state => columns.filter(c => c.state === state))
    .map(lane)
    .filter(l => l.tasks.length > 0)
}

// The open lanes of the whole Board, read once; empty when the Board cannot be read.
export async function readLanes($: Engine): Promise<Lane[]> {
  return openLanes(await readBoard($, []), await $.clock.now())
}

// Waits before starting a child that ended again: a second after one that printed, doubling to half a minute while none does.
export const retryMs = (tries: number) => Math.min(1000 * 2 ** tries, 30_000)

// A followed child: `child` is the one running now, and `isStopped` keeps it from starting again.
export type Run = { isStopped: boolean; child: ReturnType<Engine['process']['spawn']> | null }

export const newRun = (): Run => ({ isStopped: false, child: null })

// Ends the child now, as leaving its loop does, and keeps `follow` from starting another.
export const stop = (run: Run) => {
  run.isStopped = true
  void run.child?.return({ code: null, signal: null }).catch(() => undefined)
}

// Runs `argv` for as long as it lives, handing `line` each line it prints, and starts it again once it ends, unless `run` was stopped.
export async function follow($: Engine, argv: string[], input: string | undefined, line: (text: string) => unknown, run = newRun(), tries = 0) {
  let rest = ''
  let hasPrinted = false
  try {
    run.child = $.process.spawn({ argv, input })
    for await (const chunk of run.child) {
      if (chunk.stream !== 'stdout') {
        continue
      }
      const lines = (rest + chunk.text).split('\n')
      rest = lines.pop() ?? ''
      for (const text of lines) {
        hasPrinted = true
        await line(text)
      }
    }
  } catch {
    // A child that cannot start, or a line that cannot be read, ends this run like an exit.
  }
  if (run.isStopped) {
    return
  }
  const next = hasPrinted ? 0 : tries
  $.clock.after(retryMs(next), () => follow($, argv, input, line, run, next + 1))
}

// Reads an event stream line by line, handing `frame` each event's name and data.
export const events = (frame: (event: string, data: string) => unknown) => {
  let event = ''
  let data: string[] = []
  return async (line: string) => {
    if (line === '') {
      const [name, text] = [event, data.join('\n')]
      ;[event, data] = ['', []]
      if (text) {
        await frame(name, text)
      }
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''))
    }
  }
}

// The argv and stdin of curl following one of the server's event streams.
export async function streamOf($: Engine, path: string) {
  const token = await $.env.get('STARPULSE_TOKEN')
  const server = ((await $.env.get('STARPULSE_URL')) || 'http://localhost:8766').replace(/\/$/, '')
  // The token goes in on stdin: every process on the host can read a child's argv.
  const auth = token ? ['-H', '@-'] : []

  return { argv: ['curl', '-sfN', ...auth, `${server}${path}`], input: token ? `Authorization: Bearer ${token}\n` : undefined }
}

// A write to the StarPulse server `starpulse board` reads: null when it took, else the reason it was refused.
export async function post($: Engine, path: string, body: object): Promise<string | null> {
  const server = ((await $.env.get('STARPULSE_URL')) || 'http://localhost:8766').replace(/\/+$/, '')
  const argv = ['curl', '-sS', '-X', 'POST', '-H', 'Content-Type: application/json', '--data', JSON.stringify(body)]
  const ran = await $.process.run([...argv, '-w', '\n%{http_code}', `${server}${path}`]).catch(() => null)
  if (ran?.exitCode !== 0) {
    return `Cannot reach StarPulse at ${server}`
  }
  const lines = ran.stdout.trimEnd().split('\n')
  const code = lines.pop()
  if (code === '200') {
    return null
  }
  try {
    return (JSON.parse(lines.join('\n')) as { error?: string }).error ?? `StarPulse answered ${code}`
  } catch {
    return `StarPulse answered ${code}`
  }
}

