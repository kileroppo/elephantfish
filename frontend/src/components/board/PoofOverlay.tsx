import { memo, useEffect, useState } from 'react'

export interface PoofBurst {
  id: number
  x: number
  y: number
}

interface Particle {
  id: number
  dx: number
  dy: number
  size: number
  delay: number
}

function generateParticles(): Particle[] {
  const count = 9
  const list: Particle[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4
    const dist = 22 + Math.random() * 26
    list.push({
      id: i,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: 14 + Math.random() * 12,
      delay: Math.random() * 40,
    })
  }
  return list
}

export const PoofOverlay = memo(function PoofOverlay({
  bursts,
  onComplete,
}: {
  bursts: PoofBurst[]
  onComplete?: (id: number) => void
}) {
  return (
    <div
      className="poof-overlay pointer-events-none fixed inset-0 z-[999] overflow-hidden"
      aria-hidden="true"
    >
      {bursts.map((burst) => (
        <SinglePoof key={burst.id} burst={burst} onComplete={onComplete} />
      ))}
    </div>
  )
})

function SinglePoof({
  burst,
  onComplete,
}: {
  burst: PoofBurst
  onComplete?: (id: number) => void
}) {
  const [particles] = useState(generateParticles)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onComplete?.(burst.id)
    }, 420)
    return () => window.clearTimeout(timer)
  }, [burst.id, onComplete])

  return (
    <div
      className="single-poof absolute pointer-events-none"
      style={{ left: burst.x, top: burst.y, transform: 'translate(-50%, -50%)' }}
    >
      {/* 核心微爆闪 */}
      <div className="poof-flash absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/70 blur-xs animate-[poofCore_280ms_cubic-bezier(0.16,1,0.3,1)_both]" />

      {/* 烟雾散开微粒 */}
      {particles.map((p) => (
        <span
          key={p.id}
          className="poof-puff absolute rounded-full bg-radial from-white via-[#f0ebe1] to-[#cfc6b5]/50 shadow-[0_2px_8px_rgba(0,0,0,0.12)] blur-[0.6px]"
          style={
            {
              width: `${p.size}px`,
              height: `${p.size}px`,
              left: `-${p.size / 2}px`,
              top: `-${p.size / 2}px`,
              '--p-dx': `${p.dx}px`,
              '--p-dy': `${p.dy}px`,
              animation: `poofPuff 380ms cubic-bezier(0.16, 1, 0.3, 1) ${p.delay}ms both`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
