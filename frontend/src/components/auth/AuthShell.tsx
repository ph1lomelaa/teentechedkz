import type React from 'react'
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
  return (
    <main className="auth-shell relative min-h-[100dvh] overflow-x-hidden bg-[#0A0A0A] text-white">
      <div className="pointer-events-none absolute top-0 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[#FFD400]/[0.05] blur-3xl" />

      <Link
        to="/"
        className="absolute left-6 top-6 z-10 flex items-center gap-2 text-white/40 transition hover:text-[#FFD400] sm:left-8 sm:top-8"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-[10px] font-black uppercase tracking-[0.22em]">На главную</span>
      </Link>

      <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-20 sm:px-6">
        <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-[440px]'}`}>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl sm:p-10">
            <div className="mb-7 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#FFD400]">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1>
              {description && <div className="mt-3 text-sm leading-6 text-white/50">{description}</div>}
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
