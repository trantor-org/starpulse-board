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
`glyphs` option (`nerd`, default, or `plain`) choosing the icons. On Desktop it draws a text header, a THIS SESSION lane
holding the task this session holds, then the board's lanes, each task one line (its ID, a bar with one segment per criterion, the met ones filled,
k/n, and the pull request with its checks dot) that opens the task's card from a press anywhere on it; lane fold
arrows, Start session and Move to ... stay native buttons, with no icon font or key hints.

Above the prompt an always-on band draws the held task: its lane, ID, title and a bar with one segment per criterion, the delivery phases and substates
the board serves, the pull request's checks, threads and freshness, and the session's cost, turns and tokens. On Desktop
its head row carries two native controls over the drawing: the pull request number as a link to the PR and a fold arrow
that collapses the band to its head row. The band draws only the phases the task has reached; the running step's orb
pulses and a link streams into it, under no-preference motion only. A task the board reports no phase for says so
rather than guessing one. With no held task it stays on and says so; it has no hide button.

## Demo

A public page draws the Desktop Board pane at 40 and 100 columns and the band, so a change to either can be reviewed
without installing an unmerged build: <https://trantor-org.github.io/starpulse-board/main/> is the current `main`. Every
pull request publishes its own page and links it in its description under `## Demo`; closing the pull request
unpublishes it (`.github/workflows/demo.yml`, served from the `gh-pages` branch).

The page is built by `plugins/starpulse-board/demo/demo.test.ts`. It mounts the real `Pane` and `AbovePrompt` with
`$.ui.mount` on the `desktop` surface, fed demo tasks that cover 0/n, partial, full and unknown criterion progress, a
task with and without a pull request in each check state, a long id, a held task and every lane. `demo/render.ts` turns
the element tree it gets back into HTML and CSS. The testing kit offers no HTML or screenshot renderer, so the test
prints the page between `PAGE_START` and `PAGE_END` and the workflow cuts it out of the `claude plugin test` output.

### Fidelity gaps

The page is only as faithful as `demo/render.ts`'s mapping of the tree to CSS. It is a review aid, never a screenshot of
Claude Desktop. Known differences:

- **Units are guesses.** Numeric widths, gaps and paddings count terminal cells of 8 by 20 px; Desktop's real cell is not
  published. The spacing tokens (`xs` to `xl`) are 4, 8, 12, 16 and 24 px and the text sizes (`caption` to `title`) 11 to
  15 px.
- **Row width.** A row is drawn at the pane's columns minus 4 for the lane's border and padding. Desktop sizes it by its
  own layout.
- **Fonts.** Text is `system-ui`, and `mono` text `ui-monospace`; Desktop uses its own faces.
- **Hover** maps only background, border colour and text colour. Focus rings, pressed states and cursor changes are not
  drawn.
- **Native controls.** Lane fold arrows, Start session and Move to ... are plain HTML buttons; Desktop draws native ones.
  The dock's tab strip and frame around the pane are not drawn, and a pane that overflows is not scrolled.
- **Motion.** The band's SVG brings its own animation (the orb pulse, the streaming link), and the browser plays it
  under no-preference motion as Desktop does; the page adds none. The SVG is inlined, so its `<style>` rules apply to the
  whole page, which Desktop's image drawing does not do.
- **Colour scheme.** The page is dark whatever the Desktop theme; the plugin's own colours are used as given.
- **Desktop's own colours.** Desktop draws the pane body `#2a2a2a`; the page uses `#1a1a19` around a `#262624` pane. In
  the status bars Desktop shows a filled segment `#ffd145` (page `#fbbf24`), an empty one `#3f4243` (page `#353839`) and
  a review one `#b099ff` (page `#a78bfa`). Desktop also draws its own "Board" title bar with expand and close buttons
  above the body, at every width.
- **Width.** The demo draws 40 and 100 columns (320 and 800 px). A wide Desktop pane measured about 151 columns
  (1211 px); a narrow one about 41 columns (328 px). Bars shrink with a narrow pane in both, and lane structure, counts,
  PR dots and "Show N more" match.
- **Data.** The tasks are invented. The band reports no delivery phase, and its cost, turns and tokens read zero.

A prop the mapping does not know is listed at the foot of the page under "Not drawn by this renderer", and the demo test
fails when a row cannot be drawn.

On the terminal the Board pane fills its body navy. The dock's tab strip, left border and bottom row are Claude Code's
`composerSidebarBackground` (grey in the dark theme), which no pane draws. The Board mod ships the theme
`themes/navy.json`, the dark theme with that key, message backgrounds, text and accents in the StarPulse navy palette,
and `themes/black-dock.json`, the dark theme with that key black. Select one with
`"theme": "custom:starpulse-board:navy"` (or `:black-dock`) in `~/.claude/settings.json`.
