import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Copy, Check, UserPlus, RotateCcw, Power, Link2, Mail, Plus, X } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/primitives/accordion'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Badge } from '@/components/ui/primitives/badge'
import { useToast } from '@/hooks/use-toast'
import { portalAccessApi } from '@/api/portalAccess'

function fmtDate(value?: string | null): string {
  if (!value) return 'ещё не входил(а)'
  try {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

export const PortalAccessSection: React.FC<{ studentId: string }> = ({ studentId }) => {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [secondEmail, setSecondEmail] = useState('')

  const { data: access, isLoading } = useQuery({
    queryKey: ['portal-access', studentId],
    queryFn: () => portalAccessApi.get(studentId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['portal-access', studentId] })
    queryClient.invalidateQueries({ queryKey: ['student', studentId] })
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
      toast({ title: 'Доступ выдан', description: 'Ссылку-приглашение и временный пароль передайте студенту.' })
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

  const addEmailMutation = useMutation({
    mutationFn: () => portalAccessApi.addEmail(studentId, secondEmail.trim()),
    onSuccess: () => {
      setSecondEmail('')
      invalidate()
      toast({ title: 'Email добавлен', description: 'Теперь студент может входить и по нему.' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось добавить email', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const removeEmailMutation = useMutation({
    mutationFn: (emailId: string) => portalAccessApi.removeEmail(studentId, emailId),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Email удалён' })
    },
    onError: () => toast({ title: 'Не удалось удалить email', variant: 'destructive' }),
  })

  const toggleMutation = useMutation({
    mutationFn: (nextActive: boolean) => portalAccessApi.toggle(studentId, nextActive),
    onSuccess: (res) => {
      invalidate()
      toast({ title: res.is_active ? 'Доступ включён' : 'Доступ отключён' })
    },
    onError: () => toast({ title: 'Не удалось изменить статус', variant: 'destructive' }),
  })

  const copyPassword = async () => {
    if (!tempPassword) return
    try {
      await navigator.clipboard.writeText(tempPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const copyInviteLink = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const hasAccess = access?.has_access
  const allEmails = access?.emails ?? []
  const extraEmails = allEmails.filter((e) => !e.is_primary)
  const canAddEmail = hasAccess && allEmails.length < 2

  return (
    <AccordionItem value="portal-access" className="border border-gray-200 rounded-card px-4">
      <AccordionTrigger className="text-base font-semibold">
        <span className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-gray-500" />
          Кабинет студента
          {hasAccess ? (
            <Badge variant="outline" className="ml-1 text-[10px] font-medium">
              {access?.is_active ? 'доступ активен' : 'отключён'}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1 text-[10px] font-medium text-gray-500">
              нет доступа
            </Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <p className="text-sm text-gray-500 py-2">Загрузка…</p>
        ) : hasAccess ? (
          <div className="space-y-4 py-1">
            {!access?.primary_mentor_id && (
              <div className="rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                У студента нет активного МЗК. Назначьте МЗК в карточке, чтобы roadmap, встречи и чат были связаны с ответственным.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Row label="Основной email" value={access?.email} />
              <Row label="МЗК" value={access?.primary_mentor_name} />
              <Row label="Статус" value={access?.is_active ? 'Активен' : 'Отключён'} />
              <Row label="Последний вход" value={fmtDate(access?.last_login_at)} />
              <Row
                label="Пароль"
                value={access?.must_change_password ? 'временный (не сменён)' : 'задан студентом'}
              />
            </div>

            <div className="space-y-2 pt-1">
              <p className="label-caps text-gray-600 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Дополнительный email для входа
              </p>
              {extraEmails.length > 0 ? (
                <div className="space-y-1.5">
                  {extraEmails.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-3 rounded-panel border border-gray-200 px-3 py-1.5 text-sm"
                    >
                      <span className="text-gray-900 truncate">{e.email}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-gray-500 hover:text-red-600"
                        onClick={() => e.id && removeEmailMutation.mutate(e.id)}
                        disabled={removeEmailMutation.isPending}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : canAddEmail ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    placeholder="личный email студента"
                    value={secondEmail}
                    onChange={(ev) => setSecondEmail(ev.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs shrink-0"
                    onClick={() => addEmailMutation.mutate()}
                    disabled={addEmailMutation.isPending || !secondEmail.trim()}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Добавить
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Достигнут лимит в два email на аккаунт.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending}
              >
                <Link2 className="w-3 h-3 mr-2" />
                Ссылка-приглашение
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
              >
                <RotateCcw className="w-3 h-3 mr-2" />
                Сбросить пароль
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => toggleMutation.mutate(!access?.is_active)}
                disabled={toggleMutation.isPending}
              >
                <Power className="w-3 h-3 mr-2" />
                {access?.is_active ? 'Отключить доступ' : 'Включить доступ'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {!access?.primary_mentor_id && (
              <div className="rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Сначала лучше назначить МЗК. Тогда студент сразу увидит контакт в чате, а встречи и roadmap будут привязаны к ответственному.
              </div>
            )}
            {access?.primary_mentor_name && (
              <div className="rounded-panel border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                МЗК: {access.primary_mentor_name}
              </div>
            )}
            <p className="text-sm text-gray-500">
              Выдайте студенту вход в личный кабинет. Будет создан аккаунт с временным паролем —
              студент сменит его при первом входе.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-caps text-gray-600 block mb-1.5">Email для входа</label>
                <Input
                  type="email"
                  placeholder="student@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="label-caps text-gray-600 block mb-1.5">Имя (необязательно)</label>
                <Input
                  type="text"
                  placeholder="как в карточке"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <Button
              size="sm"
              className="h-9 px-4 text-xs"
              onClick={() => grantMutation.mutate()}
              disabled={grantMutation.isPending || !email.trim()}
            >
              <UserPlus className="w-3.5 h-3.5 mr-2" />
              Выдать доступ
            </Button>
          </div>
        )}

        {tempPassword && (
          <div className="mt-4 rounded-panel border border-brand/40 bg-brand/10 p-4">
            <p className="label-caps text-gray-600 mb-2">Временный пароль — покажите один раз</p>
            <div className="flex items-center gap-3">
              <code className="font-mono text-base font-semibold tracking-wide text-gray-900">
                {tempPassword}
              </code>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={copyPassword}>
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span className="ml-1.5">{copied ? 'Скопировано' : 'Копировать'}</span>
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Передайте пароль студенту лично или в Telegram. После закрытия он больше не покажется —
              используйте «Сбросить пароль», если понадобится новый.
            </p>
          </div>
        )}

        {inviteUrl && (
          <div className="mt-4 rounded-panel border border-brand/40 bg-brand/10 p-4">
            <p className="label-caps text-gray-600 mb-2">Ссылка-приглашение — одноразовая</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 truncate font-mono text-xs text-gray-900">{inviteUrl}</code>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={copyInviteLink}>
                {inviteCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span className="ml-1.5">{inviteCopied ? 'Скопировано' : 'Копировать'}</span>
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              По ссылке студент задаёт свой пароль сам. Действует до {fmtDate(inviteExpiresAt)} и сгорает
              после первого использования. «Ссылка-приглашение» создаст новую и отменит эту.
            </p>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

const Row: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 border-b border-gray-100 py-1.5">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-900 font-medium text-right">{value || '—'}</span>
  </div>
)
