export function SwitchSymbol({ closed }: { closed: boolean }) {
  const bladeAngle = closed ? 0 : -30
  return (
    <g>
      <rect x={-32} y={-18} width={64} height={36} fill="transparent" />
      <line x1={-32} y1={0} x2={-22} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={22} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={-22} cy={0} r={2.4} fill="#B9C4D6" />
      <circle cx={22} cy={0} r={2.4} fill="#B9C4D6" />
      <line
        x1={-22}
        y1={0}
        x2={-22 + Math.cos((bladeAngle * Math.PI) / 180) * 44}
        y2={0 + Math.sin((bladeAngle * Math.PI) / 180) * 44}
        stroke={closed ? '#37C9B8' : '#B9C4D6'}
        strokeWidth={2}
      />
    </g>
  )
}
