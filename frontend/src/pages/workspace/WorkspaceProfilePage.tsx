import React, { useState } from 'react'
import { authApi } from '@/api/auth'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import {
  WorkspaceAvatar,
  WorkspaceButton,
  WorkspaceCard,
  WorkspaceInput,
  WorkspacePageHeader,
} from '@/components/workspace/ui'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  mzk_manager: 'MZK-менеджер',
  mentor: 'Ментор',
}

export const WorkspaceProfilePage: React.FC = () => {
  const { user } = useAuth()
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

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <WorkspacePageHeader eyebrow="Кабинет" title="Профиль" />

      <div className="space-y-5">
        <WorkspaceCard className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <WorkspaceAvatar name={user?.name || user?.email || ''} size={48} />
            <div className="min-w-0">
              <div className="truncate font-display text-base font-black text-w-ink">{user?.name || '—'}</div>
              <div className="text-xs text-w-muted">{(user?.role && ROLE_LABEL[user.role]) || user?.role}</div>
            </div>
          </div>
          <dl className="divide-y divide-w-line">
            <Row label="Email" value={user?.email} />
            <Row label="Телефон" value={user?.phone} />
          </dl>
        </WorkspaceCard>

        <WorkspaceCard className="p-5">
          <h2 className="mb-3 text-sm font-extrabold text-w-ink">Смена пароля</h2>
          {msg && (
            <div
              className={cn(
                'mb-3 rounded-[10px] px-3 py-2 text-sm',
                msg.ok ? 'bg-w-good/10 text-w-good' : 'bg-w-danger/10 text-w-danger'
              )}
            >
              {msg.text}
            </div>
          )}
          <div className="max-w-sm space-y-2.5">
            <WorkspaceInput type="password" placeholder="Текущий пароль" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <WorkspaceInput type="password" placeholder="Новый пароль" value={next} onChange={(e) => setNext(e.target.value)} />
            <WorkspaceInput type="password" placeholder="Повторите новый пароль" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <WorkspaceButton size="sm" disabled={saving || !current || !next} onClick={changePassword}>
              Сохранить пароль
            </WorkspaceButton>
          </div>
        </WorkspaceCard>
      </div>
    </div>
  )
}

const Row: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-2 text-sm">
    <dt className="text-w-muted">{label}</dt>
    <dd className="text-right font-bold text-w-ink">{value || '—'}</dd>
  </div>
)
