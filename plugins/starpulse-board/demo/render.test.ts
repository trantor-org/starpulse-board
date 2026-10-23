import { expect, test } from 'claude-code/testing'
import { CELL_H, CELL_W, page, renderTree } from './render'

const text = (children: string[], props: object = {}) => ({ type: 'Text', props, children })
const box = (props: object, children: unknown[] = [], extra: object = {}) => ({ type: 'Box', props, children, ...extra })

test('a row Box maps flex, gap and padding to CSS, counting numbers in cells', () => {
  const { html } = renderTree(box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, paddingX: 2, paddingY: 1, flexGrow: 1, flexShrink: 0 }))

  expect(html).toContain('flex-direction:row')
  expect(html).toContain('align-items:center')
  expect(html).toContain(`column-gap:${CELL_W}px`)
  expect(html).toContain(`padding:${CELL_H}px ${2 * CELL_W}px`)
  expect(html).toContain('flex-grow:1')
  expect(html).toContain('flex-shrink:0')
})

test('width and height count cells; a gap on a column counts lines and a token maps to the spacing scale', () => {
  const { html } = renderTree(box({ flexDirection: 'column', gap: 1, width: 9, height: 1 }, [box({ gap: 'xs' })]))

  expect(html).toContain(`width:${9 * CELL_W}px`)
  expect(html).toContain(`height:${CELL_H}px`)
  expect(html).toContain(`gap:${CELL_H}px`)
  expect(html).toContain('gap:var(--sp-xs)')
})

test('Text maps colour, weight and size, and truncate cuts with an ellipsis on one line', () => {
  const { html } = renderTree(text(['TASK-7'], { color: '#fbbf24', bold: true, wrap: 'truncate', size: 'caption', mono: true }))

  expect(html).toContain('color:#fbbf24')
  expect(html).toContain('font-weight:600')
  expect(html).toContain('text-overflow:ellipsis')
  expect(html).toContain('white-space:nowrap')
  expect(html).toContain('font-size:var(--fs-caption)')
  expect(html).toContain('font-family:var(--mono)')
  expect(html).toContain('>TASK-7<')
})

test('a Box background becomes a CSS background, and a rounded border a border with a radius', () => {
  const { html } = renderTree(box({ backgroundColor: '#353839', borderStyle: 'round', borderColor: '#d4d2c82e' }))

  expect(html).toContain('background:#353839')
  expect(html).toContain('border:1px solid #d4d2c82e')
  expect(html).toContain('border-radius:')
})

test('hover becomes a :hover rule on the element, not an inline style', () => {
  const { html, css } = renderTree(box({ paddingY: 1 }, [], { hover: { backgroundColor: '#d4d2c81f' } }))
  const cls = /class="(h\d+)"/.exec(html)?.[1]

  expect(cls, 'the element carries a hover class').toBeDefined()
  expect(css).toContain(`.${cls}:hover{background:#d4d2c81f}`)
})

test('two trees on one page never share a hover class', () => {
  const hover = (backgroundColor: string) => renderTree(box({}, [], { hover: { backgroundColor } }))
  const [first, second] = [hover('red'), hover('blue')]
  const cls = (html: string) => /class="(h\d+)"/.exec(html)?.[1]

  expect(cls(first.html)).not.toBe(cls(second.html))
})

test('text is escaped', () => {
  const { html } = renderTree(text(['<script>alert(1)</script> & "q"']))

  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('&amp;')
})

test('a Client is replaced by the tree the host drew for it, keeping its own grow', () => {
  const drawn = box({ flexDirection: 'row' }, [text(['TASK-7'])])
  const { html } = renderTree(box({}, [{ type: 'Client', props: { key: 'task:TASK-7', flexGrow: 1 } }]), { drawClient: () => drawn })

  expect(html).toContain('>TASK-7<')
  expect(html).toContain('flex-grow:1')
})

test('a Client the host cannot draw says so instead of vanishing', () => {
  const { html, unmapped } = renderTree({ type: 'Client', props: { key: 'task:TASK-7' } })

  expect(html).toContain('task:TASK-7')
  expect(unmapped).toContain('Client task:TASK-7 not drawn')
})

test('a Button draws its label and an Svg its source at its size', () => {
  const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
  const { html } = renderTree(box({}, [{ type: 'Button', props: { label: 'Start session' } }, { type: 'Svg', props: { source: svg, width: 804, height: 34 } }]))

  expect(html).toContain('<button')
  expect(html).toContain('Start session')
  expect(html).toContain(svg)
  expect(html).toContain('width:804px')
  expect(html).toContain('height:34px')
})

test('a Link draws as an anchor, and only an http(s) href becomes one', () => {
  const link = (href: string) => ({ type: 'Link', props: { href, label: 'PR #7' } })
  const { html } = renderTree(box({}, [link('https://github.com/o/r/pull/7'), link('javascript:alert(1)')]))

  expect(html).toContain('<a href="https://github.com/o/r/pull/7" target="_blank" rel="noopener">PR #7</a>')
  expect(html).not.toContain('javascript:')
})

test('a prop the renderer does not map is reported, not dropped silently', () => {
  const { unmapped } = renderTree(box({ flexDirection: 'row', zIndex: 3 }, [text(['x'], { blink: true })]))

  expect(unmapped).toEqual(['Box.zIndex', 'Text.blink'])
})

test('the page lists each section under its heading at its pane width and carries the styles', () => {
  const tree = renderTree(box({}, [text(['hello'])], { hover: { backgroundColor: 'red' } }))
  const html = page({ title: 'Demo', sections: [{ heading: 'Wide pane', columns: 80, tree }, { heading: 'Narrow pane', columns: 40, tree }] })

  expect(html).toContain('<title>Demo</title>')
  expect(html).toContain('<h2>Wide pane · 80 columns</h2>')
  expect(html).toContain(`width:${40 * CELL_W}px`)
  expect(html).toContain(':hover{background:red}')
})
