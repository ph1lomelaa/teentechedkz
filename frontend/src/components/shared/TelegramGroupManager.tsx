import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2Off,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from 'lucide-react'

import { telegramApi } from '@/api/telegram'
import { toast } from '@/hooks/use-toast'
import { cn, formatDate } from '@/lib/utils'
import type { TelegramChat, TelegramGroupInviteLink, TelegramGroupSetupLink } from '@/types'

type Props = {
  studentId: string
  studentName: string
  chat: TelegramChat | null | undefined
  variant?: 'workspace' | 'crm'
}

function errorDetail(error: unknown): string {
  return (error as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Попробуйте ещё раз'
}

export function TelegramGroupManager({ studentId, studentName, chat, variant = 'crm' }: Props) {
  const queryClient = useQueryClient()
  const [setup, setSetup] = useState<TelegramGroupSetupLink | null>(null)
  const [studentInvite, setStudentInvite] = useState<TelegramGroupInviteLink | null>(null)
  const [selectedUnboundChatId, setSelectedUnboundChatId] = useState('')
  const [title, setTitle] = useState(chat?.title || '')
  const workspace = variant === 'workspace'

  useEffect(() => {
    setTitle(chat?.title || setup?.suggested_title || '')
  }, [chat?.id, chat?.title, setup?.suggested_title])

  const { data: unboundChats = [], refetch: refetchUnbound } = useQuery({
    queryKey: ['telegram-chats', 'unbound'],
    queryFn: () => telegramApi.listUnbound(),
    enabled: !chat,
    refetchInterval: !chat ? 5_000 : false,
  })

  const readinessQuery = useQuery({
    queryKey: ['telegram-chat', chat?.id, 'readiness'],
    queryFn: () => telegramApi.getReadiness(chat!.id),
    enabled: Boolean(chat?.id),
    refetchInterval: chat?.id ? 15_000 : false,
    retry: false,
  })

  // Participants surface only from message senders (Bot API can't list members),
  // so poll: new people appear as they write their first message.
  const { data: participants = [] } = useQuery({
    queryKey: ['telegram-chat', chat?.id, 'participants'],
    queryFn: () => telegramApi.listParticipants(chat!.id),
    enabled: Boolean(chat?.id),
    refetchInterval: chat?.id ? 10_000 : false,
  })

  const setRoleMutation = useMutation({
    mutationFn: ({ telegramUserId, role }: { telegramUserId: number; role: 'mentor' | 'student' }) =>
      telegramApi.setParticipantRole(chat!.id, telegramUserId, role),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['telegram-chat', chat?.id, 'participants'] })
      await queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram-participants', chat?.id] })
      toast({ title: 'Роль участника сохранена' })
    },
    onError: (error) => toast({ title: 'Не удалось изменить роль', description: errorDetail(error), variant: 'destructive' }),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['telegram-chat', 'student', studentId] }),
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'telegram'] }),
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'summary'] }),
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram'] }),
      queryClient.invalidateQueries({ queryKey: ['telegram-chats'] }),
    ])
  }

  useEffect(() => {
    if (chat) return
    const timer = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['telegram-chat', 'student', studentId] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'student', studentId, 'telegram'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'chat', 'telegram'] })
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [chat, queryClient, studentId])

  const setupMutation = useMutation({
    mutationFn: () => telegramApi.createGroupSetupLink(studentId),
    onSuccess: (result) => {
      setSetup(result)
      setTitle(result.suggested_title)
    },
    onError: (error) => toast({ title: 'Не удалось подготовить Telegram-группу', description: errorDetail(error), variant: 'destructive' }),
  })

  const attachMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.attach(chatId, studentId),
    onSuccess: async () => {
      setSelectedUnboundChatId('')
      await refresh()
      toast({ title: 'Telegram-группа привязана' })
    },
    onError: (error) => toast({ title: 'Не удалось привязать группу', description: errorDetail(error), variant: 'destructive' }),
  })

  const titleMutation = useMutation({
    mutationFn: () => telegramApi.setTitle(chat!.id, title.trim() || undefined),
    onSuccess: async (updated) => {
      setTitle(updated.title || '')
      await refresh()
      toast({ title: 'Название группы обновлено' })
    },
    onError: (error) => toast({ title: 'Не удалось изменить название', description: errorDetail(error), variant: 'destructive' }),
  })

  const inviteMutation = useMutation({
    mutationFn: () => telegramApi.createGroupInviteLink(studentId, chat!.chat_id),
    onSuccess: (result) => setStudentInvite(result),
    onError: (error) => toast({ title: 'Не удалось создать ссылку ученику', description: errorDetail(error), variant: 'destructive' }),
  })

  const statusMutation = useMutation({
    mutationFn: (action: 'pause' | 'resume') => action === 'pause' ? telegramApi.pause(chat!.id) : telegramApi.resume(chat!.id),
    onSuccess: refresh,
    onError: (error) => toast({ title: 'Не удалось изменить статус группы', description: errorDetail(error), variant: 'destructive' }),
  })

  const unbindMutation = useMutation({
    mutationFn: () => telegramApi.unbind(chat!.id),
    onSuccess: async () => {
      setStudentInvite(null)
      await refresh()
      await refetchUnbound()
      toast({ title: 'Группа отвязана от ученика' })
    },
    onError: (error) => toast({ title: 'Не удалось отвязать группу', description: errorDetail(error), variant: 'destructive' }),
  })

  const unlinkStudentMutation = useMutation({
    mutationFn: () => telegramApi.unbindStudentTelegram(studentId),
    onSuccess: async () => {
      await refresh()
      toast({ title: 'Telegram-аккаунт ученика отвязан' })
    },
    onError: (error) => toast({ title: 'Не удалось отвязать аккаунт', description: errorDetail(error), variant: 'destructive' }),
  })

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: 'Ссылка скопирована' })
    } catch {
      toast({ title: 'Не удалось скопировать ссылку', variant: 'destructive' })
    }
  }

  const card = workspace
    ? 'rounded-panel border border-w-line bg-w-panel2 p-4'
    : 'rounded-panel border border-gray-200 bg-gray-50 p-4'
  const button = workspace
    ? 'inline-flex h-9 items-center justify-center gap-2 rounded-full bg-w-accent px-4 text-xs font-bold text-black transition hover:brightness-95 disabled:opacity-50'
    : 'inline-flex h-9 items-center justify-center gap-2 rounded-ctl bg-gray-900 px-4 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50'
  const secondaryButton = workspace
    ? 'inline-flex h-9 items-center justify-center gap-2 rounded-full border border-w-line bg-w-panel px-4 text-xs font-bold text-w-ink hover:border-w-accentDim disabled:opacity-50'
    : 'inline-flex h-9 items-center justify-center gap-2 rounded-ctl border border-gray-300 bg-white px-4 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50'
  const input = workspace
    ? 'h-10 w-full rounded-ctl border border-w-line bg-w-panel px-3 text-sm text-w-ink outline-none focus:border-w-accentDim'
    : 'h-10 w-full rounded-ctl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-gray-700'

  if (!chat) {
    return (
      <div className="space-y-4">
        <div className={card}>
          <div className="flex items-start gap-3">
            <div className={cn('rounded-full p-2', workspace ? 'bg-w-accent/15 text-w-accentText' : 'bg-amber-100 text-amber-800')}>
              <Users className="h-4 w-4" />
            </div>
            <div>
              <div className={cn('font-semibold', workspace ? 'text-w-ink' : 'text-gray-900')}>Шаг 1 (для вас): создать группу и добавить бота</div>
              <p className={cn('mt-1 text-sm', workspace ? 'text-w-muted' : 'text-gray-600')}>
                Откройте Telegram, создайте (или выберите) группу для {studentName} и добавьте бота — группа подключится сама.
                <b> Эту ссылку не отправляйте ученику</b> — она только для добавления бота. Простую ссылку «вступить» для ученика вы получите на шаге 2, после подключения группы.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={button} onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
              {setupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Подготовить группу
            </button>
            <button className={secondaryButton} onClick={() => refetchUnbound()}>
              <RefreshCw className="h-4 w-4" /> Обновить список
            </button>
          </div>
        </div>

        {setup && (
          <div className={card}>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] opacity-60">Ссылка для добавления бота — только для вас</div>
            <div className="mt-1 text-sm font-semibold">Откройте в Telegram и выберите/создайте группу</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={button} href={setup.startgroup_link} target="_blank" rel="noreferrer">
                Открыть Telegram <ExternalLink className="h-4 w-4" />
              </a>
              <button className={secondaryButton} onClick={() => copy(setup.startgroup_link)}>
                <Copy className="h-4 w-4" /> Копировать
              </button>
            </div>
            <div className="mt-3 text-xs opacity-60">Рекомендуемое название: {setup.suggested_title}</div>
            <div className="mt-1 text-xs opacity-60">Здесь вы выбираете группу и добавляете бота. Ученику эта ссылка не нужна.</div>
          </div>
        )}

        {unboundChats.some((item) => item.chat_type !== 'private') && (
          <div className={card}>
            <div className="text-sm font-semibold">Группа уже появилась?</div>
            <p className="mt-1 text-xs opacity-60">Выберите её вручную, если автоматическая привязка ещё не произошла.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select className={input} value={selectedUnboundChatId} onChange={(event) => setSelectedUnboundChatId(event.target.value)}>
                <option value="">Выберите непривязанную группу</option>
                {unboundChats.filter((item) => item.chat_type !== 'private').map((item) => <option key={item.id} value={item.id}>{item.title || `Чат ${item.chat_id}`}</option>)}
              </select>
              <button className={button} disabled={!selectedUnboundChatId || attachMutation.isPending} onClick={() => attachMutation.mutate(selectedUnboundChatId)}>
                Это группа ученика
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const readiness = readinessQuery.data
  const checks = [
    ['Бот в группе', readiness?.bot_in_chat],
    ['Бот — администратор', readiness?.bot_is_admin],
    ['Может менять название', readiness?.can_change_info],
    ['Может создавать ссылки', readiness?.can_invite_users],
    ['Privacy Mode выключен', readiness?.privacy_mode_disabled],
  ] as const

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className={cn('font-semibold', workspace ? 'text-w-ink' : 'text-gray-900')}>{chat.title || `Группа ${chat.chat_id}`}</div>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', chat.status === 'paused' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
                {chat.status === 'paused' ? 'пауза' : 'подключена'}
              </span>
            </div>
            <div className="mt-1 text-xs opacity-60">Telegram ID группы: {chat.chat_id}</div>
          </div>
          <button className={secondaryButton} onClick={() => readinessQuery.refetch()} disabled={readinessQuery.isFetching}>
            <RefreshCw className={cn('h-4 w-4', readinessQuery.isFetching && 'animate-spin')} /> Проверить
          </button>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Готовность группы</div>
        {readinessQuery.isLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm opacity-60"><Loader2 className="h-4 w-4 animate-spin" /> Проверяем Telegram…</div>
        ) : readinessQuery.isError ? (
          <div className="mt-3 flex items-start gap-2 text-sm text-red-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {errorDetail(readinessQuery.error)}</div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {checks.map(([label, ok]) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
        {readiness && !readiness.ready && readiness.issues.length > 0 && (
          <div className={cn('mt-3 rounded-ctl p-3 text-xs', workspace ? 'bg-amber-500/10 text-w-ink' : 'bg-amber-50 text-amber-900')}>
            {readiness.issues.join(' · ')}
          </div>
        )}
        <p className="mt-3 text-xs opacity-60">Бот работает в фоне и пишет в группу только подтверждение успешного подключения.</p>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 text-sm font-semibold"><UserRoundCheck className="h-4 w-4" /> Кто ментор в группе</div>
        <p className="mt-1 text-xs opacity-60">
          Отметьте, кто ментор, а кто ученик — тогда сообщения в чате отображаются с правильной стороны.
          Участник появляется в списке после своего первого сообщения в группе.
        </p>
        {participants.length === 0 ? (
          <div className="mt-3 text-xs opacity-60">Пока никто не писал в группе. Как только ментор и ученик отправят сообщение — они появятся здесь.</div>
        ) : (
          <div className="mt-3 space-y-2">
            {participants.map((participant) => (
              <div key={participant.telegram_user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-gray-200 bg-white px-3 py-2 dark:border-w-line dark:bg-w-panel">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{participant.sender_name || participant.display_name || participant.telegram_user_id}</div>
                  <div className="text-[11px] opacity-50">
                    {participant.role === 'mentor' ? 'Ментор' : participant.role === 'student' ? 'Ученик' : 'Роль не задана'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className={cn(secondaryButton, participant.role === 'mentor' && 'border-emerald-500 text-emerald-700')}
                    disabled={setRoleMutation.isPending || participant.role === 'mentor'}
                    onClick={() => setRoleMutation.mutate({ telegramUserId: participant.telegram_user_id, role: 'mentor' })}
                  >
                    Ментор
                  </button>
                  <button
                    className={cn(secondaryButton, participant.role === 'student' && 'border-sky-500 text-sky-700')}
                    disabled={setRoleMutation.isPending || participant.role === 'student'}
                    onClick={() => setRoleMutation.mutate({ telegramUserId: participant.telegram_user_id, role: 'student' })}
                  >
                    Ученик
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="text-sm font-semibold">Название группы</div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className={input} maxLength={128} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${studentName} — страна — год`} />
          <button className={button} disabled={titleMutation.isPending || !title.trim()} onClick={() => titleMutation.mutate()}>
            {titleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
          </button>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 text-sm font-semibold"><UserRoundCheck className="h-4 w-4" /> Шаг 2: ссылка ученику — он просто вступит</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide opacity-50">Ожидаемый ученик</div>
            <div className="mt-1 text-sm font-medium">{studentName}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide opacity-50">Подключённый Telegram</div>
            <div className="mt-1 text-sm font-medium">
              {chat.student_telegram_user_id
                ? `${chat.student_telegram_username ? `@${chat.student_telegram_username}` : 'Без username'} · ${chat.student_telegram_user_id}`
                : 'Ещё не подключён'}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={button} onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !readiness?.can_invite_users}>
            {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Получить ссылку для ученика
          </button>
          {chat.student_telegram_user_id && (
            <button className={secondaryButton} disabled={unlinkStudentMutation.isPending} onClick={() => window.confirm('Отвязать Telegram-аккаунт ученика?') && unlinkStudentMutation.mutate()}>
              <Link2Off className="h-4 w-4" /> Отвязать аккаунт
            </button>
          )}
        </div>
        {studentInvite && (
          <div className={cn('mt-4 rounded-ctl border p-3', workspace ? 'border-w-accentDim/40 bg-w-accent/10' : 'border-amber-200 bg-amber-50')}>
            <div className="break-all text-sm">{studentInvite.invite_link}</div>
            <div className="mt-1 text-xs opacity-60">Действует до {formatDate(studentInvite.expires_at)} · привяжется первый, кто вступит. Отправьте ссылку ученику, не открывайте сами.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={secondaryButton} onClick={() => copy(studentInvite.invite_link)}><Copy className="h-4 w-4" /> Копировать</button>
              <a className={secondaryButton} href={studentInvite.invite_link} target="_blank" rel="noreferrer">Открыть <ExternalLink className="h-4 w-4" /></a>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {chat.status === 'paused' ? (
          <button className={secondaryButton} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate('resume')}><Play className="h-4 w-4" /> Возобновить обработку</button>
        ) : (
          <button className={secondaryButton} disabled={statusMutation.isPending} onClick={() => statusMutation.mutate('pause')}><Pause className="h-4 w-4" /> Поставить на паузу</button>
        )}
        <button className={cn(secondaryButton, 'text-red-600')} disabled={unbindMutation.isPending} onClick={() => window.confirm('Отвязать группу от карточки ученика? История сообщений сохранится.') && unbindMutation.mutate()}>
          <Link2Off className="h-4 w-4" /> Отвязать группу
        </button>
      </div>
    </div>
  )
}
