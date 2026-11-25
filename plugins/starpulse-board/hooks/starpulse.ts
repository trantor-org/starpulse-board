import type { EngineInterface as Engine } from 'claude-code'
import type { Checks, HeldTask, Pull, Skill } from '../types'

// A task as `starpulse board` prints it. An older starpulse leaves out the criteria, the reason and each PR's checks.
export type RawTask = {
  id: string
  title: string
  assignee?: string
  holder?: string
  waiting_on?: string[]
  criteria?: { text: string; checked?: boolean }[]
  pause_reason?: string
  phase?: string | null
  substate?: string | null
  skill?: Skill | null
  interactive?: boolean
  prs?: { url: string; number?: number; checks?: string; merged?: boolean; threads?: number | null; behind_main?: number | null; updatedAt?: string }[]
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

  return { repo, number, checks: CHECK_NAMES[pr.checks ?? ''] ?? 'none', threads: pr.threads ?? null, behindMain: pr.behind_main ?? null }
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
  phase: t.phase ?? '',
  substate: t.substate ?? '',
  skill: t.skill ?? null,
  interactive: t.interactive ?? false,
})

// A task as the `tasks` query and `taskChanges` subscription select it, by `TASK_FIELDS`.
export type GqlTask = {
  id: string
  title: string
  lane: string
  assignee: string | null
  dependencies: string[]
  criteria: { text: string; checked: boolean }[]
  pauseReason: string
  phase: string | null
  substate: string | null
  skill: Skill | null
  interactive: boolean
  prs: { repo: string; number: number; state: string; checks: string; threads: number; updatedAt: string | null }[]
}

export const TASK_FIELDS = `id title lane assignee dependencies criteria { text checked } pauseReason phase substate
  skill { name states current next { kind name } } interactive
  prs { repo number state checks threads updatedAt }`

// The held tasks' read, at the stream position a `taskChanges` subscription follows from.
export const HELD_QUERY = `{ tasks { position items { ${TASK_FIELDS} } } }`
export const CHANGES_QUERY = `subscription Changes($from: Int!) { taskChanges(from: $from) { id machine task { ${TASK_FIELDS} } } }`

const titled = (lane: string) => lane.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

// The task the band draws. `waitingOn` is every dependency: the server serves no list of the unmet ones.
export const heldTaskOf = (t: GqlTask): HeldTask =>
  taskOf(
    {
      id: t.id,
      title: t.title,
      assignee: t.assignee ?? '',
      waiting_on: t.dependencies,
      criteria: t.criteria,
      pause_reason: t.pauseReason,
      phase: t.phase,
      substate: t.substate,
      skill: t.skill,
      interactive: t.interactive,
      prs: t.prs.map(pr => ({ url: `https://github.com/${pr.repo}/pull/${pr.number}`, number: pr.number, checks: pr.checks, merged: pr.state === 'MERGED', threads: pr.threads })),
    },
    { state: t.lane, name: titled(t.lane), tasks: [] },
  )

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


// Waits before starting a child that ended again: a second after one that printed, doubling to half a minute while none does.
export const retryMs = (tries: number) => Math.min(1000 * 2 ** tries, 30_000)

// A followed child: `child` is the one running now, and `isStopped` keeps it from starting again.
export type Run = { isStopped: boolean; child: ReturnType<Engine['process']['spawn']> | null }

export const newRun = (): Run => ({ isStopped: false, child: null })

// What a followed child runs: its argv and what goes in on stdin.
export type Launch = () => Promise<{ argv: string[]; input?: string }>

// Runs what `launch` names for as long as it lives, handing `line` each line it prints, and asks `launch` again once it ends,
// unless `run` was stopped. A `launch` that throws ends the run like an exit.
export async function follow($: Engine, launch: Launch, line: (text: string) => unknown, run = newRun(), tries = 0) {
  if (run.isStopped) {
    return
  }
  let rest = ''
  let hasPrinted = false
  try {
    const { argv, input } = await launch()
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
  $.clock.after(retryMs(next), () => follow($, launch, line, run, next + 1))
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

// The server URL and, when STARPULSE_TOKEN is set, the curl header flags and the stdin that carries it.
async function connection($: Engine) {
  const token = await $.env.get('STARPULSE_TOKEN')
  const server = ((await $.env.get('STARPULSE_URL')) || 'http://localhost:8766').replace(/\/+$/, '')

  // The token goes in on stdin: every process on the host can read a child's argv.
  return { server, auth: token ? ['-H', '@-'] : [], input: token ? `Authorization: Bearer ${token}\n` : undefined }
}

// The argv and stdin of curl sending the server one GraphQL document; a subscription answers with an event stream.
export async function graphql($: Engine, query: string, variables: object = {}) {
  const { server, auth, input } = await connection($)
  const body = JSON.stringify({ query, variables })

  return { argv: ['curl', '-sfN', ...auth, '-H', 'Content-Type: application/json', '--data', body, `${server}/graphql`], input }
}

// The `data` of a query's answer; throws when the server cannot be reached or refuses it.
export async function ask<T>($: Engine, query: string, variables: object = {}): Promise<T> {
  const { argv, input } = await graphql($, query, variables)
  let out = ''
  for await (const chunk of $.process.spawn({ argv, input })) {
    out += chunk.stream === 'stdout' ? chunk.text : ''
  }
  const answered = JSON.parse(out) as { data?: T; errors?: { message: string }[] }
  if (!answered.data) {
    throw new Error(answered.errors?.[0]?.message ?? 'StarPulse answered no data')
  }

  return answered.data
}

// A write to the StarPulse server `starpulse board` reads: null when it took, else the reason it was refused.
export async function post($: Engine, path: string, body: object): Promise<string | null> {
  const { server, auth, input } = await connection($)
  const argv = ['curl', '-sS', '-X', 'POST', ...auth, '-H', 'Content-Type: application/json', '--data', JSON.stringify(body), '-w', '\n%{http_code}', `${server}${path}`]
  let out = ''
  try {
    for await (const chunk of $.process.spawn({ argv, input })) {
      out += chunk.stream === 'stdout' ? chunk.text : ''
    }
  } catch {
    // A curl that cannot start reads as one that cannot connect.
  }
  const lines = out.trimEnd().split('\n')
  const code = lines.pop()
  // curl prints 000 when it never connected.
  if (!code || code === '000') {
    return `Cannot reach StarPulse at ${server}`
  }
  if (code === '200') {
    return null
  }
  try {
    return (JSON.parse(lines.join('\n')) as { error?: string }).error ?? `StarPulse answered ${code}`
  } catch {
    return `StarPulse answered ${code}`
  }
}

