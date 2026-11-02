import { useId } from 'react'

// The CKOneAI robot head, the same inline SVG as the CityKart Pulse assistant (same company; no external asset).
export default function RobotAvatar({ size = 40, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, '')
  const head = `ai-head-${uid}`
  const rim = `ai-rim-${uid}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={head} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1D3E5F" /><stop offset="1" stopColor="#0D2338" /></linearGradient>
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F4DA99" /><stop offset="1" stopColor="#C29A45" /></linearGradient>
      </defs>
      <line x1="32" y1="7" x2="32" y2="13" stroke={`url(#${rim})`} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="6" r="3" fill="#D6AE59" />
      <rect x="10" y="13" width="44" height="38" rx="14" fill={`url(#${head})`} stroke={`url(#${rim})`} strokeWidth="2.5" />
      <path d="M17 19.5c3-2 7-2.5 10-2.5" stroke="#fff" strokeOpacity="0.18" strokeWidth="2" strokeLinecap="round" fill="none" />
      <rect x="16" y="22" width="32" height="18" rx="9" fill="#071624" />
      <rect x="6" y="26" width="4" height="10" rx="2" fill="#D6AE59" />
      <rect x="54" y="26" width="4" height="10" rx="2" fill="#D6AE59" />
      <g className="ai-robot-eyes" fill="#10C783"><ellipse cx="25" cy="31" rx="3.2" ry="4" /><ellipse cx="39" cy="31" rx="3.2" ry="4" /></g>
      <path d="M26 44.5c3.5 2.2 8.5 2.2 12 0" stroke="#D6AE59" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}
