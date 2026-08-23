/** Capacitor drawn horizontally (two vertical plates), center at (x, y). */
export function Capacitor({ x, y, c }: { x: number; y: number; c: number }) {
  const gap = 6
  const plateH = 22
  const stroke = '#B9C4D6'
  return (
    <g>
      <line x1={x - gap / 2} y1={y - plateH / 2} x2={x - gap / 2} y2={y + plateH / 2} stroke={stroke} strokeWidth={2.5} />
      <line x1={x + gap / 2} y1={y - plateH / 2} x2={x + gap / 2} y2={y + plateH / 2} stroke={stroke} strokeWidth={2.5} />
      <text
        x={x}
        y={y - plateH / 2 - 6}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        C = {formatC(c)}
      </text>
    </g>
  )
}

function formatC(c: number): string {
  const uF = c * 1e6
  if (uF >= 1000) return `${(uF / 1000).toFixed(uF >= 10000 ? 0 : 1)} mF`
  return `${uF.toFixed(0)} µF`
}
