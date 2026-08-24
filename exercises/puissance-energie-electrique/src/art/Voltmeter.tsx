/**
 * Voltmeter drawn as a parallel branch across a vertical resistor.
 * Pickup points sit at (resistorX, topY) and (resistorX, botY).
 * The V bubble sits to the left at (bubbleX, bubbleY).
 */
export function VoltmeterBubble({
  resistorX,
  topY,
  botY,
  bubbleX,
  bubbleY,
  reading,
  hidden,
}: {
  resistorX: number
  topY: number
  botY: number
  bubbleX: number
  bubbleY: number
  reading: string
  hidden: boolean
}) {
  const active = !hidden && reading !== ''
  return (
    <g>
      {/* Dashed parallel-branch wires: horizontal stubs at top/bot, then vertical down to bubble */}
      <line x1={resistorX} y1={topY} x2={bubbleX} y2={topY} stroke="#3A4863" strokeWidth={1.5} strokeDasharray="3 3" />
      <line x1={resistorX} y1={botY} x2={bubbleX} y2={botY} stroke="#3A4863" strokeWidth={1.5} strokeDasharray="3 3" />
      <line x1={bubbleX} y1={topY} x2={bubbleX} y2={bubbleY - 13} stroke="#3A4863" strokeWidth={1.5} strokeDasharray="3 3" />
      <line x1={bubbleX} y1={bubbleY + 13} x2={bubbleX} y2={botY} stroke="#3A4863" strokeWidth={1.5} strokeDasharray="3 3" />
      {/* Junction dots on the resistor's terminals */}
      <circle cx={resistorX} cy={topY} r={2.5} fill="#B9C4D6" />
      <circle cx={resistorX} cy={botY} r={2.5} fill="#B9C4D6" />
      {/* V circle */}
      <circle cx={bubbleX} cy={bubbleY} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.2} />
      <text x={bubbleX} y={bubbleY + 4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>V</text>
      {/* Reading — placed to the LEFT of the V circle so it doesn't clip the top wire */}
      <text
        x={bubbleX - 20}
        y={bubbleY + 4}
        fill={active ? '#37C9B8' : '#6C7A93'}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="end"
      >
        {hidden ? '?' : reading}
      </text>
    </g>
  )
}
