import React from 'react'
import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { AccountAccessCard } from '@/components/auth/AccountAccessCard'
import { CheckinSettingsCard } from '@/components/workspace/CheckinSettingsCard'

export const WorkspaceProfilePage: React.FC = () => {
  const { user, hasRole } = useAuth()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
      <header>
        <h1 className="text-xl font-black text-w-ink">Профиль и вход</h1>
        <p className="mt-1 text-sm text-w-muted">Здесь видно, какими способами вы можете войти в систему.</p>
      </header>
      <section className="rounded-panel border border-w-line bg-w-panel p-4">
        <h2 className="text-sm font-bold text-w-ink">Аккаунт</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-w-muted">Имя</dt><dd className="text-w-ink">{user?.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-w-muted">Основная почта</dt><dd className="break-all text-w-ink">{user?.email}</dd>
          </div>
        </dl>
      </section>
      {hasRole('mentor', 'mzk_manager', 'academic_head') && <CheckinSettingsCard />}
      <AccountAccessCard colorPrefix="w" />
      <section className="rounded-panel border border-w-line bg-w-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-w-ink"><KeyRound className="h-4 w-4" /> Пароль</h2>
        <p className="mt-1 text-sm text-w-muted">Если помните текущий пароль, его можно сменить в любой момент. Для забытого пароля запросите ссылку выше.</p>
        <Link to="/change-password" className="mt-3 inline-flex items-center rounded-ctl border border-w-line px-3 py-2 text-sm font-semibold text-w-ink transition hover:border-w-accentDim">Сменить пароль</Link>
      </section>
    </div>
  )
}
