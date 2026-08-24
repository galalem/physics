// Block — wooden crate sitting on the horizontal ground.
// { x, y } = center-bottom on the ground line.
// `size` scales the crate — used to hint at mass visually (bigger m => bigger crate).

export function Block({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  const w = 28 * size
  const h = 22 * size
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Body */}
      <rect
        x={-w / 2}
        y={-h}
        width={w}
        height={h}
        fill="#8B6F47"
        stroke="#3E2C1A"
        strokeWidth={1.5}
        rx={1}
      />
      {/* Diagonal plank braces */}
      <line
        x1={-w / 2}
        y1={-h}
        x2={w / 2}
        y2={0}
        stroke="#5C4326"
        strokeWidth={1.2}
      />
      <line
        x1={w / 2}
        y1={-h}
        x2={-w / 2}
        y2={0}
        stroke="#5C4326"
        strokeWidth={1.2}
      />
      {/* Top ridge highlight */}
      <line
        x1={-w / 2}
        y1={-h}
        x2={w / 2}
        y2={-h}
        stroke="#A0855C"
        strokeWidth={1.2}
      />
    </g>
  )
}
