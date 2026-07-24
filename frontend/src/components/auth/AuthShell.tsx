import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

interface AuthShellProps {
  eyebrow: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}

export function AuthShell({ eyebrow, title, description, children, wide = false }: AuthShellProps) {
  const glowRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const onMouseMove = (e: MouseEvent) => {
      const el = glowRef.current
      if (!el) return
      const x = (e.clientX / window.innerWidth - 0.5) * 16
      const y = (e.clientY / window.innerHeight - 0.5) * 16
      el.style.transform = `translate(calc(-50% + ${x}px), ${y}px)`
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

  return (
    <main className="auth-shell relative min-h-[100dvh] overflow-x-hidden bg-[#0A0A0A] text-white">
      <div
        ref={glowRef}
        className="pointer-events-none absolute top-0 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[#FFD400]/[0.05] blur-3xl transition-transform duration-300 ease-out"
      />

      <Link
        to="/"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-white/40 transition hover:text-[#FFD400] sm:left-8 sm:top-8"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-[10px] font-black uppercase tracking-[0.22em]">На главную</span>
      </Link>

      <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-20 sm:px-6">
        <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-[440px]'}`}>
          <div
            className={`relative overflow-hidden rounded-card border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl transition-all duration-300 ease-out focus-within:bg-white/[0.06] hover:bg-white/[0.05] sm:p-10 motion-reduce:transition-none ${
              mounted ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0'
            }`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD400]/60 to-transparent" />
            <div className="mb-7 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#FFD400]">{eyebrow}</p>
              <h1 className="mt-2 font-display text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1>
              {description && <div className="mt-3 text-sm leading-6 text-white/50">{description}</div>}
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
