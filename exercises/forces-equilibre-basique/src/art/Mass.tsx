// Mass — a small hanging block. { x, y } is the top-center attachment
// point (where the spring hooks in). The block hangs below it.

export function Mass({ x, y, size = 28, label }: { x: number; y: number; size?: number; label?: string }) {
  const half = size / 2
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Hook */}
      <line x1={0} y1={0} x2={0} y2={5} stroke="#8FA0BE" strokeWidth={1.6} />
      <circle cx={0} cy={0} r={2} fill="#8FA0BE" />
      {/* Block */}
      <rect
        x={-half}
        y={5}
        width={size}
        height={size}
        rx={2}
        fill="#2A3244"
        stroke="#F97316"
        strokeWidth={1.5}
      />
      {/* Face highlight */}
      <rect x={-half + 3} y={8} width={size - 6} height={3} fill="#3A4863" rx={1} />
      {label && (
        <text
          x={0}
          y={5 + half + 3}
          fill="#EAF0FA"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          fontWeight={700}
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  )
}
