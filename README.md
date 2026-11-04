# starpulse-board

A Claude Code mod that draws the StarPulse band for the Board task a session holds above the prompt, and `/board`. It
runs in the terminal and in Claude Desktop, and opens no pane: the band is the whole mod.

```
/plugin marketplace add trantor-org/starpulse-board
/plugin install starpulse-board@starpulse-board
```

The StarPulse CLI reference (`docs/cli.md` in [trantor-org/starpulse](https://github.com/trantor-org/starpulse))
documents the band.

## The band

Above the prompt an always-on band draws the held task: its lane, ID, title and a bar with one segment per criterion, the delivery phases and substates
the board serves, the pull request's checks, threads and freshness, and the session's cost, turns and tokens. On Desktop
its head row carries two native controls over the drawing: the pull request number as a link to the PR and a fold arrow
that collapses the band to its head row. The band draws only the phases the task has reached; the running step's orb
pulses and a link streams into it, under no-preference motion only. A task the board reports no phase for says so
rather than guessing one. With no held task it stays on and says so; it has no hide button.

The terminal draws the same band in cells, its facts in the same order: a head line with the lane icon, ID, title, an
eighth-block AC bar and k/n, the lane, `[Make interactive]` or `driving`, the PR's checks icon and number as a link, and
the fold arrow; then the delivery phases and the current phase's substates (`●` done, `◉` running, `○` not reached, in
the same colours), the skill row, the PR's facts and tests, and the stats. Folded, the head line carries the tests,
cost and turns. The `glyphs` option (`nerd`, default, or `plain`) chooses the lane and checks icons.

When the board serves the task's active skill, a blue row under the phases draws that skill's own machine: its states
in order (done, the current one pulsing, the rest dim) and, only when the machine declares a next edge, a solid arrow to
a ring (next skill) or a square (next operation). The row takes the failure colour on Needs attention and the hold
colour on Waiting. It is drawn attended or not, and none is drawn when the board serves no skill. Its colours are the
tokens `SP.skill` (`#3b82f6`, Tailwind blue-500) and `SP.skillText` (`#60a5fa`, blue-400) in `hooks/draw.ts`, distinct
from the green and amber execution machines. The head row's tools carry a native **Make interactive** button, which
posts `{"task": "TASK-N"}` to StarPulse's `/api/take-over`; a refusal (no running workflow, no Temporal, or StarPulse
unreachable) is toasted with its reason. Once the board reports the task `interactive`, the button gives way to the text
`driving`. The approved design, mockup and screenshots are under `design/task-7308/`.

## Demo

A public page draws the band on Desktop and in the terminal at 100 columns, so a change to it can be reviewed
without installing an unmerged build: <https://trantor-org.github.io/starpulse-board/main/> is the current `main`. Every
pull request publishes its own page and links it in its description under `## Demo`; closing the pull request
unpublishes it (`.github/workflows/demo.yml`, served from the `gh-pages` branch).

The page is built by `plugins/starpulse-board/demo/demo.test.ts`. It mounts the real `AbovePrompt` with
`$.ui.mount` on the `desktop` and `terminal` surfaces, fed a held demo task, then the Desktop band in each
state the operator approves (unattended, interactive, deliver, no-next, attention, waiting, unreported, gone and empty)
at 100, 125 and 150 percent. `demo/render.ts` turns
the element tree it gets back into HTML and CSS. The testing kit offers no HTML or screenshot renderer, so the test
prints the page between `PAGE_START` and `PAGE_END` and the workflow cuts it out of the `claude plugin test` output.

### Fidelity gaps

The page is only as faithful as `demo/render.ts`'s mapping of the tree to CSS. It is a review aid, never a screenshot of
Claude Desktop. Known differences:

- **Units are guesses.** Numeric widths, gaps and paddings count terminal cells of 8 by 20 px; Desktop's real cell is not
  published. The spacing tokens (`xs` to `xl`) are 4, 8, 12, 16 and 24 px and the text sizes (`caption` to `title`) 11 to
  15 px.
- **Fonts.** Text is `system-ui`, and `mono` text `ui-monospace`; Desktop and the terminal use their own faces, and a
  browser without a Nerd Font draws the terminal band's icons as boxes.
- **Hover** maps only background, border colour and text colour. Focus rings, pressed states and cursor changes are not
  drawn.
- **Native controls.** Make interactive and the fold arrow are plain HTML buttons, drawn with their labels; Desktop draws
  native ones, and the terminal draws the button's own text.
- **Motion.** The band's SVG brings its own animation (the orb pulse, the streaming link), and the browser plays it
  under no-preference motion as Desktop does; the page adds none. The SVG is inlined, so its `<style>` rules apply to the
  whole page, which Desktop's image drawing does not do.
- **Colour scheme.** The page is dark whatever the Desktop theme; the plugin's own colours are used as given.
- **Data.** The task is invented, and the band's cost, turns and tokens read zero.

A prop the mapping does not know is listed at the foot of the page under "Not drawn by this renderer", and the demo test
fails when an element cannot be drawn.

## Themes

The mod ships the theme `themes/navy.json`, the dark theme with message backgrounds, text and accents in the StarPulse navy palette,
and `themes/black-dock.json`, the dark theme with the dock's `composerSidebarBackground` black. Select one with
`"theme": "custom:starpulse-board:navy"` (or `:black-dock`) in `~/.claude/settings.json`.
