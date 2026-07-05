import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareWarning, Paperclip } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import { mentorAssignmentsApi } from '@/api/index'
import {
  TelegramChat,
  TelegramChatStatus,
  TELEGRAM_STATUS_COLORS,
  TELEGRAM_STATUS_LABELS,
  hasReviewPending,
} from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { toast } from '@/hooks/use-toast'

const TABS: { value: TelegramChatStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'unbound', label: 'Не привязаны' },
  { value: 'active', label: 'Активные' },
  { value: 'paused', label: 'На паузе' },
  { value: 'closed', label: 'Завершённые' },
]

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TelegramInboxPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = true

  const [tab, setTab] = useState<TelegramChatStatus | 'all'>('all')
  const [scope, setScope] = useState<'all' | 'mine' | 'unassigned'>('all')
  const [attachTarget, setAttachTarget] = useState<TelegramChat | null>(null)
  const [reassignTarget, setReassignTarget] = useState<TelegramChat | null>(null)
  const [closeTarget, setCloseTarget] = useState<TelegramChat | null>(null)

  const { data: chats = [], isLoading } = useQuery({
    queryKey: ['telegram-chats', 'all', scope],
    queryFn: () => telegramApi.listAll(undefined, scope),
  })

  const filtered = useMemo(() => {
    if (tab === 'all') return chats
    return chats.filter((c) => c.status === tab)
  }, [chats, tab])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['telegram-chats'] })

  const assignStudentMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Студент добавлен в ваши' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось взять студента', variant: 'destructive' }),
  })

  const attachMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.attach(attachTarget!.id, studentId),
    onSuccess: () => {
      invalidate()
      setAttachTarget(null)
      toast({ title: 'Чат привязан' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось привязать чат', variant: 'destructive' }),
  })

  const reassignMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.reassign(reassignTarget!.id, studentId),
    onSuccess: () => {
      invalidate()
      setReassignTarget(null)
      toast({ title: 'Студент изменён' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось сменить студента', variant: 'destructive' }),
  })

  const pauseMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.pause(chatId),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Чат поставлен на паузу' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const resumeMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.resume(chatId),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Чат возобновлён' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const closeMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.close(chatId),
    onSuccess: () => {
      invalidate()
      setCloseTarget(null)
      toast({ title: 'Сессия завершена' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Telegram</h1>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {[
          { value: 'all', label: 'Все' },
          { value: 'mine', label: 'Мои' },
          { value: 'unassigned', label: 'Без ответственного' },
        ].map((s) => (
          <button
            key={s.value}
            onClick={() => setScope(s.value as typeof scope)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              scope === s.value
                ? 'border-black text-gray-900 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t.value
                ? 'border-black text-gray-900 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">Чатов нет</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Чат</TableHead>
              <TableHead>Статус</TableHead>
                <TableHead>Студент</TableHead>
                <TableHead>Ответственные</TableHead>
                <TableHead>Последнее сообщение</TableHead>
              <TableHead>Не разобрано</TableHead>
              {canManage && <TableHead className="text-right">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((chat) => (
              <TableRow
                key={chat.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => navigate(`/telegram-inbox/${chat.id}`)}
              >
                <TableCell>
                  <div className="font-medium text-gray-900">{chat.title || `Чат ${chat.chat_id}`}</div>
                  <div className="text-xs text-gray-500">{chat.chat_type}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-[2px] text-xs ${TELEGRAM_STATUS_COLORS[chat.status]}`}>
                      {TELEGRAM_STATUS_LABELS[chat.status]}
                    </span>
                    {hasReviewPending(chat) && (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <MessageSquareWarning className="w-3 h-3" />
                        требует внимания
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {chat.student_name ? (
                    <div className="space-y-1">
                      <span className="text-gray-800">{chat.student_name}</span>
                      {chat.is_mine && (
                        <span className="block w-fit text-[10px] px-1.5 py-0.5 rounded-[2px] border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium uppercase tracking-wide">
                          Мой чат
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-gray-500 max-w-[160px] block truncate">
                    {chat.responsibles?.filter((r) => r.is_active).map((r) => r.name || 'Без имени').join(', ') || '—'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-gray-600">
                  <div className="max-w-[240px] truncate">{chat.last_message_preview || '—'}</div>
                  <div className="text-xs text-gray-400">{formatDate(chat.last_message_at)}</div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2 text-xs text-gray-600">
                    {chat.pending_insight_count > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquareWarning className="w-3.5 h-3.5" />
                        {chat.pending_insight_count}
                      </span>
                    )}
                    {chat.unresolved_attachment_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Paperclip className="w-3.5 h-3.5" />
                        {chat.unresolved_attachment_count}
                      </span>
                    )}
                  </div>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      {chat.status === 'unbound' && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAttachTarget(chat)}>
                          Привязать
                        </Button>
                      )}
                      {chat.student_id && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setReassignTarget(chat)}>
                          Сменить студента
                        </Button>
                      )}
                      {chat.student_id && !chat.is_mine && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={assignStudentMutation.isPending}
                          onClick={() => assignStudentMutation.mutate(chat.student_id!)}
                        >
                          Взять
                        </Button>
                      )}
                      {chat.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={pauseMutation.isPending}
                          onClick={() => pauseMutation.mutate(chat.id)}
                        >
                          Пауза
                        </Button>
                      )}
                      {chat.status === 'paused' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={resumeMutation.isPending}
                          onClick={() => resumeMutation.mutate(chat.id)}
                        >
                          Возобновить
                        </Button>
                      )}
                      {(chat.status === 'active' || chat.status === 'paused') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCloseTarget(chat)}
                        >
                          Завершить
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <StudentPickerDialog
        open={!!attachTarget}
        title="Привязать Telegram-чат"
        onClose={() => setAttachTarget(null)}
        onSelect={(studentId) => attachMutation.mutate(studentId)}
        isPending={attachMutation.isPending}
      />
      <StudentPickerDialog
        open={!!reassignTarget}
        title="Сменить студента"
        onClose={() => setReassignTarget(null)}
        onSelect={(studentId) => reassignMutation.mutate(studentId)}
        isPending={reassignMutation.isPending}
        excludeStudentId={reassignTarget?.student_id}
      />

      <Dialog open={!!closeTarget} onOpenChange={(open) => !open && setCloseTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Завершить сессию?</DialogTitle>
            <DialogDescription>
              Чат {closeTarget?.title || `${closeTarget?.chat_id}`} будет закрыт, привязка к студенту снята.
              Историю переписки можно будет посмотреть, но чат перестанет принимать AI-разбор.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate(closeTarget!.id)}
            >
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
