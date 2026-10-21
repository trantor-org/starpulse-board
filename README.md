# starpulse-board

A Claude Code mod that draws the Board tasks a session holds above the prompt, a Board pane (`/kanban`) of every open
lane, a single-task pane, and `/board`. It runs in the terminal and in Claude Desktop.

```
/plugin marketplace add trantor-org/starpulse-board
/plugin install starpulse-board@starpulse-board
```

The StarPulse CLI reference (`docs/cli.md` in [trantor-org/starpulse](https://github.com/trantor-org/starpulse))
documents the band and the Board pane.

## Board mod

At session start the Board tab opens in the dock without taking the keys. On the terminal it draws cells, with the
`glyphs` option (`nerd`, default, or `plain`) choosing the icons. On Desktop it draws a text header, a Current task card for
the task this session holds (its lane, criteria, progress bar and pull request), then one lean Svg row per task on a
navy root, with native buttons (the task ID, lane fold arrows, Start session, Move to ...) and no icon font or key hints.

Above the prompt an always-on band draws the held task: its lane, ID, title and bar, the delivery phases and substates
the board serves, the pull request's checks, threads and freshness, and the session's cost, turns and tokens. On Desktop
its head row carries two native controls over the drawing: the pull request number as a link to the PR and a fold arrow
that collapses the band to its head row. The band draws only the phases the task has reached; the running step's orb
pulses and a link streams into it, under no-preference motion only. A task the board reports no phase for says so
rather than guessing one. With no held task it stays on and says so; it has no hide button.

## Themes

On the terminal the Board pane fills its body navy. The dock's tab strip, left border and bottom row are Claude Code's
`composerSidebarBackground` (grey in the dark theme), which no pane draws. The Board mod ships the theme
`themes/navy.json`, the dark theme with that key, message backgrounds, text and accents in the StarPulse navy palette,
and `themes/black-dock.json`, the dark theme with that key black. Select one with
`"theme": "custom:starpulse-board:navy"` (or `:black-dock`) in `~/.claude/settings.json`.
