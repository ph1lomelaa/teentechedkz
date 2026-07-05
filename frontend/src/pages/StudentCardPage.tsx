import React, { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  Edit2,
  Plus,
  Check,
  X,
  Eye,
  Shield,
  Download,
  Minus,
  BookText,
  Send,
  Pause,
  Link2Off,
  Trash2,
} from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { studentsApi } from '@/api/students'
import {
  guardiansApi,
  tasksApi,
  confidentialNotesApi,
  historyApi,
  usersApi,
  portfolioApi,
  servicesApi,
  telegramApi,
  mentorAssignmentsApi,
  contractsApi,
} from '@/api/index'
import { syncApi } from '@/api/sync'
import { notionApi } from '@/api/notion'
import { stripMarkdown } from '@/components/shared/Markdown'
import { useAuth } from '@/contexts/AuthContext'
import {
  DOC_TYPE_LABELS,
  SERVICE_TYPE_LABELS,
  SERVICE_STATUS_LABELS,
  SUBMISSION_STATUS_LABELS,
  PIPELINE_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PIPELINE_STATUS_COLORS,
  StudentFull,
  Service,
  Guardian,
  Document,
  NoteVisibility,
  TelegramPairingCode,
} from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { downloadBlob, formatDate, formatCurrency, formatFileSize } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 font-medium mt-0.5 sm:mt-0">
        {value ?? '—'}
      </span>
    </div>
  )
}

/** Строка «поле: значение» с редактированием по двойному клику.
 * Enter/blur — сохранить, Esc — отмена; select сохраняет при выборе. */
function EditableInfoRow({
  label,
  display,
  editValue,
  canEdit,
  onSave,
  type = 'text',
  options,
}: {
  label: string
  display?: string | number | null
  editValue?: string | number | null
  canEdit: boolean
  onSave: (value: string) => void
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const committedRef = React.useRef(false)

  const initial = String(editValue ?? display ?? '')

  const start = () => {
    if (!canEdit) return
    committedRef.current = false
    setDraft(initial)
    setEditing(true)
  }
  const cancel = () => {
    committedRef.current = true // blur при размонтировании не должен сохранить
    setEditing(false)
  }
  const commit = (value?: string) => {
    if (committedRef.current) return
    committedRef.current = true
    setEditing(false)
    const v = (value ?? draft).trim()
    if (v === initial.trim()) return
    onSave(v)
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 sm:w-48 shrink-0">{label}</span>
      {!editing ? (
        <span
          className={`text-sm text-gray-900 font-medium mt-0.5 sm:mt-0 min-w-0 ${
            canEdit ? 'cursor-text rounded-[2px] -mx-1 px-1 hover:bg-amber-50/70' : ''
          }`}
          title={canEdit ? 'Двойной клик — редактировать' : undefined}
          onDoubleClick={start}
        >
          {display ?? '—'}
        </span>
      ) : type === 'select' ? (
        <Select
          defaultOpen
          value={draft || undefined}
          onValueChange={(v) => commit(v)}
          onOpenChange={(open) => {
            if (!open && !committedRef.current) cancel()
          }}
        >
          <SelectTrigger className="h-8 w-full sm:w-64 text-sm">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : type === 'textarea' ? (
        <div className="flex-1 min-w-0">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            }}
          />
          <div className="flex gap-1.5 mt-1.5">
            <Button size="sm" className="h-7 text-xs" onClick={() => commit()}>
              Сохранить
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancel}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Input
          autoFocus
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
            if (e.key === 'Enter') commit()
          }}
          className="h-8 w-full sm:w-64 text-sm"
        />
      )}
    </div>
  )
}

