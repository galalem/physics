/** Capacitor (two parallel plates) drawn vertically, center at (x, y). */
export function Capacitor({ x, y, c, uC, e }: { x: number; y: number; c: number; uC: number; e: number }) {
  const plateGap = 8
  const plateW = 30
  const stroke = '#B9C4D6'
  // Charge fill on top plate proportional to uC/E
  const fillRatio = Math.max(0, Math.min(1, uC / e))
  return (
    <g>
      {/* Top plate (positive when charging) */}
      <line
        x1={x - plateW / 2}
        y1={y - plateGap / 2}
        x2={x + plateW / 2}
        y2={y - plateGap / 2}
        stroke={fillRatio > 0.02 ? '#37C9B8' : stroke}
        strokeWidth={3}
      />
      {/* Bottom plate */}
      <line
        x1={x - plateW / 2}
        y1={y + plateGap / 2}
        x2={x + plateW / 2}
        y2={y + plateGap / 2}
        stroke={stroke}
        strokeWidth={3}
      />
      {/* Charge indicator dots — up to 6, based on fillRatio */}
      {Array.from({ length: 6 }).map((_, i) => {
        const active = i < Math.round(fillRatio * 6)
        return (
          <circle
            key={i}
            cx={x - plateW / 2 + 4 + i * ((plateW - 8) / 5)}
            cy={y - plateGap / 2 - 6}
            r={1.8}
            fill={active ? '#37C9B8' : '#3A4863'}
          />
        )
      })}
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
  // c is in Farads
  if (c >= 1e-3) return `${(c * 1e3).toFixed(0)} mF`
  if (c >= 1e-6) return `${(c * 1e6).toFixed(0)} µF`
  if (c >= 1e-9) return `${(c * 1e9).toFixed(0)} nF`
  return `${c} F`
}
