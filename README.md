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
`glyphs` option (`nerd`, default, or `plain`) choosing the icons. On Desktop it draws Svg cards for each task and lane
header, native buttons (Details, Expand/Collapse, Refresh, Start session, Move to ...), no icon font, no key hints, and
the page's own background (each card carries its own dark surface, so it reads on a light or a dark theme).

## Black dock

On the terminal the Board pane fills their body black. The dock's tab strip, left border and bottom row are Claude Code's
`composerSidebarBackground` (grey in the dark theme), which no pane draws. The Board mod ships the theme
`themes/black-dock.json`, the dark theme with that key black; select it with
`"theme": "custom:starpulse-board:black-dock"` in `~/.claude/settings.json`.
