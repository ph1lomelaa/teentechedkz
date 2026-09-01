import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Link2, Power, RotateCcw, UserPlus } from 'lucide-react'
import { portalAccessApi } from '@/api/portalAccess'
import { toast } from '@/hooks/use-toast'
import { AppButton } from '@/components/ui'
import { cn, formatDate } from '@/lib/utils'
import { QueryError } from '@/components/shared/QueryState'

type Props = {
  studentId: string
  studentName?: string
  /** Called after access is granted so the caller can re-open the chat. */
  onGranted?: () => void
}

/**
 * Dark, workspace-themed twin of the CRM `PortalAccessSection`. Lets a mentor
 * (or staff) grant / manage a student's portal login straight from the
 * workspace — no jump to CRM. Backend access-control (`_staff_student`) already
 * allows mentor-in-scope, so this reuses the same `portalAccessApi`.
 */
export function WorkspaceAccessPanel({ studentId, studentName, onGranted }: Props) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState<'pw' | 'invite' | null>(null)

  const { data: access, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-access', studentId],
    queryFn: () => portalAccessApi.get(studentId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['portal-access', studentId] })
    queryClient.invalidateQueries({ queryKey: ['workspace', 'staff-conversation', studentId] })
    queryClient.invalidateQueries({ queryKey: ['staff-conversation', studentId] })
  }

  const grantMutation = useMutation({
    mutationFn: () => portalAccessApi.grant(studentId, email.trim(), name.trim() || undefined),
    onSuccess: (res) => {
      setTempPassword(res.temp_password)
      setInviteUrl(res.invite_url)
      setInviteExpiresAt(res.invite_expires_at)
      setEmail('')
      setName('')
      invalidate()
      onGranted?.()
      toast({ title: 'Доступ выдан', description: 'Передайте студенту ссылку-приглашение и временный пароль.' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось выдать доступ', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const resetMutation = useMutation({
    mutationFn: () => portalAccessApi.reset(studentId),
    onSuccess: (res) => {
      setTempPassword(res.temp_password)
      toast({ title: 'Пароль сброшен', description: 'Новый временный пароль показан ниже.' })
    },
    onError: () => toast({ title: 'Не удалось сбросить пароль', variant: 'destructive' }),
  })

  const inviteMutation = useMutation({
    mutationFn: () => portalAccessApi.reissueInvite(studentId),
    onSuccess: (res) => {
      setInviteUrl(res.invite_url)
      setInviteExpiresAt(res.invite_expires_at)
      toast({ title: 'Ссылка обновлена', description: 'Прежняя ссылка больше не работает.' })
    },
    onError: () => toast({ title: 'Не удалось создать ссылку', variant: 'destructive' }),
  })

  const toggleMutation = useMutation({
    mutationFn: (nextActive: boolean) => portalAccessApi.toggle(studentId, nextActive),
    onSuccess: (res) => {
      invalidate()
      toast({ title: res.is_active ? 'Доступ включён' : 'Доступ отключён' })
    },
    onError: () => toast({ title: 'Не удалось изменить статус', variant: 'destructive' }),
  })

  const copy = async (value: string, which: 'pw' | 'invite') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
      toast({ title: 'Скопировано' })
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' })
    }
  }

  // Ниже панель читает access?.has_access: при ошибке это undefined, и экран
  // уверенно сообщал бы, что доступа у ученика нет.
  if (isError) {
    return <QueryError colorPrefix="w" error={error} onRetry={refetch} />
  }

  if (isLoading) {
    return <p className="text-sm text-w-muted">Загрузка доступа...</p>
  }

  const hasAccess = access?.has_access

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 font-display text-base font-black text-w-ink">
        <KeyRound className="h-4 w-4 text-w-accentText" />
        Доступ в кабинет
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-black uppercase',
            hasAccess
              ? access?.is_active
                ? 'bg-w-good/15 text-w-good'
                : 'bg-w-accent/15 text-w-accentText'
              : 'bg-w-panel2 text-w-muted',
          )}
        >
          {hasAccess ? (access?.is_active ? 'доступ активен' : 'отключён') : 'нет доступа'}
        </span>
      </div>

      {hasAccess ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Email для входа" value={access?.email || '—'} />
            <Field label="МЗК" value={access?.primary_mentor_name || 'не назначен'} />
            <Field
              label="Последний вход"
              value={access?.last_login_at ? formatDate(access.last_login_at) : 'ещё не входил(а)'}
            />
            <Field
              label="Пароль"
              value={access?.must_change_password ? 'временный (не сменён)' : 'задан студентом'}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <AppButton colorPrefix="w" size="sm" variant="ghost" disabled={inviteMutation.isPending} onClick={() => inviteMutation.mutate()}>
              <Link2 className="h-3.5 w-3.5" /> Ссылка-приглашение
            </AppButton>
            <AppButton colorPrefix="w" size="sm" variant="ghost" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()}>
              <RotateCcw className="h-3.5 w-3.5" /> Сбросить пароль
            </AppButton>
            <AppButton colorPrefix="w" size="sm" variant="ghost" disabled={toggleMutation.isPending} onClick={() => toggleMutation.mutate(!access?.is_active)}>
              <Power className="h-3.5 w-3.5" /> {access?.is_active ? 'Отключить доступ' : 'Включить доступ'}
            </AppButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-w-muted">
            Выдайте {studentName || 'студенту'} вход в личный кабинет. Будет создан аккаунт с временным паролем — студент
            сменит его при первом входе. После этого откроется внутренний чат.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-w-muted">Email для входа</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@example.com"
                className="h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-w-muted">Имя (необязательно)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="как в карточке"
                className="h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
              />
            </label>
          </div>
          <AppButton colorPrefix="w" size="sm" disabled={grantMutation.isPending || !email.trim()} onClick={() => grantMutation.mutate()}>
            <UserPlus className="h-3.5 w-3.5" /> {grantMutation.isPending ? 'Выдаём...' : 'Выдать доступ'}
          </AppButton>
        </div>
      )}

      {tempPassword && (
        <div className="rounded-panel border border-w-accentDim/40 bg-w-accent/10 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-w-muted">Временный пароль — покажите один раз</p>
          <div className="mt-2 flex items-center gap-3">
            <code className="font-mono text-base font-bold tracking-wide text-w-ink">{tempPassword}</code>
            <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => copy(tempPassword, 'pw')}>
              {copied === 'pw' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Копировать
            </AppButton>
          </div>
        </div>
      )}

      {inviteUrl && (
        <div className="rounded-panel border border-w-accentDim/40 bg-w-accent/10 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-w-muted">Ссылка-приглашение — одноразовая</p>
          <div className="mt-2 flex items-center gap-3">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-w-ink">{inviteUrl}</code>
            <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => copy(inviteUrl, 'invite')}>
              {copied === 'invite' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Копировать
            </AppButton>
          </div>
          <p className="mt-2 text-xs text-w-muted">
            По ссылке студент задаёт пароль сам. Действует до {inviteExpiresAt ? formatDate(inviteExpiresAt) : '—'} и сгорает после
            первого использования.
          </p>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-ctl border border-w-line bg-w-panel2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-w-muted2">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-w-ink">{value}</div>
    </div>
  )
}
