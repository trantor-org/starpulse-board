/** What a pull request's checks roll up to; `none` when it has no required checks yet. */
export type Checks = 'pass' | 'pending' | 'fail' | 'none'

/** The pull request a task cites: its repository, number and checks. */
export type Pull = { repo: string; number: number; checks: Checks }

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
      isHidden: boolean
      openTask: string | null
      lanes: Lane[] | null
      folded: string[]
      pickedTask: string | null
    }
  }
}