function EditStudentModal({
  student,
  open,
  onClose,
}: {
  student: StudentFull
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    full_name: student.full_name,
    phone: student.phone,
    specialty: student.specialty ?? '',
    gpa: student.gpa ?? '',
    achievements_text: student.achievements_text ?? '',
    budget_per_year: student.budget_per_year ?? '',
    city: student.city ?? '',
  })

  const mutation = useMutation({
    mutationFn: (data: Partial<StudentFull>) =>
      studentsApi.update(student.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', student.id] })
      toast({ title: 'Сохранено', description: 'Данные студента обновлены' })
      onClose()
    },
    onError: () => {
      toast({ title: 'Ошибка', description: 'Не удалось сохранить', variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать студента</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>ФИО</Label>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div>
            <Label>Телефон</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label>Город</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label>Специальность</Label>
            <Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
          </div>
          <div>
            <Label>GPA</Label>
            <Input value={form.gpa} onChange={(e) => setForm({ ...form, gpa: e.target.value })} />
          </div>
          <div>
            <Label>Достижения</Label>
            <Textarea value={form.achievements_text} onChange={(e) => setForm({ ...form, achievements_text: e.target.value })} />
          </div>
          <div>
            <Label>Бюджет в год</Label>
            <Input value={form.budget_per_year} onChange={(e) => setForm({ ...form, budget_per_year: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
            {mutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceEditModal({
  service,
  open,
  onClose,
  mentors,
}: {
  service: Service
  open: boolean
  onClose: () => void
  mentors: Array<{ id: string; name: string }>
}) {
  const queryClient = useQueryClient()
  const { id: studentId } = useParams()
  const [form, setForm] = useState({
    status: service.status,
    result: service.result ?? '',
    notes: service.notes ?? '',
    assigned_mentor_id: service.assigned_mentor_id ?? '',
    portfolio_directions_count: service.portfolio_directions_count ?? 0,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      return servicesApi.update(service.id, {
        ...form,
        assigned_mentor_id:
          form.assigned_mentor_id && form.assigned_mentor_id !== 'none'
            ? form.assigned_mentor_id
            : undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', studentId] })
      toast({ title: 'Сохранено' })
      onClose()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {SERVICE_TYPE_LABELS[service.service_type]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Статус</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Service['status'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SERVICE_STATUS_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ментор</Label>
            <Select value={form.assigned_mentor_id || 'none'} onValueChange={(v) => setForm({ ...form, assigned_mentor_id: v })}>
              <SelectTrigger><SelectValue placeholder="Выберите ментора" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не назначен</SelectItem>
                {mentors.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Результат</Label>
            <Input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />
          </div>
          <div>
            <Label>Примечания</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const StudentCardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { canAccess, hasRole } = useAuth()
  const canEditProfile = canAccess('all_students')
  const canEditContract = hasRole('admin', 'mzk_manager')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveName, setArchiveName] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [editService, setEditService] = useState<Service | null>(null)
  const [revealedIins, setRevealedIins] = useState<Record<string, string>>({})
  const [revealConfirm, setRevealConfirm] = useState<string | null>(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [noteRole, setNoteRole] = useState<NoteVisibility>('admin_and_mzk')
  const [documentOpenId, setDocumentOpenId] = useState<string | null>(null)
  const [documentDeleteTarget, setDocumentDeleteTarget] = useState<Document | null>(null)
  const [documentDeletePending, setDocumentDeletePending] = useState(false)

  const { data: student, isLoading, error } = useQuery<StudentFull>({
    queryKey: ['student', id],
    queryFn: () => studentsApi.get(id!),
    enabled: !!id,
  })

  const { data: mentors = [] } = useQuery({
    queryKey: ['users', 'mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: history = [] } = useQuery({
    queryKey: ['history', 'student', id],
    queryFn: () => historyApi.list({ entity_type: 'student', entity_id: id! }),
    enabled: !!id && (hasRole('admin', 'mzk_manager', 'lead_mentor')),
  })

  const { data: intake } = useQuery({
    queryKey: ['intake', 'student', id],
    queryFn: () => syncApi.studentIntake(id!),
    enabled: !!id && hasRole('admin', 'mzk_manager'),
  })

  const { data: notion } = useQuery({
    queryKey: ['notion', 'student', id],
    queryFn: () => notionApi.studentNotion(id!),
    enabled: !!id && hasRole('admin', 'mzk_manager'),
  })

  const updateStudentFieldMutation = useMutation({
    // Record<string, unknown>: для очистки поля бэкенду нужен явный null,
    // которого нет в типах StudentFull (там поля string | undefined)
    mutationFn: (patch: Record<string, unknown>) =>
      studentsApi.update(id!, patch as Partial<StudentFull>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      toast({ title: 'Сохранено' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось сохранить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const updateContractFieldMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      contractsApi.update(student!.contracts![0].id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      toast({ title: 'Сохранено' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось сохранить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const unlinkNotionMutation = useMutation({
    mutationFn: (snapshotId: string) => notionApi.unlink(snapshotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notion'] })
      toast({
        title: 'Привязка к Notion снята',
        description: 'Запись вернулась в «Notion без привязки». Автосинк не привяжет её обратно.',
      })
    },
    onError: () => toast({ title: 'Не удалось отвязать', variant: 'destructive' }),
  })

  const archiveMutation = useMutation({
    mutationFn: () => studentsApi.archive(id!),
    onSuccess: () => {
      toast({ title: 'Студент архивирован' })
      navigate('/students')
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось архивировать', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const applyNotionFieldMutation = useMutation({
    mutationFn: (field: string) => notionApi.applyField(id!, field),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notion', 'student', id] })
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['history', 'student', id] })
      toast({ title: 'Значение принято из Notion' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось применить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const [attachChatOpen, setAttachChatOpen] = useState(false)
  const [selectedUnboundChatId, setSelectedUnboundChatId] = useState('')
  const [pairingResult, setPairingResult] = useState<TelegramPairingCode | null>(null)

  const { data: telegramChat } = useQuery({
    queryKey: ['telegram-chat', 'student', id],
    queryFn: () => telegramApi.getForStudent(id!),
    enabled: !!id && hasRole('admin', 'mzk_manager'),
  })

  const { data: unboundChats = [] } = useQuery({
    queryKey: ['telegram-chats', 'unbound'],
    queryFn: () => telegramApi.listUnbound(),
    enabled: attachChatOpen,
  })

  const { data: telegramMessages = [] } = useQuery({
    queryKey: ['telegram-chat', telegramChat?.id, 'messages'],
    queryFn: () => telegramApi.listMessages(telegramChat!.id),
    enabled: !!telegramChat?.id,
  })

  const attachChatMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.attach(chatId, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-chat', 'student', id] })
      setAttachChatOpen(false)
      setSelectedUnboundChatId('')
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось привязать чат', variant: 'destructive' }),
  })

  const pauseChatMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.pause(chatId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram-chat', 'student', id] }),
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось поставить на паузу', variant: 'destructive' }),
  })

  const closeChatMutation = useMutation({
    mutationFn: (chatId: string) => telegramApi.close(chatId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram-chat', 'student', id] }),
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось завершить сессию', variant: 'destructive' }),
  })

  const pairingCodeMutation = useMutation({
    mutationFn: () => telegramApi.createPairingCode(id!),
    onSuccess: (data) => setPairingResult(data),
    onError: () =>
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать ссылку — проверьте, настроен ли TELEGRAM_BOT_USERNAME',
        variant: 'destructive',
      }),
  })

  const assignSelfMutation = useMutation({
    mutationFn: () => mentorAssignmentsApi.assignSelf(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Студент добавлен в ваши' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось взять студента', variant: 'destructive' }),
  })

  const unassignSelfMutation = useMutation({
    mutationFn: () => mentorAssignmentsApi.setSelfActive(id!, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Студент снят с ваших' })
    },
    onError: () => toast({ title: 'Ошибка', description: 'Не удалось снять студента', variant: 'destructive' }),
  })

  const toggleTaskMutation = useMutation({
    mutationFn: (task: { id: string; status: 'open' | 'done' }) =>
      tasksApi.update(task.id, {
        status: task.status === 'open' ? 'done' : 'open',
        done_at: task.status === 'open' ? new Date().toISOString() : undefined,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['student', id] }),
  })

  const addTaskMutation = useMutation({
    mutationFn: (text: string) =>
      tasksApi.create(id!, { task_text: text, status: 'open' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      setNewTaskText('')
      setAddingTask(false)
    },
  })

  const addNoteMutation = useMutation({
    mutationFn: () =>
      confidentialNotesApi.create(id!, {
        note_text: newNote,
        visible_to_role: noteRole,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      setNewNote('')
      setAddingNote(false)
    },
  })

  const revealIin = async (guardianId: string) => {
    try {
      const result = await guardiansApi.revealIin(guardianId)
      setRevealedIins((prev) => ({ ...prev, [guardianId]: result.iin }))
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось раскрыть ИИН', variant: 'destructive' })
    }
    setRevealConfirm(null)
  }

  const handleExportStudent = async () => {
    if (!id) return
    try {
      const blob = await studentsApi.exportOne(id)
      downloadBlob(blob, `student-${id}.xlsx`)
    } catch {
      toast({ title: 'Ошибка', description: 'Ошибка экспорта', variant: 'destructive' })
    }
  }

  const handleOpenDocument = async (doc: Document) => {
    setDocumentOpenId(doc.id)
    try {
      const blob = await documentsApi.download(doc.id)
      const url = URL.createObjectURL(blob)
      const tab = window.open(url, '_blank', 'noopener,noreferrer')
      if (!tab) {
        downloadBlob(blob, doc.file_name)
      } else {
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось открыть документ', variant: 'destructive' })
    } finally {
      setDocumentOpenId(null)
    }
  }

  const handleDeleteDocument = async () => {
    if (!documentDeleteTarget) return
    setDocumentDeletePending(true)
    try {
      await documentsApi.delete(documentDeleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      toast({ title: 'Удалено', description: 'Документ удалён из карточки' })
      setDocumentDeleteTarget(null)
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось удалить документ', variant: 'destructive' })
    } finally {
      setDocumentDeletePending(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Загрузка...</div>
      </div>
    )
  }

  if (error || !student) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Студент не найден</p>
        <Link to="/students" className="text-gray-600 hover:text-black underline underline-offset-4 text-sm mt-2 block">
          Вернуться к списку
        </Link>
      </div>
    )
  }

  const contract = student.contracts?.[0]
  const portfolio = student.portfolio_progress

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/students" className="flex items-center text-gray-500 hover:text-black text-sm transition-colors">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Назад
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl text-gray-900 tracking-tight">{student.full_name}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
              {DEGREE_LEVEL_LABELS[student.degree_level]}
            </span>
            {student.pipeline_status && (
              <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                {PIPELINE_STATUS_LABELS[student.pipeline_status]}
              </span>
            )}
          </div>
        </div>
        <Button
          variant={student.is_mine ? 'outline' : 'default'}
          size="sm"
          disabled={assignSelfMutation.isPending || unassignSelfMutation.isPending}
          onClick={() => {
            if (student.is_mine) unassignSelfMutation.mutate()
            else assignSelfMutation.mutate()
          }}
        >
          {student.is_mine ? '★ Мой студент' : '☆ Взять в работу'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportStudent}>
          <Download className="w-4 h-4 mr-2" />
          Экспорт
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={`/notes?student_id=${student.id}&create=1`}>
            <BookText className="w-4 h-4 mr-2" />
            Конспекты
          </Link>
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={['profile', 'applications', 'services', 'tasks']} className="space-y-2">
        <AccordionItem value="responsibles" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Ответственные
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3">
              {student.responsibles && student.responsibles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {student.responsibles.map((responsible) => (
                    <span
                      key={responsible.assignment_id || responsible.id}
                      className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 text-xs ${
                        responsible.is_active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-gray-50 text-gray-400'
                      }`}
                    >
                      {responsible.name || 'Без имени'}
                      <span className="text-[10px] uppercase tracking-wide opacity-70">
                        {responsible.is_active ? 'активен' : 'снят'}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Ответственные не назначены</p>
              )}
              <Button
                variant={student.is_mine ? 'outline' : 'default'}
                size="sm"
                disabled={assignSelfMutation.isPending || unassignSelfMutation.isPending}
                onClick={() => {
                  if (student.is_mine) unassignSelfMutation.mutate()
                  else assignSelfMutation.mutate()
                }}
              >
                {student.is_mine ? 'Снять с моих' : 'Добавить себя'}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 0. Сверка анкет: менеджер vs студент vs CRM */}
        {intake && (intake.package || intake.cases) && (
          <AccordionItem value="intake" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              Сверка анкет
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
                <span>
                  Пакет (менеджер):{' '}
                  {intake.package
                    ? `${intake.package.manager_name ?? '—'} · ${intake.package.submitted_at ? new Date(intake.package.submitted_at).toLocaleDateString('ru-RU') : ''}`
                    : 'анкеты нет'}
                </span>
                <span>
                  Кейс (студент):{' '}
                  {intake.cases
                    ? `${intake.cases.submitted_at ? new Date(intake.cases.submitted_at).toLocaleDateString('ru-RU') : 'есть'}`
                    : 'анкеты нет'}
                </span>
              </div>
              <div className="border border-gray-200 rounded-[2px] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-3 py-2 label-caps font-medium w-44">Поле</th>
                      {intake.package && (
                        <th className="text-left px-3 py-2 label-caps font-medium">Менеджер · Пакет</th>
                      )}
                      {intake.cases && (
                        <th className="text-left px-3 py-2 label-caps font-medium">Студент · Кейс</th>
                      )}
                      <th className="text-left px-3 py-2 label-caps font-medium">CRM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intake.comparison.map((row) => {
                      const crmMatches = row.crm_matches ?? false
                      const aiSuggestsSame = row.mismatch && row.ai_same_meaning === true
                      const realMismatch = row.mismatch && !aiSuggestsSame
                      return (
                        <tr
                          key={row.field}
                          className={`border-b border-gray-100 last:border-0 ${
                            realMismatch ? 'bg-amber-50' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-gray-500 align-top whitespace-nowrap">
                            {row.label}
                            {row.human_only && (
                              <span className="block text-[10px] text-gray-400 mt-0.5">
                                🔒 вносится вручную
                              </span>
                            )}
                            {realMismatch && (
                              <span className="block text-[10px] text-amber-600 mt-0.5">
                                расхождение
                              </span>
                            )}
                            {aiSuggestsSame && (
                              <span className="block text-[10px] text-sky-600 mt-0.5" title={row.ai_note ?? undefined}>
                                вероятно совпадает{row.ai_note ? ` · ${row.ai_note}` : ''}
                              </span>
                            )}
                          </td>
                          {intake.package && (
                            <td className="px-3 py-2 text-gray-800 align-top">
                              {row.package ?? <span className="text-gray-400">—</span>}
                            </td>
                          )}
                          {intake.cases && (
                            <td className="px-3 py-2 text-gray-800 align-top">
                              {row.cases ?? <span className="text-gray-400">—</span>}
                            </td>
                          )}
                          <td className="px-3 py-2 text-gray-500 align-top">
                            {crmMatches ? (
                              <span className="text-emerald-600/80 text-xs">✓ совпадает</span>
                            ) : row.crm_ai_same_meaning ? (
                              <span className="text-sky-600 text-xs" title={row.crm_ai_note ?? undefined}>
                                ✓ вероятно совпадает{row.crm_ai_note ? ` · ${row.crm_ai_note}` : ''}
                              </span>
                            ) : (
                              row.crm ?? <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2.5">
                Жёлтым подсвечены поля, где ответы менеджера и студента не совпадают. Стоимость и
                договорённости в CRM вносятся только вручную.
              </p>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 0.5 Notion: сверка «Notion | CRM» + финансы из Notion */}
        {notion?.snapshot && (
          <AccordionItem value="notion" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              <span className="flex items-center gap-2.5">
                Notion
                {notion.comparison.some((r) => r.matches === false) && (
                  <span className="text-[10px] font-medium normal-case tracking-normal px-1.5 py-0.5 rounded-[2px] bg-amber-50 text-amber-700 border border-amber-200">
                    есть расхождения
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-xs text-gray-500">
                  Синхронизировано:{' '}
                  {notion.snapshot.synced_at
                    ? new Date(notion.snapshot.synced_at).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                  {notion.snapshot.notion_last_edited_at &&
                    ` · изменено в Notion: ${new Date(notion.snapshot.notion_last_edited_at).toLocaleDateString('ru-RU')}`}
                </p>
                <div className="flex items-center gap-3">
                  {notion.snapshot.notion_url && (
                    <a
                      href={notion.snapshot.notion_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gray-500 underline hover:text-black"
                    >
                      Открыть в Notion
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] text-gray-500"
                    disabled={unlinkNotionMutation.isPending}
                    title="Если запись Notion привязана не к тому студенту"
                    onClick={() => unlinkNotionMutation.mutate(notion.snapshot!.id)}
                  >
                    <Link2Off className="w-3 h-3 mr-1" />
                    Отвязать
                  </Button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-[2px] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-3 py-2 label-caps font-medium w-44">Поле</th>
                      <th className="text-left px-3 py-2 label-caps font-medium">Notion</th>
                      <th className="text-left px-3 py-2 label-caps font-medium">CRM</th>
                      <th className="w-32" />
                    </tr>
                  </thead>
                  <tbody>
                    {notion.comparison.map((row) => (
                      <tr
                        key={row.field}
                        className={`border-b border-gray-100 last:border-0 ${
                          row.matches === false ? 'bg-amber-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-gray-500 align-top whitespace-nowrap">
                          {row.label}
                          {row.matches === false && (
                            <span className="block text-[10px] text-amber-600 mt-0.5">расхождение</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-800 align-top">
                          {row.notion ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {row.matches ? (
                            <span className="text-emerald-600/80 text-xs">✓ совпадает</span>
                          ) : (
                            <span className="text-gray-500">{row.crm ?? <span className="text-gray-400">—</span>}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          {row.matches === false && row.can_apply && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px]"
                              disabled={applyNotionFieldMutation.isPending}
                              onClick={() => applyNotionFieldMutation.mutate(row.field)}
                            >
                              Принять из Notion
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {notion.finance.length > 0 && (
                <div className="mt-4">
                  <p className="label-caps mb-2">Финансы из Notion · только просмотр</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-gray-200 border border-gray-200 rounded-[2px] overflow-hidden">
                    {notion.finance.map((f) => (
                      <div key={f.label} className="bg-white px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">{f.label}</p>
                        <p className="text-sm text-gray-900 font-medium mt-0.5">{f.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2.5">
                Notion — источник по финансам, CRM назад в Notion не пишет. Кнопка «Принять из Notion»
                переносит значение в карточку вручную, каждое изменение попадает в историю.
              </p>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 1. Profile */}
        <AccordionItem value="profile" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Профиль студента
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex justify-end gap-2 mb-2">
              {hasRole('admin') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    setArchiveName('')
                    setArchiveOpen(true)
                  }}
                >
                  <Trash2 className="w-3 h-3 mr-2" />
                  Архивировать
                </Button>
              )}
              {canAccess('all_students') && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Edit2 className="w-3 h-3 mr-2" />
                  Редактировать
                </Button>
              )}
            </div>
            <EditableInfoRow label="ФИО" display={student.full_name} canEdit={canEditProfile}
              onSave={(v) => v && updateStudentFieldMutation.mutate({ full_name: v })} />
            <EditableInfoRow label="Телефон" display={student.phone} canEdit={canEditProfile}
              onSave={(v) => updateStudentFieldMutation.mutate({ phone: v })} />
            <EditableInfoRow label="Город" display={student.city} canEdit={canEditProfile}
              onSave={(v) => updateStudentFieldMutation.mutate({ city: v || null })} />
            <EditableInfoRow label="Уровень" display={DEGREE_LEVEL_LABELS[student.degree_level]}
              editValue={student.degree_level} canEdit={canEditProfile} type="select"
              options={Object.entries(DEGREE_LEVEL_LABELS).map(([value, label]) => ({ value, label }))}
              onSave={(v) => updateStudentFieldMutation.mutate({ degree_level: v as StudentFull['degree_level'] })} />
            <EditableInfoRow label="Год поступления" display={student.intake_year} canEdit={canEditProfile} type="number"
              onSave={(v) => {
                const year = Number.parseInt(v, 10)
                if (!year || year < 2000 || year > 2100) {
                  toast({ title: 'Некорректный год', description: v, variant: 'destructive' })
                  return
                }
                updateStudentFieldMutation.mutate({ intake_year: year })
              }} />
            <EditableInfoRow label="Специальность" display={student.specialty} canEdit={canEditProfile}
              onSave={(v) => updateStudentFieldMutation.mutate({ specialty: v || null })} />
            <EditableInfoRow label="GPA" display={student.gpa} canEdit={canEditProfile}
              onSave={(v) => updateStudentFieldMutation.mutate({ gpa: v || null })} />
            <EditableInfoRow label="Бюджет/год" display={student.budget_per_year} canEdit={canEditProfile}
              onSave={(v) => updateStudentFieldMutation.mutate({ budget_per_year: v || null })} />
            <EditableInfoRow label="Достижения" display={student.achievements_text} canEdit={canEditProfile} type="textarea"
              onSave={(v) => updateStudentFieldMutation.mutate({ achievements_text: v || null })} />
            <InfoRow label="Дней в работе" value={student.days_in_work} />

            {canAccess('guardians') && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Родители / Опекуны</h3>
                </div>
                {student.guardians && student.guardians.length > 0 ? (
                  <div className="overflow-hidden rounded-[2px] border border-gray-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ФИО</TableHead>
                          <TableHead>Отношение</TableHead>
                          <TableHead>Телефон</TableHead>
                          <TableHead>ИИН</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {student.guardians.map((g: Guardian) => (
                          <TableRow key={g.id}>
                            <TableCell className="font-medium">{g.full_name}</TableCell>
                            <TableCell>{g.relation}</TableCell>
                            <TableCell>{g.phone}</TableCell>
                            <TableCell className="font-mono text-sm">
                              {revealedIins[g.id] ?? g.iin_masked ?? '***'}
                            </TableCell>
                            <TableCell>
                              {!revealedIins[g.id] && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRevealConfirm(g.id)}
                                >
                                  <Eye className="w-3 h-3 mr-1" />
                                  Раскрыть
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Опекуны не добавлены</p>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 3. Contract */}
        {canAccess('finances') && contract && (
          <AccordionItem value="contract" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              Договор
            </AccordionTrigger>
            <AccordionContent>
              <EditableInfoRow label="Дата подписания" display={formatDate(contract.signed_date)}
                editValue={contract.signed_date ? String(contract.signed_date).slice(0, 10) : ''}
                canEdit={canEditContract} type="date"
                onSave={(v) => updateContractFieldMutation.mutate({ signed_date: v || null })} />
              <EditableInfoRow label="Сумма" display={formatCurrency(contract.amount, contract.currency)}
                editValue={contract.amount ?? ''} canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ amount: v || null })} />
              <EditableInfoRow label="Валюта" display={contract.currency} canEdit={canEditContract}
                onSave={(v) => v && updateContractFieldMutation.mutate({ currency: v.toUpperCase() })} />
              <EditableInfoRow label="Статус"
                display={contract.pipeline_status ? PIPELINE_STATUS_LABELS[contract.pipeline_status] : '—'}
                editValue={contract.pipeline_status ?? ''} canEdit={canEditContract} type="select"
                options={Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                onSave={(v) => updateContractFieldMutation.mutate({ pipeline_status: v })} />
              <EditableInfoRow label="IELTS включён" display={contract.ielts_payment_included ? 'Да' : 'Нет'}
                editValue={contract.ielts_payment_included ? 'true' : 'false'} canEdit={canEditContract} type="select"
                options={[{ value: 'true', label: 'Да' }, { value: 'false', label: 'Нет' }]}
                onSave={(v) => updateContractFieldMutation.mutate({ ielts_payment_included: v === 'true' })} />
              <EditableInfoRow label="Сумма англ." display={contract.english_sum}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ english_sum: v || null })} />
              <EditableInfoRow label="Оплачено англ." display={contract.english_paid}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ english_paid: v || null })} />
              <EditableInfoRow label="Остаток клиент" display={contract.client_remaining_amount}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ client_remaining_amount: v || null })} />
              <EditableInfoRow label="Дата остатка" display={formatDate(contract.client_remaining_date)}
                editValue={contract.client_remaining_date ? String(contract.client_remaining_date).slice(0, 10) : ''}
                canEdit={canEditContract} type="date"
                onSave={(v) => updateContractFieldMutation.mutate({ client_remaining_date: v || null })} />
              <EditableInfoRow label="Ментору итого" display={contract.mentor_total_owed}
                canEdit={canEditContract} type="number"
                onSave={(v) => updateContractFieldMutation.mutate({ mentor_total_owed: v || null })} />
              <EditableInfoRow label="Примечания" display={contract.notes} canEdit={canEditContract} type="textarea"
                onSave={(v) => updateContractFieldMutation.mutate({ notes: v || null })} />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 4. Finances */}
        {canAccess('finances') && contract && (
          <AccordionItem value="finances" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              Финансы
            </AccordionTrigger>
            <AccordionContent>
              {contract.payments && contract.payments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Тип</TableHead>
                      <TableHead>Сумма</TableHead>
                      <TableHead>Валюта</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Дата</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contract.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.type}</TableCell>
                        <TableCell className="font-medium">{p.amount}</TableCell>
                        <TableCell>{p.currency}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {p.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-gray-500">{formatDate(p.paid_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-gray-500 py-2">Платежи не найдены</p>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 5. Applications */}
        <AccordionItem value="applications" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Заявки в вузы
          </AccordionTrigger>
          <AccordionContent>
            {student.applications && student.applications.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Страна</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Подано</TableHead>
                    <TableHead>Виза</TableHead>
                    <TableHead>Основная</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {student.applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-medium">{app.country}</TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-600">
                          {SUBMISSION_STATUS_LABELS[app.submission_status]}
                        </span>
                      </TableCell>
                      <TableCell>
                        {app.submissions_done}/{app.submissions_planned}
                      </TableCell>
                      <TableCell className="text-gray-500">{app.visa_status ?? '—'}</TableCell>
                      <TableCell>
                        {app.is_primary && <Check className="w-4 h-4 text-green-600" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-gray-500 py-2">Заявки не добавлены</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 6. Services */}
        <AccordionItem value="services" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Услуги
          </AccordionTrigger>
          <AccordionContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Услуга</TableHead>
                  <TableHead>Включена</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Результат</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {student.services && student.services.length > 0 ? (
                  student.services.map((svc) => (
                    <TableRow key={svc.id}>
                      <TableCell className="font-medium">
                        {SERVICE_TYPE_LABELS[svc.service_type]}
                      </TableCell>
                      <TableCell>
                        {svc.included ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <X className="w-4 h-4 text-gray-500" />
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-600">
                          {SERVICE_STATUS_LABELS[svc.status]}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm">{svc.result ?? '—'}</TableCell>
                      <TableCell>
                        {canAccess('all_students') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditService(svc)}
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500 text-sm py-4">
                      Услуги не настроены
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>

        {/* 7. Portfolio UP */}
        <AccordionItem value="portfolio" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Portfolio UP
          </AccordionTrigger>
          <AccordionContent>
            {portfolio ? (
              <div className="space-y-3">
                <InfoRow label="Группа VPP" value={portfolio.vpp_group} />
                <InfoRow label="Статус" value={portfolio.status} />
                <InfoRow label="Дедлайн" value={portfolio.deadline_text} />
                <InfoRow label="Первый звонок" value={portfolio.first_call_milestone} />
                {portfolio.special_notes && (
                  <InfoRow label="Особые заметки" value={portfolio.special_notes} />
                )}
                <div className="flex items-center gap-4 py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-500 w-48 shrink-0">Достижения</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          achievements_count: Math.max(0, portfolio.achievements_count - 1),
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="font-semibold text-lg w-8 text-center">
                      {portfolio.achievements_count}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          achievements_count: portfolio.achievements_count + 1,
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-4 py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-500 w-48 shrink-0">Звонки</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          calls_count: Math.max(0, portfolio.calls_count - 1),
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="font-semibold text-lg w-8 text-center">
                      {portfolio.calls_count}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await portfolioApi.update(portfolio.id, {
                          calls_count: portfolio.calls_count + 1,
                        })
                        queryClient.invalidateQueries({ queryKey: ['student', id] })
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {portfolio.focus_areas && portfolio.focus_areas.length > 0 && (
                  <div className="py-2">
                    <span className="text-sm text-gray-500 block mb-2">Направления</span>
                    <div className="flex flex-wrap gap-2">
                      {portfolio.focus_areas.map((area, i) => (
                        <span key={i} className="px-3 py-1 bg-sky-50 text-sky-700 border border-sky-200 text-xs rounded-[2px]">
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-2">Portfolio UP не настроено</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 8. Documents */}
        <AccordionItem value="documents" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Документы
          </AccordionTrigger>
          <AccordionContent>
            {student.documents && student.documents.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {student.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="border border-gray-200 rounded-[2px] p-3 bg-gray-50 flex flex-col gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{doc.file_name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {DOC_TYPE_LABELS[doc.doc_type as keyof typeof DOC_TYPE_LABELS] ?? doc.doc_type}
                        {' · '}
                        {formatFileSize(doc.file_size)}
                        {' · '}
                        {doc.source}
                      </p>
                      {doc.is_verified && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 mt-2">
                          <Check className="w-3 h-3" />
                          Проверен
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => handleOpenDocument(doc)}
                        disabled={documentOpenId === doc.id}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        {documentOpenId === doc.id ? 'Открытие…' : 'Открыть'}
                      </Button>
                      {canAccess('all_students') && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          onClick={() => setDocumentDeleteTarget(doc)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-2">Документы не загружены</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 9b. Telegram */}
        {hasRole('admin', 'mzk_manager') && (
          <AccordionItem value="telegram" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              <span className="flex items-center gap-2.5">
                Telegram
                {telegramChat && telegramChat.status !== 'closed' ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-[2px] font-medium uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {telegramChat.status === 'active' ? 'подключён' : 'на паузе'}
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-[2px] font-medium uppercase tracking-wide bg-gray-50 text-gray-500 border border-gray-200">
                    не привязан
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {telegramChat && telegramChat.status !== 'closed' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-[2px] border border-gray-200 bg-gray-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {telegramChat.title || `Чат ${telegramChat.chat_id}`}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{telegramChat.chat_type}</p>
                    </div>
                    <div className="flex gap-2">
                      {telegramChat.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pauseChatMutation.mutate(telegramChat.id)}
                          disabled={pauseChatMutation.isPending}
                        >
                          <Pause className="w-3.5 h-3.5 mr-1.5" />
                          Пауза
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => attachChatMutation.mutate(telegramChat.id)}
                          disabled={attachChatMutation.isPending}
                        >
                          Возобновить
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => closeChatMutation.mutate(telegramChat.id)}
                        disabled={closeChatMutation.isPending}
                      >
                        <Link2Off className="w-3.5 h-3.5 mr-1.5" />
                        Завершить
                      </Button>
                    </div>
                  </div>

                  {telegramMessages.length > 0 ? (
                    <div className="space-y-2">
                      {telegramMessages.slice(-10).map((m) => (
                        <div key={m.id} className="text-sm border border-gray-200 rounded-[2px] p-2 bg-white">
                          <p className="text-[11px] text-gray-500 mb-0.5">
                            {m.sender_name || 'Без имени'} · {formatDate(m.created_at)}
                          </p>
                          <p className="text-gray-700">{m.raw_text || `[${m.message_type}]`}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 py-1">Сообщений пока нет</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAttachChatOpen(true)}>
                      Привязать существующий чат
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => pairingCodeMutation.mutate()}
                      disabled={pairingCodeMutation.isPending}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      Создать ссылку-код
                    </Button>
                  </div>
                  {pairingResult && (
                    <div className="rounded-[2px] border border-gray-200 bg-gray-50 p-3 text-sm">
                      <p className="text-gray-700 break-all">{pairingResult.deep_link}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Действует до {new Date(pairingResult.expires_at).toLocaleString('ru-RU')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 10. Notes */}
        <AccordionItem value="notes" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Конспекты
          </AccordionTrigger>
          <AccordionContent>
            {student.notes && student.notes.length > 0 ? (
              <div className="space-y-3">
                {student.notes.map((note) => (
                  <div key={note.id} className="border border-gray-200 rounded-[2px] p-3 bg-gray-50/50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          to={`/notes/${note.id}`}
                          className="font-medium text-gray-900 hover:text-black underline underline-offset-4"
                        >
                          {note.title}
                        </Link>
                        <p className="text-xs text-gray-500 mt-1">
                          {note.status} · {formatDate(note.created_at)}
                        </p>
                      </div>
                      <Link to={`/notes/${note.id}`} className="text-xs text-gray-600 hover:text-black underline underline-offset-4">
                        Открыть
                      </Link>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-3">
                      {stripMarkdown(note.summary_markdown)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-2">Конспектов пока нет</p>
            )}
            <div className="mt-3">
              <Button asChild variant="outline" size="sm">
                <Link to={`/notes?student_id=${student.id}&create=1`}>
                  <Plus className="w-3 h-3 mr-2" />
                  Новый конспект
                </Link>
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 11. Confidential notes */}
        {canAccess('confidential') && (
          <AccordionItem value="confidential" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-orange-600" />
                Конфиденциальные заметки
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 mb-4">
                {student.confidential_notes && student.confidential_notes.map((note) => (
                  <div key={note.id} className="bg-orange-50 border border-orange-100 rounded-lg p-3">
                    <p className="text-sm text-gray-800">{note.note_text}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Видят: {note.visible_to_role} · {formatDate(note.created_at)}
                    </p>
                  </div>
                ))}
              </div>

              {!addingNote ? (
                <Button variant="outline" size="sm" onClick={() => setAddingNote(true)}>
                  <Plus className="w-3 h-3 mr-2" />
                  Добавить заметку
                </Button>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    placeholder="Конфиденциальная заметка..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Select value={noteRole} onValueChange={(v) => setNoteRole(v as NoteVisibility)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin_only">Только admin</SelectItem>
                        <SelectItem value="admin_and_mzk">Admin и MZK</SelectItem>
                        <SelectItem value="all_mentors">Все менторы</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => addNoteMutation.mutate()}
                      disabled={!newNote.trim() || addNoteMutation.isPending}
                    >
                      Сохранить
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setAddingNote(false); setNewNote('') }}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* 12. Tasks */}
        <AccordionItem value="tasks" className="border border-gray-200 rounded-[2px] px-4">
          <AccordionTrigger className="text-base font-semibold">
            Задачи
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 mb-3">
              {student.student_tasks && student.student_tasks.length > 0 ? (
                student.student_tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                    <Checkbox
                      checked={task.status === 'done'}
                      onCheckedChange={() => toggleTaskMutation.mutate(task)}
                      disabled={!canAccess('tasks_create')}
                    />
                    <div className="flex-1">
                      <p className={`text-sm ${task.status === 'done' ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                        {task.task_text}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(task.created_at)}
                        {task.done_at && ` · Выполнено ${formatDate(task.done_at)}`}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">Задач нет</p>
              )}
            </div>

            {canAccess('tasks_create') && (
              !addingTask ? (
                <Button variant="outline" size="sm" onClick={() => setAddingTask(true)}>
                  <Plus className="w-3 h-3 mr-2" />
                  Добавить задачу
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Текст задачи..."
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTaskText.trim()) {
                        addTaskMutation.mutate(newTaskText)
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={() => addTaskMutation.mutate(newTaskText)}
                    disabled={!newTaskText.trim() || addTaskMutation.isPending}
                  >
                    Добавить
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setAddingTask(false); setNewTaskText('') }}>
                    Отмена
                  </Button>
                </div>
              )
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 12. History */}
        {hasRole('admin', 'mzk_manager', 'lead_mentor') && (
          <AccordionItem value="history" className="border border-gray-200 rounded-[2px] px-4">
            <AccordionTrigger className="text-base font-semibold">
              История изменений
            </AccordionTrigger>
            <AccordionContent>
              {history.length > 0 ? (
                <div className="space-y-2">
                  {history.map((entry) => (
                    <div key={entry.id} className="border-l-2 border-gray-200 pl-3 py-1">
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">{entry.field_changed}</span>
                        <span className="text-gray-500">
                          {' '}
                          {entry.old_value ?? '—'} → {entry.new_value ?? '—'}
                        </span>
                        {entry.source && (
                          <span className="text-gray-500"> · {entry.source}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(entry.changed_at)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-2">История пуста</p>
              )}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* Edit student modal */}
      {editOpen && (
        <EditStudentModal
          student={student}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* Archive confirm: требуется ввести полное имя */}
      <Dialog open={archiveOpen} onOpenChange={(open) => !open && setArchiveOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Архивировать студента?</DialogTitle>
            <DialogDescription>
              Студент исчезнет из списков, но данные сохранятся. Чтобы подтвердить,
              введи полное имя: <span className="font-semibold text-gray-900">{student.full_name}</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Полное имя студента"
            value={archiveName}
            onChange={(e) => setArchiveName(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={
                archiveName.trim().toLowerCase() !== student.full_name.trim().toLowerCase() ||
                archiveMutation.isPending
              }
              onClick={() => archiveMutation.mutate()}
            >
              {archiveMutation.isPending ? 'Архивируем…' : 'Архивировать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit service modal */}
      {editService && (
        <ServiceEditModal
          service={editService}
          open={!!editService}
          onClose={() => setEditService(null)}
          mentors={mentors}
        />
      )}

      {/* Reveal IIN confirm dialog */}
      <Dialog open={!!revealConfirm} onOpenChange={() => setRevealConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Раскрыть ИИН</DialogTitle>
            <DialogDescription>
              ИИН является персональными данными. Убедитесь в необходимости просмотра. Это действие будет записано в журнал.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevealConfirm(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => revealConfirm && revealIin(revealConfirm)}
            >
              Раскрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!documentDeleteTarget} onOpenChange={() => setDocumentDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить документ?</DialogTitle>
            <DialogDescription>
              {documentDeleteTarget?.file_name} будет удалён из карточки студента и из хранилища.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteDocument}
              disabled={documentDeletePending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach unbound Telegram chat dialog */}
      <Dialog open={attachChatOpen} onOpenChange={setAttachChatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Привязать Telegram-чат</DialogTitle>
            <DialogDescription>
              Выберите чат из списка непривязанных — бота должны были уже добавить в этот чат.
            </DialogDescription>
          </DialogHeader>
          {unboundChats.length > 0 ? (
            <Select value={selectedUnboundChatId} onValueChange={setSelectedUnboundChatId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите чат" />
              </SelectTrigger>
              <SelectContent>
                {unboundChats.map((chat) => (
                  <SelectItem key={chat.id} value={chat.id}>
                    {chat.title || `Чат ${chat.chat_id}`} ({chat.chat_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-gray-500">Непривязанных чатов пока нет.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachChatOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!selectedUnboundChatId || attachChatMutation.isPending}
              onClick={() => attachChatMutation.mutate(selectedUnboundChatId)}
            >
              Привязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
