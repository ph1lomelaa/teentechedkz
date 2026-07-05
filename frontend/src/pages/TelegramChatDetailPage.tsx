import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FolderInput, Paperclip } from 'lucide-react'
import { telegramApi } from '@/api/telegram'
import { pendingInsightsApi } from '@/api'
import { documentsApi } from '@/api/documents'
import {
  DocType,
  DOC_TYPE_LABELS,
  TELEGRAM_STATUS_COLORS,
  TELEGRAM_STATUS_LABELS,
} from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { InsightCard } from '@/components/shared/InsightCard'
import { toast } from '@/hooks/use-toast'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TelegramChatDetailPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canManage = true

  const [reassignOpen, setReassignOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [saveAsDocTarget, setSaveAsDocTarget] = useState<string | null>(null)
  const [saveAsDocType, setSaveAsDocType] = useState<DocType | ''>('')

  const { data: chat } = useQuery({
    queryKey: ['telegram-chat', chatId],
    queryFn: () => telegramApi.getById(chatId!),
    enabled: !!chatId,
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['telegram-chat', chatId, 'messages'],
    queryFn: () => telegramApi.listMessages(chatId!),
    enabled: !!chatId,
  })

  const { data: insights = [] } = useQuery({
    queryKey: ['telegram-chat', chatId, 'insights'],
    queryFn: () => telegramApi.listInsights(chatId!),
    enabled: !!chatId,
  })

  const invalidateChat = () => {
    qc.invalidateQueries({ queryKey: ['telegram-chat', chatId] })
    qc.invalidateQueries({ queryKey: ['telegram-chats'] })
  }

  const reassignMutation = useMutation({
    mutationFn: (studentId: string) => telegramApi.reassign(chatId!, studentId),
    onSuccess: () => {
      invalidateChat()
      setReassignOpen(false)
      toast({ title: 'Студент изменён' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось сменить студента', variant: 'destructive' }),
  })

  const pauseMutation = useMutation({
    mutationFn: () => telegramApi.pause(chatId!),
    onSuccess: () => {
      invalidateChat()
      toast({ title: 'Чат поставлен на паузу' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const resumeMutation = useMutation({
    mutationFn: () => telegramApi.resume(chatId!),
    onSuccess: () => {
      invalidateChat()
      toast({ title: 'Чат возобновлён' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const closeMutation = useMutation({
    mutationFn: () => telegramApi.close(chatId!),
    onSuccess: () => {
      invalidateChat()
      setCloseConfirmOpen(false)
      toast({ title: 'Сессия завершена' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      pendingInsightsApi.review(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegram-chat', chatId, 'insights'] })
      qc.invalidateQueries({ queryKey: ['telegram-chats'] })
      toast({ title: 'Инсайт обработан' })
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  })

  const saveAsDocMutation = useMutation({
    mutationFn: () => documentsApi.saveFromTelegram(saveAsDocTarget!, saveAsDocType as DocType),
    onSuccess: () => {
      setSaveAsDocTarget(null)
      setSaveAsDocType('')
      toast({ title: 'Файл добавлен в документы студента' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось сохранить файл', variant: 'destructive' }),
  })

  if (!chat) {
    return <p className="text-sm text-gray-500">Загрузка…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/telegram-inbox')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">{chat.title || `Чат ${chat.chat_id}`}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded-[2px] text-xs ${TELEGRAM_STATUS_COLORS[chat.status]}`}>
              {TELEGRAM_STATUS_LABELS[chat.status]}
            </span>
            {chat.student_name && chat.student_id ? (
              <Link to={`/students/${chat.student_id}`} className="text-sm text-blue-600 hover:underline">
                {chat.student_name}
              </Link>
            ) : (
              <span className="text-sm text-gray-400">не привязан</span>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {chat.student_id && (
              <Button variant="outline" size="sm" onClick={() => setReassignOpen(true)}>
                Сменить студента
              </Button>
            )}
            {chat.status === 'active' && (
              <Button variant="outline" size="sm" disabled={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>
                Пауза
              </Button>
            )}
            {chat.status === 'paused' && (
              <Button variant="outline" size="sm" disabled={resumeMutation.isPending} onClick={() => resumeMutation.mutate()}>
                Возобновить
              </Button>
            )}
            {(chat.status === 'active' || chat.status === 'paused') && (
              <Button variant="outline" size="sm" onClick={() => setCloseConfirmOpen(true)}>
                Завершить
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-gray-200 rounded-[2px]">
          <div className="px-4 py-2 border-b border-gray-200 font-medium text-sm text-gray-700">
            Переписка ({messages.length})
          </div>
          <div className="max-h-[600px] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && <p className="text-sm text-gray-500">Сообщений пока нет</p>}
            {messages.map((m) => (
              <div key={m.id} className="text-sm border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span className="font-medium text-gray-700">{m.sender_name || 'Без имени'}</span>
                  <span>{formatDate(m.created_at)}</span>
                </div>
                {m.raw_text && <p className="text-gray-800 whitespace-pre-wrap">{m.raw_text}</p>}
                {m.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.attachments.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1">
                        <a
                          href={a.download_url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-xs border ${
                            a.download_url
                              ? 'border-gray-200 text-gray-700 hover:bg-gray-50'
                              : 'border-gray-100 text-gray-400 pointer-events-none'
                          }`}
                        >
                          <Paperclip className="w-3 h-3" />
                          {a.mime_type || 'файл'}
                        </a>
                        {chat.student_id && (a.status === 'downloaded' || a.status === 'parsed') && (
                          <button
                            title="В документы"
                            onClick={() => setSaveAsDocTarget(a.id)}
                            className="inline-flex items-center px-1.5 py-1 rounded-[2px] text-xs border border-gray-200 text-gray-500 hover:bg-gray-50"
                          >
                            <FolderInput className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border border-gray-200 rounded-[2px]">
          <div className="px-4 py-2 border-b border-gray-200 font-medium text-sm text-gray-700">
            AI-инсайты ({insights.length})
          </div>
          <div className="max-h-[600px] overflow-y-auto p-4 space-y-3">
            {insights.length === 0 && <p className="text-sm text-gray-500">Инсайтов пока нет</p>}
            {insights.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                isPending={reviewMutation.isPending}
                onApprove={() => reviewMutation.mutate({ id: insight.id, action: 'approve' })}
                onReject={() => reviewMutation.mutate({ id: insight.id, action: 'reject' })}
              />
            ))}
          </div>
        </div>
      </div>

      <StudentPickerDialog
        open={reassignOpen}
        title="Сменить студента"
        onClose={() => setReassignOpen(false)}
        onSelect={(studentId) => reassignMutation.mutate(studentId)}
        isPending={reassignMutation.isPending}
        excludeStudentId={chat.student_id}
      />

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Завершить сессию?</DialogTitle>
            <DialogDescription>
              Чат будет закрыт, привязка к студенту снята. История переписки останется доступна.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseConfirmOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate()}>
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!saveAsDocTarget} onOpenChange={(open) => !open && setSaveAsDocTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Добавить в документы</DialogTitle>
          </DialogHeader>
          <Select value={saveAsDocType} onValueChange={(v) => setSaveAsDocType(v as DocType)}>
            <SelectTrigger>
              <SelectValue placeholder="Тип документа" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsDocTarget(null)}>
              Отмена
            </Button>
            <Button
              disabled={!saveAsDocType || saveAsDocMutation.isPending}
              onClick={() => saveAsDocMutation.mutate()}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
