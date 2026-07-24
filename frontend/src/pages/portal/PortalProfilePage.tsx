import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { portalApi } from '@/api/portal'
import { authApi } from '@/api/auth'
import { DEGREE_LEVEL_LABELS } from '@/types'
import { AppButton, AppInput, AppCard } from '@/components/ui'
import { PageShell } from '@/components/shared/PageShell'

export const PortalProfilePage: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ['portal', 'profile'], queryFn: portalApi.profile })

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const changePassword = async () => {
    setMsg(null)
    if (next.length < 8) return setMsg({ ok: false, text: 'Новый пароль минимум 8 символов' })
    if (next !== confirm) return setMsg({ ok: false, text: 'Пароли не совпадают' })
    setSaving(true)
    try {
      await authApi.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setMsg({ ok: true, text: 'Пароль обновлён' })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setMsg({ ok: false, text: detail || 'Не удалось сменить пароль' })
    } finally {
      setSaving(false)
    }
  }

  const u = data?.user
  const s = data?.student

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Кабинет</p>
      <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Профиль</h1>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <AppCard className="h-fit">
            <h2 className="text-sm font-extrabold text-p-text mb-3">Мои данные</h2>
            <dl className="divide-y divide-p-line">
              <Row label="Имя" value={u?.name} />
              <Row label="Email" value={u?.email} />
              <Row label="Телефон" value={u?.phone || s?.phone} />
              {s && <Row label="Город" value={s.city} />}
              {s && <Row label="Программа" value={DEGREE_LEVEL_LABELS[s.degree_level as keyof typeof DEGREE_LEVEL_LABELS] ?? s.degree_level} />}
              {s && <Row label="Год поступления" value={String(s.intake_year)} />}
              {s?.specialty && <Row label="Специальность" value={s.specialty} />}
            </dl>
          </AppCard>

          <AppCard className="h-fit">
            <h2 className="text-sm font-extrabold text-p-text mb-3">Смена пароля</h2>
            {msg && (
              <div className={`text-sm mb-3 px-3 py-2 rounded-ctl ${msg.ok ? 'bg-p-good/10 text-p-good' : 'bg-p-danger/10 text-p-danger'}`}>
                {msg.text}
              </div>
            )}
            <div className="space-y-2.5">
              <AppInput type="password" placeholder="Текущий пароль" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <AppInput type="password" placeholder="Новый пароль" value={next} onChange={(e) => setNext(e.target.value)} />
              <AppInput type="password" placeholder="Повторите новый пароль" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <AppButton disabled={saving || !current || !next} onClick={changePassword}>
                Сохранить пароль
              </AppButton>
            </div>
          </AppCard>
        </div>
      )}
    </PageShell>
  )
}

const Row: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-2 text-sm">
    <dt className="text-p-muted">{label}</dt>
    <dd className="text-p-text font-bold text-right">{value || '—'}</dd>
  </div>
)
