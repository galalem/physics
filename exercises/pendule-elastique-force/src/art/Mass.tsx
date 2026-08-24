/** Rectangular sliding mass. (cx, cy) is the block's center. */
export function Mass({ cx, cy, w = 46, h = 46, m }: { cx: number; cy: number; w?: number; h?: number; m: number }) {
  return (
    <g>
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={4}
        fill="#1B2941"
        stroke="#B9C4D6"
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={cy + 4}
        fill="#B9C4D6"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={13}
        fontWeight={600}
        textAnchor="middle"
      >
        m
      </text>
      <text
        x={cx}
        y={cy + h / 2 + 14}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        {m} kg
      </text>
    </g>
  )
}
