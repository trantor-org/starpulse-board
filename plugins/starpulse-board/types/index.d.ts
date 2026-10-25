/** What a pull request's checks roll up to; `none` when it has no required checks yet. */
export type Checks = 'pass' | 'pending' | 'fail' | 'none'

/** The pull request a task cites: its repository, number, checks, open review threads and commits behind main (null when unknown). */
export type Pull = { repo: string; number: number; checks: Checks; threads: number | null; behindMain: number | null }

/** One acceptance criterion; `checked` is absent when the server cannot say. */
export type Criterion = { text: string; checked?: boolean }

/**
 * One task the session holds: its key, title, the name of the column it sits in and that column's lane id, plus what
 * the band draws of it. `criteria` is null when the server serves none (an older `starpulse`); `reason` is why a
 * Needs attention task waits on the operator, empty otherwise.
 */
export type HeldTask = {
  id: string
  title: string
  column: string
  lane: string
  holder: string
  criteria: Criterion[] | null
  reason: string
  waitingOn: string[]
  pull: Pull | null
  /** The delivery phase (`build`, `deliver`, `review_fix`, `parked`) and its substate, empty when the server serves none. */
  phase: string
  substate: string
  /** The skill the task is in, null when the server serves none. */
  skill: Skill | null
  /** Whether the harness reports the task taken over by the operator. */
  interactive: boolean
}

/** A phase skill's machine: its states in order, the one held (null when none), and the next edge it declares (null when none). */
export type Skill = {
  name: string
  states: string[]
  current: string | null
  next: { kind: 'skill' | 'operation'; name: string } | null
}

/** What the band's stats footer counts over the session's main-agent turns: cost in USD, tokens and agent time. */
export type Stats = {
  turns: number
  cost: number
  last: number
  tokens: number
  output: number
  agentMs: number
  cacheRead: number
  inputAll: number
}

/** A column a task may move to: its state id and name. */
export type Move = { to: string; name: string }

/** A task the Board tab lists: what the band draws of a held task, plus its assignee and the columns it may move to. */
export type BoardTask = HeldTask & { assignee: string; moves: Move[] }

/** One open lane of the Board tab: its state id, name and tasks. */
export type Lane = { state: string; name: string; tasks: BoardTask[] }

declare module 'claude-code' {
  interface PluginState {
    'starpulse-board': {
      tasks: HeldTask[] | null
      openTask: string | null
      lanes: Lane[] | null
      folded: string[]
      expanded: string[]
      pickedTask: string | null
      stats: Stats
      isMini: boolean
    }
  }
}
