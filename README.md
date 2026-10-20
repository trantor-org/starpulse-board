# starpulse-board

Two Claude Code mods in one marketplace, installed independently:

| Mod | What it draws | Surfaces |
| --- | --- | --- |
| `starpulse-board` | The Board tasks a session holds above the prompt, the Board pane (`/kanban`) of every open lane, a single-task pane, `/board` | terminal and Claude Desktop |
| `starpulse-sessions` | The Sessions pane (`/sessions`): every session on the host, click to switch to its tmux session, archive and resume | terminal only (it needs tmux) |

```
/plugin marketplace add trantor-org/starpulse-board
/plugin install starpulse-board@starpulse-board
/plugin install starpulse-sessions@starpulse-board
```

Claude Desktop enables only `starpulse-board`. The StarPulse CLI reference (`docs/cli.md` in
[trantor-org/starpulse](https://github.com/trantor-org/starpulse)) documents the band and the Board pane.

Each mod is a folder under `plugins/` and ships as a copy of itself, so `hooks/starpulse.ts` (the `starpulse board` reader,
the event-stream follower and the Board types) exists in both: keep the two files identical.

## Board mod

At session start the Board tab opens in the dock without taking the keys. On the terminal it draws cells, with the
`glyphs` option (`nerd`, default, or `plain`) choosing the icons. On Desktop it draws Svg cards for each task and lane
header, native buttons (Details, Expand/Collapse, Refresh, Start session, Move to ...), no icon font, no key hints, and
the page's own background (each card carries its own dark surface, so it reads on a light or a dark theme).

## Sessions mod

Lists the Claude Code sessions in `~/.claude/sessions/` it can switch to in two groups, Active and Archived (Archived
folded by default; each header folds). Active holds working and idle sessions together, told apart by the status icon
(`●` working, `○` idle). A live session is listed only when it runs in a tmux pane, plus this session; a background or
desktop session has none, so it is left out. A row shows the status icon, name, a `you` marker on this session, the held
task as a lane-coloured chip, the age and an archive icon.

| Key | Action |
| --- | --- |
| `n` | New session: a tmux session `claude-NNNNNN` running `claude` in the workspace, switched to |
| `f` | Focus the filter: text over name, tmux session and task |
| `a` | Archive the row focused with ↑↓ |
| chips | working, idle, archived; toggle, several combine as OR, and with the text as AND |

Archive kills the row's tmux session and moves the row to Archived. When the row is this session, a fresh tmux
session is created and switched to first; if that fails the session is kept and a toast says so.

Archived rows persist in `$.store` as `{ sessionId, name, cwd, task, archivedAt }`. Pressing one, or `a` on it, runs
`claude --resume <sessionId>` in a new tmux session at the recorded `cwd`.

A Remote Control session archived in claude.ai shows in Archived too: its registry record has lost `bridgeSessionId`
while its transcript holds a `bridge-session` row. Its process still runs, so pressing it switches to its tmux session
and `a` archives it here.

Options: `glyphs` is `nerd` (default) or `plain`.

## Black dock

On the terminal both panes fill their body black. The dock's tab strip, left border and bottom row are Claude Code's
`composerSidebarBackground` (grey in the dark theme), which no pane draws. The Board mod ships the theme
`themes/black-dock.json`, the dark theme with that key black; select it with
`"theme": "custom:starpulse-board:black-dock"` in `~/.claude/settings.json`.
