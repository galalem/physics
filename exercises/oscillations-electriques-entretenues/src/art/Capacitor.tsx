/** Capacitor (two parallel plates) drawn vertically, center at (x, y). Wires enter top and bottom. */
export function Capacitor({ x, y, c, uC, uSat }: { x: number; y: number; c: number; uC: number; uSat: number }) {
  const plateGap = 8
  const plateW = 30
  const stroke = '#B9C4D6'
  const fillRatio = Math.max(-1, Math.min(1, uC / uSat))
  const topActive = fillRatio > 0.05
  const bottomActive = fillRatio < -0.05
  return (
    <g>
      {/* Top plate */}
      <line
        x1={x - plateW / 2}
        y1={y - plateGap / 2}
        x2={x + plateW / 2}
        y2={y - plateGap / 2}
        stroke={topActive ? '#37C9B8' : stroke}
        strokeWidth={3}
      />
      {/* Bottom plate */}
      <line
        x1={x - plateW / 2}
        y1={y + plateGap / 2}
        x2={x + plateW / 2}
        y2={y + plateGap / 2}
        stroke={bottomActive ? '#37C9B8' : stroke}
        strokeWidth={3}
      />
      <text
        x={x + plateW / 2 + 8}
        y={y + 3}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
      >
        C = {formatC(c)}
      </text>
    </g>
  )
}

function formatC(c: number): string {
  if (c >= 1e-3) return `${(c * 1e3).toFixed(0)} mF`
  if (c >= 1e-6) return `${(c * 1e6).toFixed(0)} µF`
  return `${(c * 1e9).toFixed(0)} nF`
}
