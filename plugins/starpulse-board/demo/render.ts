// Draws the element tree a desktop mount returns as static HTML, so a change to the Board pane or the band can be
// reviewed in a browser. It maps the Box, Text, Button and Svg props the plugin draws to CSS and is only as faithful as
// that mapping: a prop it does not map is returned in `unmapped`, and the README lists the known gaps.

export type El = {
  type: string
  props?: Record<string, any>
  hover?: Record<string, any>
  children?: (El | string)[]
}

export type Tree = { html: string; css: string; unmapped: string[] }

type Options = { drawClient?: (el: El) => El | undefined }

/** A terminal cell in pixels: numeric widths, gaps and paddings count cells across and lines down. */
export const CELL_W = 8
export const CELL_H = 20

const SPACING = new Set(['xs', 'sm', 'md', 'lg', 'xl'])
const SIZES = new Set(['caption', 'footnote', 'body', 'title'])
const WEIGHTS: Record<string, number> = { regular: 400, medium: 500, semibold: 600, bold: 700 }
const SAFE_VALUE = /^[#\w(),.%\s-]+$/

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

// What each element type reads; a prop outside its list is reported.
const KNOWN: Record<string, string[]> = {
  Box: ['key', 'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap', 'alignItems', 'justifyContent', 'gap', 'columnGap', 'rowGap', 'padding', 'paddingX', 'paddingY', 'width', 'height', 'backgroundColor', 'borderStyle', 'borderColor', 'overflow'],
  Text: ['key', 'color', 'bold', 'weight', 'size', 'mono', 'tabular', 'wrap'],
  Button: ['key', 'label', 'plain'],
  Svg: ['key', 'source', 'width', 'height', 'alt', 'isInteractive'],
  Client: ['key', 'module', 'props', 'flexGrow', 'flexShrink'],
  Link: ['key', 'href', 'label'],
}

const px = (n: number) => `${n}px`

// A number counts cells (`cell` pixels each); a token names the spacing scale.
const space = (v: unknown, cell: number) => (typeof v === 'number' ? px(v * cell) : SPACING.has(String(v)) ? `var(--sp-${v})` : undefined)

const colour = (v: unknown) => (typeof v === 'string' && SAFE_VALUE.test(v) ? v : undefined)

type Style = [string, string | undefined][]

const boxStyle = (p: Record<string, any>): Style => {
  const column = p.flexDirection === 'column' || p.flexDirection === 'column-reverse'
  const padX = space(p.paddingX ?? p.padding, CELL_W)
  const padY = space(p.paddingY ?? p.padding, CELL_H)
  return [
    ['display', 'flex'],
    ['flex-direction', p.flexDirection ?? 'row'],
    ['flex-grow', p.flexGrow === undefined ? undefined : String(p.flexGrow)],
    ['flex-shrink', p.flexShrink === undefined ? undefined : String(p.flexShrink)],
    ['flex-wrap', p.flexWrap],
    ['align-items', p.alignItems],
    ['justify-content', p.justifyContent],
    ['gap', space(p.gap, column ? CELL_H : CELL_W)],
    ['column-gap', space(p.columnGap, CELL_W)],
    ['row-gap', space(p.rowGap, CELL_H)],
    ['padding', padX || padY ? `${padY ?? '0'} ${padX ?? '0'}` : undefined],
    ['width', space(p.width, CELL_W)],
    ['height', space(p.height, CELL_H)],
    ['background', colour(p.backgroundColor)],
    ['border', p.borderStyle ? `1px solid ${colour(p.borderColor) ?? 'currentcolor'}` : undefined],
    ['border-radius', p.borderStyle === 'round' ? '6px' : undefined],
    ['overflow', p.overflow],
    ['min-width', '0'],
  ]
}

const textStyle = (p: Record<string, any>): Style => {
  const truncate = /^truncate/.test(String(p.wrap ?? ''))
  return [
    ['color', colour(p.color)],
    ['font-weight', p.weight in WEIGHTS ? String(WEIGHTS[p.weight]) : p.bold ? '600' : undefined],
    ['font-size', SIZES.has(p.size) ? `var(--fs-${p.size})` : undefined],
    ['font-family', p.mono ? 'var(--mono)' : undefined],
    ['font-variant-numeric', p.tabular ? 'tabular-nums' : undefined],
    ['overflow', truncate ? 'hidden' : undefined],
    ['text-overflow', truncate ? 'ellipsis' : undefined],
    ['white-space', truncate ? 'nowrap' : undefined],
    ['min-width', truncate ? '0' : undefined],
  ]
}

// The few props a hover can change, as the declarations they set.
const hoverStyle = (h: Record<string, any>): Style => [
  ['background', colour(h.backgroundColor)],
  ['border-color', colour(h.borderColor)],
  ['color', colour(h.color)],
]

const decls = (style: Style) => style.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}:${v}`).join(';')

// Counts across trees: the trees of one page share its stylesheet, so a class name may never repeat.
let hovers = 0

/** Renders `root` to HTML and the stylesheet its hover rules need. */
export const renderTree = (root: El | string, options: Options = {}): Tree => {
  const css: string[] = []
  const unmapped: string[] = []

  const report = (type: string, props: Record<string, any>) => {
    for (const name of Object.keys(props)) {
      const entry = `${type}.${name}`
      if (!KNOWN[type]?.includes(name) && !unmapped.includes(entry)) unmapped.push(entry)
    }
  }

  const draw = (node: El | string): string => {
    if (typeof node === 'string') return esc(node)
    const props = node.props ?? {}
    const kids = () => (node.children ?? []).map(draw).join('')
    report(node.type, props)

    if (node.type === 'Box') {
      let cls = ''
      if (node.hover) {
        const name = `h${++hovers}`
        css.push(`.${name}:hover{${decls(hoverStyle(node.hover))}}`)
        cls = ` class="${name}"`
      }
      return `<div${cls} style="${decls(boxStyle(props))}">${kids()}</div>`
    }
    if (node.type === 'Text') return `<span style="${decls(textStyle(props))}">${kids()}</span>`
    if (node.type === 'Button') return `<button type="button" class="${props.plain ? 'plain' : 'btn'}">${esc(String(props.label ?? ''))}</button>`
    if (node.type === 'Link') {
      const label = esc(String(props.label ?? ''))
      const href = String(props.href ?? '')
      return /^https?:\/\//.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : `<span>${label}</span>`
    }
    if (node.type === 'Svg') {
      const size = decls([['width', typeof props.width === 'number' ? px(props.width) : undefined], ['height', typeof props.height === 'number' ? px(props.height) : undefined]])
      return `<div class="svg" style="${size}">${props.source ?? ''}</div>`
    }
    if (node.type === 'Client') {
      const drawn = options.drawClient?.(node)
      const grow = decls([['flex-grow', props.flexGrow === undefined ? undefined : String(props.flexGrow)], ['flex-shrink', props.flexShrink === undefined ? undefined : String(props.flexShrink)]])
      if (drawn) return `<div style="display:flex;flex-direction:column;min-width:0;${grow}">${draw(drawn)}</div>`
      unmapped.push(`Client ${props.key} not drawn`)
      return `<div class="undrawn" style="${grow}">${esc(String(props.key))} (not drawn)</div>`
    }
    unmapped.push(`${node.type} not mapped`)
    return kids()
  }

  return { html: draw(root), css: css.join('\n'), unmapped }
}

type Section = { heading: string; columns: number; note?: string; tree: Tree }

const STYLES = `
:root{--sp-xs:4px;--sp-sm:8px;--sp-md:12px;--sp-lg:16px;--sp-xl:24px;--fs-caption:11px;--fs-footnote:12px;--fs-body:13px;--fs-title:15px;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
body{margin:0;padding:24px 16px;background:#1a1a19;color:#d4d2c8;font:13px/${CELL_H}px system-ui,sans-serif}
h1{font-size:18px;margin:0 0 8px}h2{font-size:14px;margin:32px 0 4px;color:#94a3b8}
p{margin:0 0 8px;color:#6b7a93;max-width:72ch}
.pane{background:#262624;border:1px solid #3a3a37;border-radius:8px;padding:8px 0;box-sizing:content-box;max-width:100%;overflow-x:auto}
.pane>div{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer}
button.plain{background:none;border:0;padding:0}
button.btn{background:#353839;border:1px solid #4a4d4f;border-radius:6px;padding:2px 8px}
.svg>svg{width:100%;height:100%;display:block}
.undrawn{color:#f87171}
.gaps{margin-top:32px;font-size:12px}
`

/** The demo page: each section's tree in a frame as wide as its pane, then every prop the renderer left unmapped. */
export const page = ({ title, sections }: { title: string; sections: Section[] }): string => {
  const hoverCss = sections.map(s => s.tree.css).filter(Boolean).join('\n')
  const unmapped = [...new Set(sections.flatMap(s => s.tree.unmapped))]
  const body = sections
    .map(s => `<h2>${esc(s.heading)} · ${s.columns} columns</h2>${s.note ? `<p>${esc(s.note)}</p>` : ''}<div class="pane" style="width:${s.columns * CELL_W}px">${s.tree.html}</div>`)
    .join('\n')
  const gaps = unmapped.length ? `<div class="gaps"><h2>Not drawn by this renderer</h2><p>${unmapped.map(esc).join(', ')}</p></div>` : ''
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLES}${hoverCss}</style></head><body><h1>${esc(title)}</h1>\n${body}\n${gaps}</body></html>\n`
}
