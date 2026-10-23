import type { ClientModule } from 'claude-code'

/** What a desktop Board row draws from; `leanRow` in draw.ts builds it. */
type Row = {
  id: string
  idW: number
  k: number | null
  n: number
  color: string
  track: string
  ink: string
  muted: string
  pr: string
  prColor: string
}

const RATIO_W = 6
const PR_W = 8

const BoardRow: ClientModule<Row, true> = (row, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const open = () => surface.post({ task: row.id })
    surface.onPointer((ev) => ev.type === 'down' && open())
    surface.onKey((ev) => (ev.key === 'return' || ev.key === 'enter') && open())
    surface.setState(true)
  }
  const barW = Math.max(0, surface.columns - row.idW - RATIO_W - PR_W - 3)
  const segments = Math.max(1, row.n)
  const ratio = !row.n ? '' : row.k === null ? `${row.n} AC` : `${row.k}/${row.n}`
  return (
    <Box flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={1}>
      <Box flexShrink={0} width={row.idW}>
        <Text color={row.ink} wrap="truncate">{row.id}</Text>
      </Box>
      <Box key="bar" flexDirection="row" flexGrow={1} flexShrink={1} columnGap={barW >= 2 * segments - 1 ? 1 : 0} height={1}>
        {Array.from({ length: segments }, (_, i) => (
          <Box key={`seg-${i}`} flexGrow={1} height={1} backgroundColor={row.k !== null && i < row.k ? row.color : row.track} />
        ))}
      </Box>
      <Box flexShrink={0} width={RATIO_W}>
        <Text color={row.muted} wrap="truncate">{ratio}</Text>
      </Box>
      <Box flexShrink={0} width={PR_W} flexDirection="row">
        {row.pr ? <Text color={row.prColor} wrap="truncate">●</Text> : null}
        {row.pr ? <Text color={row.muted} wrap="truncate">{` ${row.pr}`}</Text> : null}
      </Box>
    </Box>
  )
}

export default BoardRow
