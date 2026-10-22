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

/**
 * A desktop Board row on one line as wide as its region: the ID, a flat bar of the criteria done in the lane's colour
 * over a grey track, the k/n ratio, and the PR's checks dot and number. A press or Enter anywhere on it opens the card.
 */
const BoardRow: ClientModule<Row, true> = (row, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const open = () => surface.post({ task: row.id })
    surface.onPointer((ev) => ev.type === 'down' && open())
    surface.onKey((ev) => (ev.key === 'return' || ev.key === 'enter') && open())
    surface.setState(true)
  }
  const barW = Math.max(0, surface.columns - row.idW - RATIO_W - PR_W - 2)
  const fill = !row.n || row.k === null ? 0 : Math.round((barW * row.k) / row.n)
  const ratio = !row.n ? '' : row.k === null ? `${row.n} AC` : `${row.k}/${row.n}`

  return (
    <Box flexDirection="row">
      <Text color={row.ink}>{row.id.padEnd(row.idW)} </Text>
      {fill > 0 && <Text color={row.color}>{'━'.repeat(fill)}</Text>}
      {barW > fill && <Text color={row.track}>{'━'.repeat(barW - fill)}</Text>}
      <Text color={row.muted}>{` ${ratio}`.padEnd(RATIO_W + 1)}</Text>
      {row.pr ? (
        <Box flexDirection="row">
          <Text color={row.prColor}>● </Text>
          <Text color={row.muted}>{row.pr.padEnd(PR_W - 2)}</Text>
        </Box>
      ) : (
        <Text>{' '.repeat(PR_W)}</Text>
      )}
    </Box>
  )
}

export default BoardRow
