// Earth — blue disc with a soft glow ring and a subtle continent glyph.
// { cx, cy, r } = center + radius in SVG coords.

export function Earth({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      {/* atmosphere glow */}
      <circle cx={0} cy={0} r={r * 1.35} fill="#2A6BC7" opacity={0.08} />
      <circle cx={0} cy={0} r={r * 1.15} fill="#37C9B8" opacity={0.08} />
      {/* ocean */}
      <circle cx={0} cy={0} r={r} fill="#1E3A6B" stroke="#3A75C4" strokeWidth={1.2} />
      {/* continents — three soft blobs, purely decorative */}
      <path
        d={`M ${-r * 0.55} ${-r * 0.15} q ${r * 0.25} ${-r * 0.25} ${r * 0.55} ${r * 0.05} q ${r * 0.1} ${r * 0.15} ${-r * 0.05} ${r * 0.25} q ${-r * 0.35} ${r * 0.05} ${-r * 0.55} ${-r * 0.15} z`}
        fill="#1FA595"
        opacity={0.55}
      />
      <path
        d={`M ${r * 0.15} ${r * 0.35} q ${r * 0.2} ${-r * 0.05} ${r * 0.35} ${r * 0.15} q ${-r * 0.15} ${r * 0.2} ${-r * 0.35} ${-r * 0.15} z`}
        fill="#1FA595"
        opacity={0.5}
      />
      <path
        d={`M ${-r * 0.35} ${r * 0.45} q ${r * 0.15} ${-r * 0.05} ${r * 0.2} ${r * 0.1} q ${-r * 0.05} ${r * 0.15} ${-r * 0.2} ${-r * 0.1} z`}
        fill="#1FA595"
        opacity={0.5}
      />
    </g>
  )
}
