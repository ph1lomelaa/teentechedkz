import React, { useState, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download, Search, RefreshCw, RotateCw, Inbox, EyeOff, Eye, CheckCheck, Filter, X, UserPlus, LayoutGrid } from 'lucide-react'
import { studentsApi } from '@/api/students'
import { mentorAssignmentsApi, usersApi } from '@/api/index'
import { syncApi, IntakeSubmission, SheetCounters } from '@/api/sync'
import { notionApi, NotionSnapshotItem } from '@/api/notion'
import { useAuth } from '@/contexts/AuthContext'
import { useLocalState } from '@/lib/use-local-state'
import {
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  SERVICE_TYPE_LABELS,
  SERVICE_STATUS_LABELS,
  ROLE_LABELS,
  MENTOR_ROLE_LABELS,
  ResponsibleUser,
  ASSIGNABLE_MENTOR_ROLES,
  splitAssignCandidates,
  ServiceType,
  StudentListItem,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { PageHeader } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/primitives/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import { downloadBlob } from '@/lib/utils'
import { debounce } from '@/lib/utils'
import { fuzzyStudentMatch } from '@/lib/fuzzyName'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { ReplacementReasonDialog } from '@/components/students/ReplacementReasonDialog'

const SOURCE_LABELS: Record<string, string> = {
  package: 'Пакет (менеджер)',
  cases: 'Кейс (студент)',
}

type ResponsibleRoleFilter = 'any' | 'mzk_manager' | 'lead_mentor' | 'mentor'
type ScopeFilter = 'all' | 'mine' | 'assigned' | 'unassigned'
export type OperationalFilter = 'all' | 'no_roadmap' | 'no_meeting' | 'telegram_unlinked' | 'open_tasks' | 'docs_review' | 'overdue_tasks' | 'open_complaints' | 'renewal' | 'name_only_mentor'
/**
 * Один сигнал операционного фильтра «Контроль работы» — чистая функция ради
 * юнит-теста: подмешать сюда что-то новое и забыть проверить границу («0»
 * не равно «есть», null не равно false) — ровно тот класс ошибок, который
 * незаметен в JSX и заметен в тесте.
 */
/**
 * Действующие ответственные студента, МЗК первым.
 *
 * МЗК ведёт студента целиком и отвечает за него перед клиентом — в колонке из
 * пяти пилюль он должен читаться первым, а не тем, кого раньше назначили.
 * Порядок остальных сохраняем как пришёл: он уже отсортирован по дате.
 */
export function activeResponsibles(s: StudentListItem): ResponsibleUser[] {
  const active = (s.responsibles ?? []).filter((r) => r.is_active)
  return [...active].sort((a, b) => Number(b.role === 'mzk') - Number(a.role === 'mzk'))
}

export function matchesOperationalFilter(s: StudentListItem, filter: OperationalFilter): boolean {
  switch (filter) {
    case 'no_roadmap':
      return !s.roadmap?.id
    case 'no_meeting':
      return !s.next_meeting
    case 'telegram_unlinked':
      return !s.telegram?.linked
    case 'open_tasks':
      return (s.open_tasks_count ?? 0) > 0
    case 'overdue_tasks':
      return !!s.has_overdue_tasks
    case 'open_complaints':
      return !!s.has_open_complaints
    case 'docs_review':
      return (s.documents_unverified ?? 0) > 0
    // «Контракт 500»: risk_category уже считается на бэке (students.py,
    // RENEWAL_THRESHOLD_DAYS = 500) и виден на «Рисках» — здесь его не
    // было ни разу, хотя это тот же самый список студентов, отобранный
    // тем же сигналом. Значение то же ('renewal'), что и у AtRiskStudentsPage,
    // а не отдельная строка 'contract_500' — иначе два места одной и той же
    // проверки снова разошлись бы по имени.
    case 'renewal':
      return s.risk_category === 'renewal'
    // Ментор есть текстом (импорт из Notion), но настоящего назначения нет —
    // такой ментор студента у себя не видит. В списке это неотличимо от
    // нормально назначенного, поэтому нужен способ собрать весь бэклог разом.
    case 'name_only_mentor':
      return activeResponsibles(s).length === 0 && (s.mentors?.length ?? 0) > 0
    default:
      return true
  }
}

const SERVICE_FILTER_OPTIONS: ServiceType[] = [
  'proforientation',
  'ielts_mock',
  'ielts_prep',
  'sat_prep',
  'portfolio_improvement',
  'english_general',
]

/** Диалог привязки входящей анкеты к студенту */
function LinkDialog({
  submission,
  onClose,
}: {
  submission: IntakeSubmission
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(submission.suggested_student_id ?? '')

  const { data: allStudents = [] } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const filtered = useMemo(() => {
    const q = query.trim()
    const base = q ? allStudents.filter((s) => fuzzyStudentMatch(q, s.full_name, s.phone)) : allStudents
    // Предложенный кандидат — всегда первым в списке
    const suggested = submission.suggested_student_id
      ? allStudents.find((s) => s.id === submission.suggested_student_id)
      : undefined
    const rest = suggested ? base.filter((s) => s.id !== suggested.id) : base
    return (suggested ? [suggested, ...rest] : rest).slice(0, 30)
  }, [allStudents, query, submission.suggested_student_id])

  const linkMutation = useMutation({
    mutationFn: () => syncApi.link(submission.id, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      toast({ title: 'Анкета привязана' })
      onClose()
    },
    onError: (err) => toast({ title: 'Ошибка привязки', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать анкету</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-p-muted">
            {SOURCE_LABELS[submission.source]} · <span className="text-p-text">{submission.full_name}</span>
          </p>
          {submission.suggested_student_name && (
            <p className="text-xs text-emerald-700">
              Предложение: {submission.suggested_student_name}
              {submission.suggested_confidence != null &&
                ` (${Math.round(submission.suggested_confidence * 100)}%)`}
            </p>
          )}
          <Input
            placeholder="Поиск студента..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto border border-p-line rounded-panel divide-y divide-gray-100">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-black text-white'
                    : 'text-p-text hover:bg-p-bg'
                }`}
              >
                {s.full_name}
                <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-p-muted text-xs ml-2'}>
                  {s.intake_year}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-p-muted">Не найдено</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!selectedId || linkMutation.isPending}
          >
            {linkMutation.isPending ? 'Привязываем…' : 'Привязать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Панель входящих анкет (status=new) */
function IntakeInbox() {
  const qc = useQueryClient()
  const [linkTarget, setLinkTarget] = useState<IntakeSubmission | null>(null)
  const [ignoreTarget, setIgnoreTarget] = useState<IntakeSubmission | null>(null)
  const [intakeView, setIntakeView] = useState<'new' | 'hidden' | 'all'>('new')
  const [confirmLinkAll, setConfirmLinkAll] = useState(false)
  const [confirmCreateAll, setConfirmCreateAll] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['intake', 'inbox', intakeView],
    queryFn: () =>
      syncApi.submissions({
        status: intakeView === 'hidden' ? 'ignored' : intakeView === 'all' ? 'all' : 'new',
        size: 100,
      }),
  })

  const bulkLinkMutation = useMutation({
    mutationFn: () => syncApi.linkAll({ status: 'new' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      setConfirmLinkAll(false)
      toast({
        title: 'Совпадения привязаны',
        description: `Привязано: ${res.linked}${res.skipped ? ` · пропущено: ${res.skipped}` : ''}`,
      })
    },
    onError: (err) => toast({ title: 'Не удалось привязать все совпадения', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => syncApi.ignore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      setIgnoreTarget(null)
      toast({ title: 'Анкета скрыта' })
    },
    onError: (err) => toast({ title: 'Не удалось скрыть анкету', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const createMutation = useMutation({
    mutationFn: (id: string) => syncApi.createStudent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      toast({ title: 'Студент создан из анкеты' })
    },
    onError: (err: unknown) => {
      toast({ title: 'Студент не создан', description: getErrorMessage(err, 'Ошибка создания'), variant: 'destructive' })
      qc.invalidateQueries({ queryKey: ['intake'] })
    },
  })

  const createMissingMutation = useMutation({
    mutationFn: () => syncApi.createMissing(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      setConfirmCreateAll(false)
      toast({
        title: 'Студенты созданы',
        description: [
          `Создано: ${res.created}`,
          res.skipped ? `пропущено (нашёлся похожий студент): ${res.skipped}` : null,
          // Проход ограничен потолком: без этой строки кнопка выглядела бы
          // как «всё разобрано», хотя очередь не пуста.
          res.has_more ? 'очередь разобрана не до конца — нажмите ещё раз' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })
    },
    onError: (err) => toast({ title: 'Не удалось создать студентов', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const items = data?.items ?? []
  const linkableCount = items.filter((item) => item.status === 'new' && item.suggested_student_id).length
  const creatableCount = items.filter((item) => item.status === 'new' && !item.suggested_student_id).length

  return (
    <div className="border border-p-line rounded-card">
      <div className="px-4 py-3 border-b border-p-line flex items-center justify-between gap-3 flex-wrap">
        <p className="label-caps">Входящие анкеты · {data?.total ?? 0}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-panel border border-p-line bg-p-bg p-1">
            {[
              { value: 'new', label: 'Новые' },
              { value: 'hidden', label: 'Скрытые' },
              { value: 'all', label: 'Все' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => setIntakeView(item.value as typeof intakeView)}
                className={`px-3 py-1.5 text-xs font-medium rounded-ctl transition-colors ${
                  intakeView === item.value
                    ? 'bg-white text-black'
                    : 'text-p-muted hover:text-black hover:bg-p-bg'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmLinkAll(true)}
            disabled={bulkLinkMutation.isPending || linkableCount === 0}
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Привязать все{linkableCount ? ` · ${linkableCount}` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmCreateAll(true)}
            disabled={createMissingMutation.isPending || creatableCount === 0}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Создать всех{creatableCount ? ` · ${creatableCount}` : ''}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-center py-8 text-p-muted text-sm">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="text-center py-8 text-p-muted text-sm">
          {intakeView === 'hidden' ? 'Скрытых анкет нет' : 'Все анкеты обработаны'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Форма</TableHead>
              <TableHead>ФИО из анкеты</TableHead>
              <TableHead>Менеджер</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Кандидат</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((sub) => (
              <TableRow key={sub.id} className="border-p-line hover:bg-p-bg">
                <TableCell>
                  <span className={`whitespace-nowrap text-2xs px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${
                    sub.source === 'package'
                      ? 'bg-sky-50 text-sky-700 border border-sky-200'
                      : 'bg-violet-50 text-violet-700 border border-violet-200'
                  }`}>
                    {sub.source === 'package' ? 'Пакет' : 'Кейс'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-p-text font-medium">{sub.full_name}</TableCell>
                <TableCell className="text-sm text-p-muted">{sub.manager_name ?? '—'}</TableCell>
                <TableCell className="text-xs text-p-muted">
                  {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString('ru-RU') : '—'}
                </TableCell>
                <TableCell className="text-sm">
                  {sub.suggested_student_name ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {sub.suggested_student_name}
                      {sub.suggested_confidence != null && (
                        <span className="text-p-muted text-xs ml-1">
                          {Math.round(sub.suggested_confidence * 100)}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-p-muted2">нет</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setLinkTarget(sub)}>
                      Привязать
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      disabled={createMutation.isPending}
                      onClick={() => createMutation.mutate(sub.id)}>
                      Создать
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-p-muted"
                      disabled={ignoreMutation.isPending}
                      onClick={() => setIgnoreTarget(sub)}>
                      <EyeOff className="w-3.5 h-3.5 mr-1" />
                      Скрыть
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={!!ignoreTarget} onOpenChange={(open) => !open && setIgnoreTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Скрыть анкету?</DialogTitle>
            <DialogDescription>
              Анкета {ignoreTarget?.full_name ?? 'выбранного студента'} будет перемещена в скрытые и останется доступной через фильтр.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => ignoreMutation.mutate(ignoreTarget?.id ?? '')}
              disabled={!ignoreTarget || ignoreMutation.isPending}
            >
              Скрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmLinkAll} onOpenChange={(open) => !open && setConfirmLinkAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Привязать найденные совпадения?</DialogTitle>
            <DialogDescription>
              Будет привязано до {linkableCount} новых анкет к предложенным студентам. Анкеты без кандидата не будут затронуты.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Если кандидат выбран неверно, откройте анкету и привяжите её вручную.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLinkAll(false)}>Отмена</Button>
            <Button onClick={() => bulkLinkMutation.mutate()} disabled={bulkLinkMutation.isPending}>
              {bulkLinkMutation.isPending ? 'Привязываем…' : `Привязать · ${linkableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCreateAll} onOpenChange={(open) => !open && setConfirmCreateAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Создать студентов из анкет?</DialogTitle>
            <DialogDescription>
              Будет создано {creatableCount} студентов из новых анкет без кандидата на привязку.
              Анкеты с кандидатом останутся на ручное решение. Суммы и договорённости
              не переносятся — их МЗК вносит вручную.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            С кандидатом на привязку: {linkableCount}. Эти анкеты не будут созданы как новые студенты, чтобы не плодить дубли.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCreateAll(false)}>Отмена</Button>
            <Button
              onClick={() => createMissingMutation.mutate()}
              disabled={createMissingMutation.isPending}
            >
              {createMissingMutation.isPending ? 'Создаём…' : `Создать · ${creatableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {linkTarget && <LinkDialog submission={linkTarget} onClose={() => setLinkTarget(null)} />}
    </div>
  )
}

/** Диалог привязки Notion-записи к студенту */
function NotionLinkDialog({
  snapshot,
  onClose,
}: {
  snapshot: NotionSnapshotItem
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>(snapshot.suggested_student_id ?? '')

  const { data: allStudents = [] } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const filtered = useMemo(() => {
    const q = query.trim()
    const base = q ? allStudents.filter((s) => fuzzyStudentMatch(q, s.full_name, s.phone)) : allStudents
    // Предложенный кандидат — всегда первым в списке
    const suggested = snapshot.suggested_student_id
      ? allStudents.find((s) => s.id === snapshot.suggested_student_id)
      : undefined
    const rest = suggested ? base.filter((s) => s.id !== suggested.id) : base
    return (suggested ? [suggested, ...rest] : rest).slice(0, 30)
  }, [allStudents, query, snapshot.suggested_student_id])

  const linkMutation = useMutation({
    mutationFn: () => notionApi.link(snapshot.id, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      toast({ title: 'Запись Notion привязана' })
      onClose()
    },
    onError: (err) => toast({ title: 'Ошибка привязки', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать запись Notion</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-p-muted">
            Notion · <span className="text-p-text">{snapshot.full_name}</span>
          </p>
          {snapshot.suggested_student_name && (
            <p className="text-xs text-emerald-700">
              Предложение: {snapshot.suggested_student_name}
              {snapshot.suggested_confidence != null &&
                ` (${Math.round(snapshot.suggested_confidence * 100)}%)`}
            </p>
          )}
          <Input
            placeholder="Поиск студента..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto border border-p-line rounded-panel divide-y divide-gray-100">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-black text-white'
                    : 'text-p-text hover:bg-p-bg'
                }`}
              >
                {s.full_name}
                <span className={selectedId === s.id ? 'text-white/60 text-xs ml-2' : 'text-p-muted text-xs ml-2'}>
                  {s.intake_year}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-p-muted">Не найдено</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!selectedId || linkMutation.isPending}
          >
            {linkMutation.isPending ? 'Привязываем…' : 'Привязать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Панель непривязанных записей Notion (status=new) */
function NotionInbox() {
  const qc = useQueryClient()
  const [linkTarget, setLinkTarget] = useState<NotionSnapshotItem | null>(null)
  const [view, setView] = useState<'new' | 'ignored' | 'all'>('new')
  const [confirmLinkAll, setConfirmLinkAll] = useState(false)
  const [confirmCreateAll, setConfirmCreateAll] = useState(false)
  const [ignoreTarget, setIgnoreTarget] = useState<NotionSnapshotItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['notion', 'inbox', view],
    queryFn: () => notionApi.snapshots(view),
  })

  const createMutation = useMutation({
    mutationFn: (id: string) => notionApi.createStudent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      toast({ title: 'Студент создан из Notion' })
    },
    onError: (err: unknown) => {
      toast({ title: 'Студент не создан', description: getErrorMessage(err, 'Ошибка создания'), variant: 'destructive' })
      qc.invalidateQueries({ queryKey: ['notion'] })
    },
  })

  const createMissingMutation = useMutation({
    mutationFn: () => notionApi.createMissing(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      setConfirmCreateAll(false)
      toast({
        title: 'Студенты созданы',
        description: `Создано: ${res.created}${res.skipped ? ` · пропущено (нашёлся похожий студент): ${res.skipped}` : ''}`,
      })
    },
    onError: (err) => toast({ title: 'Не удалось создать студентов', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const bulkLinkMutation = useMutation({
    mutationFn: () => notionApi.linkAll(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      setConfirmLinkAll(false)
      toast({ title: 'Совпадения привязаны', description: `Привязано: ${res.linked}` })
    },
    onError: (err) => toast({ title: 'Не удалось привязать совпадения', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => notionApi.ignore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      setIgnoreTarget(null)
      toast({ title: 'Запись скрыта' })
    },
    onError: (err) => toast({ title: 'Не удалось скрыть запись', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const items = data?.items ?? []
  const linkableCount = items.filter((item) => item.status === 'new' && item.suggested_student_id).length
  const creatableCount = items.filter((item) => item.status === 'new' && !item.suggested_student_id).length

  return (
    <div className="border border-p-line rounded-card">
      <div className="px-4 py-3 border-b border-p-line flex items-center justify-between gap-3 flex-wrap">
        <p className="label-caps">Notion без привязки · {data?.total ?? 0}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-panel border border-p-line bg-p-bg p-1">
            {[
              { value: 'new', label: 'Новые' },
              { value: 'ignored', label: 'Скрытые' },
              { value: 'all', label: 'Все' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => setView(item.value as typeof view)}
                className={`px-3 py-1.5 text-xs font-medium rounded-ctl transition-colors ${
                  view === item.value
                    ? 'bg-white text-black'
                    : 'text-p-muted hover:text-black hover:bg-p-bg'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmLinkAll(true)}
            disabled={bulkLinkMutation.isPending || linkableCount === 0}
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Привязать все{linkableCount ? ` · ${linkableCount}` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setConfirmCreateAll(true)}
            disabled={createMissingMutation.isPending || creatableCount === 0}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Создать всех{creatableCount ? ` · ${creatableCount}` : ''}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-center py-8 text-p-muted text-sm">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="text-center py-8 text-p-muted text-sm">
          {view === 'ignored' ? 'Скрытых записей нет' : 'Все записи Notion привязаны'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>ФИО в Notion</TableHead>
              <TableHead>Статус выплат</TableHead>
              <TableHead>Intake</TableHead>
              <TableHead>Кандидат</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((snap) => (
              <TableRow key={snap.id} className="border-p-line hover:bg-p-bg">
                <TableCell className="text-sm text-p-text font-medium">
                  {snap.notion_url ? (
                    <a href={snap.notion_url} target="_blank" rel="noreferrer" className="hover:underline">
                      {snap.full_name}
                    </a>
                  ) : (
                    snap.full_name
                  )}
                </TableCell>
                <TableCell className="text-sm text-p-muted">{snap.payment_status ?? '—'}</TableCell>
                <TableCell className="text-sm text-p-muted">{snap.intake ?? '—'}</TableCell>
                <TableCell className="text-sm">
                  {snap.suggested_student_name ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {snap.suggested_student_name}
                      {snap.suggested_confidence != null && (
                        <span className="text-p-muted text-xs ml-1">
                          {Math.round(snap.suggested_confidence * 100)}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-p-muted2">нет</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setLinkTarget(snap)}>
                      Привязать
                    </Button>
                    {snap.status === 'new' && (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs"
                          disabled={createMutation.isPending}
                          onClick={() => createMutation.mutate(snap.id)}>
                          Создать
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-p-muted"
                          disabled={ignoreMutation.isPending}
                          onClick={() => setIgnoreTarget(snap)}>
                          <EyeOff className="w-3.5 h-3.5 mr-1" />
                          Скрыть
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={!!ignoreTarget} onOpenChange={(open) => !open && setIgnoreTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Скрыть запись Notion?</DialogTitle>
            <DialogDescription>
              Запись {ignoreTarget?.full_name ?? 'выбранного студента'} будет перемещена в скрытые и останется доступной через фильтр.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => ignoreTarget && ignoreMutation.mutate(ignoreTarget.id)}
              disabled={!ignoreTarget || ignoreMutation.isPending}
            >
              Скрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmLinkAll} onOpenChange={(open) => !open && setConfirmLinkAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Привязать совпадения из Notion?</DialogTitle>
            <DialogDescription>
              Будет привязано до {linkableCount} записей Notion к предложенным студентам. Записи без кандидата не будут затронуты.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Если кандидат выбран неверно, откройте запись и привяжите её вручную.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLinkAll(false)}>Отмена</Button>
            <Button onClick={() => bulkLinkMutation.mutate()} disabled={bulkLinkMutation.isPending}>
              {bulkLinkMutation.isPending ? 'Привязываем…' : `Привязать · ${linkableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCreateAll} onOpenChange={(open) => !open && setConfirmCreateAll(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Создать студентов из Notion?</DialogTitle>
            <DialogDescription>
              Будет создано {creatableCount} студентов с договором и странами из Notion —
              только записи без кандидата на привязку. Записи с кандидатом останутся на ручное решение.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-panel border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            С кандидатом на привязку: {linkableCount}. Эти записи останутся в списке для ручной проверки.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCreateAll(false)}>Отмена</Button>
            <Button
              onClick={() => createMissingMutation.mutate()}
              disabled={createMissingMutation.isPending}
            >
              {createMissingMutation.isPending ? 'Создаём…' : `Создать · ${creatableCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {linkTarget && <NotionLinkDialog snapshot={linkTarget} onClose={() => setLinkTarget(null)} />}
    </div>
  )
}

/**
 * Опции выпадающего списка «кого назначить», сгруппированные по специализации.
 * Вынесено, потому что список рисуется дважды — в панели массового назначения и
 * в строке студента, — и раньше это были две копии одной разметки.
 */
function AssigneeOptions({ groups }: { groups: Array<{ title: string; users: Array<{ id: string; name: string }> }> }) {
  if (groups.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-p-muted">Нет сотрудников с этой ролью</div>
  }
  return (
    <>
      {groups.map((group) => (
        <React.Fragment key={group.title}>
          {groups.length > 1 && (
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-p-muted2">
              {group.title}
            </div>
          )}
          {group.users.map((user) => (
            <SelectItem key={user.id} value={user.id}>
              {user.name}
            </SelectItem>
          ))}
        </React.Fragment>
      ))}
    </>
  )
}

export const StudentsListPage: React.FC = () => {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can } = useAuth()
  // Панели сверки с интейком и Notion: sync:manage и notion:manage — те же
  // три роли, что стояли здесь по hasRole.
  const isManager = can('sync', 'manage')
  // Sync/import stays admin-only even though the rest of the CRM is now shared.
  const canRunSync = can('sync', 'create')
  const [searchParams, setSearchParams] = useSearchParams()

  // Фильтры переживают уход в карточку и перезагрузку. Раньше они жили в
  // useState: отобрал пять фильтров, долистал до сорокового студента, открыл
  // карточку, вернулся — пустой список «Все студенты», прокрученный сверху.
  // Это самый частый цикл работы в CRM, и он ломался каждый раз.
  //
  // useLocalState здесь не новый механизм: кабинет держит так свои фильтры
  // (WorkspaceTasksPage и ещё четыре страницы) с самого начала — из CRM его
  // просто ни разу не позвали.
  const [search, setSearch] = useLocalState('students:list:search', '')
  // Стартует от сохранённого значения, иначе после возврата в поле стояла бы
  // строка поиска, а список был бы отфильтрован пустой строкой.
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [statusFilter, setStatusFilter] = useLocalState<string>('students:list:status', '')
  const [mentorFilter, setMentorFilter] = useLocalState('students:list:mentor', '')
  const [leadMentorFilter, setLeadMentorFilter] = useLocalState('students:list:leadMentor', '')
  const [mzkManagerFilter, setMzkManagerFilter] = useLocalState('students:list:mzkManager', '')
  const [responsibleRole, setResponsibleRole] = useLocalState<ResponsibleRoleFilter>('students:list:responsibleRole', 'any')
  const [intakeYearFilter, setIntakeYearFilter] = useLocalState('students:list:intakeYear', '')
  const [countryFilter, setCountryFilter] = useLocalState('students:list:country', '')
  const [countryPrimaryOnly, setCountryPrimaryOnly] = useLocalState('students:list:countryPrimaryOnly', false)
  const [degreeFilter, setDegreeFilter] = useLocalState('students:list:degree', '')
  const [serviceTypeFilter, setServiceTypeFilter] = useLocalState('students:list:serviceType', '')
  const [operationalFilter, setOperationalFilter] = useLocalState<OperationalFilter>('students:list:operational', 'all')
  const [filtersOpen, setFiltersOpen] = useLocalState('students:list:filtersOpen', false)
  // Не сохраняется: это поиск по людям внутри уже открытой панели, а не отбор
  // студентов — на составе списка он никак не сказывается.
  const [responsibleSearch, setResponsibleSearch] = useState('')

  // scope — единственный фильтр, который остаётся в адресе: на него ведут
  // ссылки снаружи (MyStudentsPage → /students?scope=unassigned), и адрес
  // обязан показывать то, что человек видит. Раньше значение отсюда читалось,
  // но обратно не писалось: переключение scope адрес не меняло, и возврат по
  // «Назад» приводил к другому набору, чем был на экране.
  // replace, а не push: иначе каждое переключение клало запись в историю и
  // «Назад» из карточки уводило к предыдущему scope, а не к списку.
  const scope: ScopeFilter =
    searchParams.get('scope') === 'mine' ? 'mine'
    : searchParams.get('scope') === 'assigned' ? 'assigned'
    : searchParams.get('scope') === 'unassigned' ? 'unassigned'
    : 'all'
  const setScope = (next: ScopeFilter) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('scope')
    else params.set('scope', next)
    setSearchParams(params, { replace: true })
  }
  const showInbox = searchParams.get('inbox') === '1'
  const showNotion = searchParams.get('notion') === '1'

  // Приход с доски распределения: «показать в базе» у колонки. Эти три
  // параметра живут только в адресе, а не в localStorage, как остальные
  // фильтры, — они описывают конкретный переход, а не привычку человека, и
  // застревать до следующего визита не должны.
  const boardMentorId = searchParams.get('mentor_id') || ''
  const boardAssignmentRole = boardMentorId ? searchParams.get('assignment_role') || '' : ''
  const boardMissingRole = searchParams.get('missing_role') || ''
  const clearBoardFilter = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('mentor_id')
    params.delete('assignment_role')
    params.delete('missing_role')
    setSearchParams(params, { replace: true })
  }
  // Адрес важнее сохранённого фильтра: человек пришёл по ссылке на конкретную
  // колонку и должен увидеть именно её, а не пересечение с прошлым выбором.
  const effectiveMentorId = boardMentorId || mentorFilter

  const { data: mentorUsers = [] } = useQuery({
    queryKey: ['users', 'mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: leadMentorUsers = [] } = useQuery({
    queryKey: ['users', 'lead_mentor_as_mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
  })

  const { data: mzkUsers = [] } = useQuery({
    queryKey: ['users', 'mzk_manager'],
    queryFn: () => usersApi.list({ role: 'mzk_manager' }),
  })

  // Реальные значения из базы со счётчиками — опции фильтров строятся из данных
  const { data: facets } = useQuery({
    queryKey: ['students', 'facets'],
    queryFn: studentsApi.facets,
  })

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), 300),
    []
  )

  const setShowInbox = (next: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('inbox', '1')
    else params.delete('inbox')
    setSearchParams(params, { replace: true })
  }

  const setShowNotion = (next: boolean) => {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('notion', '1')
    else params.delete('notion')
    setSearchParams(params, { replace: true })
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    debouncedSetSearch(e.target.value)
  }

  // Список загружается целиком, поиск — на клиенте: терпит пробелы,
  // опечатки и кириллицу↔латиницу (см. fuzzyStudentMatch)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      'students',
      statusFilter,
      scope,
      leadMentorFilter,
      mzkManagerFilter,
      intakeYearFilter,
      countryFilter,
      countryPrimaryOnly,
      degreeFilter,
      serviceTypeFilter,
      effectiveMentorId,
      boardAssignmentRole,
      boardMissingRole,
    ],
    queryFn: () =>
      studentsApi.list({
        pipeline_status: (statusFilter as PipelineStatus) || undefined,
        scope,
        mentor_id: effectiveMentorId || undefined,
        assignment_role: boardAssignmentRole || undefined,
        missing_role: boardMissingRole || undefined,
        lead_mentor_id: leadMentorFilter || undefined,
        mzk_manager_id: mzkManagerFilter || undefined,
        intake_year: intakeYearFilter ? Number.parseInt(intakeYearFilter, 10) : undefined,
        country: countryFilter.trim() || undefined,
        country_primary_only: countryFilter.trim() ? countryPrimaryOnly : undefined,
        degree_level: degreeFilter || undefined,
        service_type: serviceTypeFilter || undefined,
        page: 1,
        size: 2000,
      }),
  })

  const assignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.assignSelf(studentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Вы стали ответственным', description: 'Студент появится в фильтре «Мои».' })
    },
    onError: (err) => toast({ title: 'Не удалось стать ответственным', description: getErrorMessage(err), variant: 'destructive' }),
  })

  // --- Назначение ответственных прямо из списка -----------------------------
  //
  // Раньше назначить можно было только внутри карточки студента: на разборе
  // набора это десятки переходов, и ответственные просто не проставлялись.
  const canAssign = can('mentor_assignments', 'manage')
  // Доска показывает чужую нагрузку целиком — это вопрос управления, поэтому
  // право отдельное от «могу назначать» (admin + МЗК, см. реестр прав).
  const canSeeBoard = can('assignment_overview', 'view')
  // Режим назначения включается кнопкой, а не висит на экране всегда. Галочки в
  // каждой строке и панель с ролью — это инструмент разбора набора, а открывают
  // общую базу обычно чтобы посмотреть студента: постоянная колонка выделения
  // читалась как «здесь надо что-то отметить» и мешала основному сценарию.
  const [assignMode, setAssignMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMentorId, setBulkMentorId] = useState('')
  // Одна роль на оба способа назначения — и на строчный селект, и на пачку.
  // Две независимые роли означали бы, что одно действие делает разное в
  // зависимости от того, откуда его начали.
  const [assignRole, setAssignRole] = useState<string>('lead')
  // Замена уже назначенного специалиста требует причины. В пачке такие студенты
  // не роняют остальных — бэкенд возвращает их в `skipped`, а мы переспрашиваем
  // причину и повторяем запрос уже только по ним.
  const [reasonDialog, setReasonDialog] = useState<{
    studentIds: string[]
    mentorId: string
    role: string
  } | null>(null)

  const assignMutation = useMutation({
    mutationFn: (vars: { studentIds: string[]; mentorId: string; role: string; reason?: string }) =>
      mentorAssignmentsApi.bulkAssign({
        student_ids: vars.studentIds,
        mentor_id: vars.mentorId,
        role: vars.role,
        replacement_reason: vars.reason,
      }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })

      const needReason = res.skipped.filter((s) => s.reason === 'needs_reason')
      if (needReason.length > 0) {
        // Не тост, а следующий шаг: у этих студентов уже есть ответственный,
        // и без причины замена не пройдёт.
        setReasonDialog({
          studentIds: needReason.map((s) => s.student_id),
          mentorId: vars.mentorId,
          role: vars.role,
        })
      } else {
        setReasonDialog(null)
        setSelectedIds(new Set())
      }

      const done = res.assigned + res.replaced
      if (done > 0 || res.already > 0) {
        const notes = [
          // Молчать про «уже был назначен» нельзя: иначе «назначено: 3» из
          // двадцати выбранных читается как сбой.
          res.already > 0 ? `уже были назначены: ${res.already}` : null,
          res.assignment_status === 'awaiting_signature'
            ? 'Специалист ещё не подписал регламент — назначения ждут подписи.'
            : null,
        ].filter(Boolean)
        toast({
          title: done > 0 ? `Назначено: ${done}` : 'Все выбранные уже назначены',
          description: notes.join(' · ') || undefined,
        })
      }
    },
    onError: (err) =>
      toast({ title: 'Не удалось назначить', description: getErrorMessage(err), variant: 'destructive' }),
  })

  // Кого предлагать во втором списке — спрашиваем по роли. Правило «кто подходит
  // роли» целиком на бэкенде (services/assignment_candidates.py) и одно на все
  // экраны: пока его собирал фронт по одной лишь учётной роли, МЗК-менеджер,
  // заведённый как ментор, не появлялся в списке МЗК ни здесь, ни в карточке.
  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users', 'assignable', assignRole],
    queryFn: () => usersApi.listAssignable(assignRole),
    enabled: Boolean(assignRole),
  })

  // Заявленные на эту специализацию — первыми. Правило и причины общие с
  // карточкой студента: splitAssignCandidates в types/index.ts.
  const assignCandidateGroups = useMemo(() => {
    const { matching, others } = splitAssignCandidates(assignableUsers, assignRole)
    return [
      { title: MENTOR_ROLE_LABELS[assignRole] ?? 'Эта роль', users: matching },
      { title: 'Другие сотрудники', users: others },
    ].filter((group) => group.users.length > 0)
  }, [assignableUsers, assignRole])

  // Смена роли обнуляет выбранного человека: списки разные, и оставшийся в поле
  // ментор при переключении на «МЗК» уехал бы в назначение как МЗК-ответственный —
  // бэкенд его принимает, роль от этого не проверяется.
  const changeAssignRole = (role: string) => {
    setAssignRole(role)
    setBulkMentorId('')
  }

  const exitAssignMode = () => {
    setAssignMode(false)
    setSelectedIds(new Set())
    setBulkMentorId('')
  }

  // Число колонок таблицы — считаем, а не пишем числом: пустые состояния
  // растягиваются на всю ширину через colSpan, и раньше это была захардкоженная
  // константа, которую пришлось бы править при каждой новой колонке.
  const columnCount = 8 + (isManager ? 1 : 0) + (assignMode ? 1 : 0)

  const toggleSelected = (studentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  const unassignSelfMutation = useMutation({
    mutationFn: (studentId: string) => mentorAssignmentsApi.setSelfActive(studentId, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['my-students'] })
      toast({ title: 'Вы больше не ответственный', description: 'Студент скрыт из фильтра «Мои».' })
    },
    onError: (err) => toast({ title: 'Не удалось снять ответственность', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const { data: syncStatus } = useQuery({
    queryKey: ['intake', 'status'],
    queryFn: syncApi.status,
    enabled: isManager,
    refetchInterval: 60_000,
  })

  const { data: intakeOverview = {} } = useQuery({
    queryKey: ['intake', 'overview'],
    queryFn: syncApi.overview,
    enabled: isManager,
  })

  const { data: notionStatus } = useQuery({
    queryKey: ['notion', 'status'],
    queryFn: notionApi.status,
    enabled: isManager,
    refetchInterval: 60_000,
  })

  const notionSyncMutation = useMutation({
    mutationFn: notionApi.run,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      const c = res.counters
      toast({
        title: 'Notion синхронизирован',
        description: `Записей: ${c.total} · новых: ${c.created} · автопривязано: ${c.auto_linked}${c.needs_review ? ` · требуют привязки: ${c.needs_review}` : ''}`,
      })
    },
    onError: (err: unknown) => {
      toast({ title: 'Синк Notion не выполнен', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const syncMutation = useMutation({
    mutationFn: syncApi.run,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['intake'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      // `promoted` живёт в тех же counters, но описывает не лист формы, а то,
      // сколько анкет синк сам превратил в карточки — считать его источником нельзя.
      const { promoted, ...sheets } = res.counters
      const parts = Object.entries(sheets)
        .filter((entry): entry is [string, SheetCounters] => Boolean(entry[1]))
        .map(([src, c]) => `${src === 'package' ? 'Пакет' : 'Кейсы'}: +${c.new}`)
      if (promoted?.created) parts.push(`создано карточек: ${promoted.created}`)
      if (promoted?.skipped) parts.push(`на проверку: ${promoted.skipped}`)
      toast({ title: 'Синхронизация завершена', description: parts.join(' · ') })
    },
    onError: (err: unknown) => {
      toast({ title: 'Синк не выполнен', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const allStudents = useMemo(() => data?.items ?? [], [data?.items])
  const students = useMemo(() => {
    const searched = debouncedSearch.trim()
      ? allStudents.filter((s) => fuzzyStudentMatch(debouncedSearch, s.full_name, s.phone))
      : allStudents
    return searched.filter((s) => matchesOperationalFilter(s, operationalFilter))
  }, [allStudents, debouncedSearch, operationalFilter])
  const total = students.length
  // «Выбрать всех» относится к тому, что реально видно после фильтров, а не ко
  // всей базе: иначе галочка молча захватила бы студентов вне выборки.
  const allOnPageSelected = students.length > 0 && students.every((s) => selectedIds.has(s.id))
  // Действуем только по видимым — выделение переживает смену фильтров.
  // Иначе: отметил двадцать, сузил поиск до трёх, нажал «Назначить» — и
  // ответственный молча уехал всем двадцати, включая тех, кого на экране нет.
  const selectedVisible = useMemo(
    () => students.filter((s) => selectedIds.has(s.id)).map((s) => s.id),
    [students, selectedIds],
  )
  const newCount = syncStatus?.new_submissions ?? 0
  const activeFiltersCount =
    (scope !== 'all' ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (mentorFilter ? 1 : 0) +
    (leadMentorFilter ? 1 : 0) +
    (mzkManagerFilter ? 1 : 0) +
    (intakeYearFilter ? 1 : 0) +
    (countryFilter.trim() ? 1 : 0) +
    (degreeFilter ? 1 : 0) +
    (serviceTypeFilter ? 1 : 0) +
    (operationalFilter !== 'all' ? 1 : 0)

  const resetFilters = () => {
    // Поиск и «основная страна» раньше не сбрасывались: после «Сбросить всё»
    // список оставался отфильтрованным строкой поиска, а вернувшийся флаг
    // «основная» молча применялся к следующей выбранной стране.
    setSearch('')
    setDebouncedSearch('')
    setCountryPrimaryOnly(false)
    setScope('all')
    setMentorFilter('')
    setLeadMentorFilter('')
    setMzkManagerFilter('')
    setResponsibleRole('any')
    setIntakeYearFilter('')
    setCountryFilter('')
    setDegreeFilter('')
    setServiceTypeFilter('')
    setOperationalFilter('all')
    setStatusFilter('')
    setResponsibleSearch('')
    clearBoardFilter()
  }

  const allUsers = [...mzkUsers, ...leadMentorUsers, ...mentorUsers]
  const responsibleName = (id: string) => allUsers.find((u) => u.id === id)?.name ?? id

  // Чипы активных фильтров — видны без открытия панели, снимаются крестиком
  const activeFilterChips: { key: string; label: string; onRemove: () => void }[] = []
  // Переход с доски распределения показываем чипом, а не молча: иначе список
  // выглядит как вся база, в которой почему-то мало студентов.
  if (boardMentorId)
    activeFilterChips.push({
      key: 'board-mentor',
      label: `${MENTOR_ROLE_LABELS[boardAssignmentRole] ?? 'Ответственный'}: ${responsibleName(boardMentorId)}`,
      onRemove: clearBoardFilter,
    })
  if (boardMissingRole)
    activeFilterChips.push({
      key: 'board-missing',
      label: `Без роли «${MENTOR_ROLE_LABELS[boardMissingRole] ?? boardMissingRole}»`,
      onRemove: clearBoardFilter,
    })
  if (scope !== 'all')
    activeFilterChips.push({
      key: 'scope',
      label: scope === 'mine' ? 'Только мои' : scope === 'assigned' ? 'С ответственными' : 'Без ответственного',
      onRemove: () => setScope('all'),
    })
  if (statusFilter)
    activeFilterChips.push({
      key: 'status',
      label: `Статус: ${PIPELINE_STATUS_LABELS[statusFilter as PipelineStatus] ?? statusFilter}`,
      onRemove: () => setStatusFilter(''),
    })
  if (intakeYearFilter)
    activeFilterChips.push({
      key: 'year',
      label: `Год: ${intakeYearFilter}`,
      onRemove: () => setIntakeYearFilter(''),
    })
  if (degreeFilter)
    activeFilterChips.push({
      key: 'degree',
      label: `Ступень: ${DEGREE_LEVEL_LABELS[degreeFilter as keyof typeof DEGREE_LEVEL_LABELS] ?? degreeFilter}`,
      onRemove: () => setDegreeFilter(''),
    })
  if (serviceTypeFilter)
    activeFilterChips.push({
      key: 'service',
      label: `Программа: ${SERVICE_TYPE_LABELS[serviceTypeFilter as ServiceType] ?? serviceTypeFilter}`,
      onRemove: () => setServiceTypeFilter(''),
    })
  if (countryFilter.trim())
    activeFilterChips.push({
      key: 'country',
      label: `Страна: ${countryFilter}${countryPrimaryOnly ? ' (основная)' : ''}`,
      onRemove: () => { setCountryFilter(''); setCountryPrimaryOnly(false) },
    })
  const clearResponsible = () => {
    setResponsibleRole('any')
    setMzkManagerFilter('')
    setLeadMentorFilter('')
    setMentorFilter('')
  }
  if (mzkManagerFilter)
    activeFilterChips.push({
      key: 'mzk',
      label: `МЗК: ${responsibleName(mzkManagerFilter)}`,
      onRemove: clearResponsible,
    })
  if (leadMentorFilter)
    activeFilterChips.push({
      key: 'lead',
      label: `Lead: ${responsibleName(leadMentorFilter)}`,
      onRemove: clearResponsible,
    })
  if (mentorFilter)
    activeFilterChips.push({
      key: 'mentor',
      label: `Ментор: ${responsibleName(mentorFilter)}`,
      onRemove: clearResponsible,
    })
  if (operationalFilter !== 'all') {
    const labels: Record<OperationalFilter, string> = {
      all: 'Все',
      no_roadmap: 'Нет roadmap',
      no_meeting: 'Нет встречи',
      telegram_unlinked: 'Нет Telegram',
      open_tasks: 'Есть задачи',
      overdue_tasks: 'Просроченные задачи',
      open_complaints: 'Открытые обращения',
      docs_review: 'Документы на проверке',
      renewal: 'Контракт 500',
      name_only_mentor: 'Ментор только по имени',
    }
    activeFilterChips.push({
      key: 'operational',
      label: labels[operationalFilter],
      onRemove: () => setOperationalFilter('all'),
    })
  }

  const currentResponsibleUsers =
    responsibleRole === 'mzk_manager'
      ? mzkUsers
      : responsibleRole === 'lead_mentor'
        ? leadMentorUsers
        : responsibleRole === 'mentor'
          ? mentorUsers
          : []

  const selectedResponsibleId =
    responsibleRole === 'mzk_manager'
      ? mzkManagerFilter
      : responsibleRole === 'lead_mentor'
        ? leadMentorFilter
        : responsibleRole === 'mentor'
          ? mentorFilter
          : ''

  const setResponsibleFilter = (role: ResponsibleRoleFilter, userId = '') => {
    setResponsibleRole(role)
    setMzkManagerFilter(role === 'mzk_manager' ? userId : '')
    setLeadMentorFilter(role === 'lead_mentor' ? userId : '')
    setMentorFilter(role === 'mentor' ? userId : '')
    setResponsibleSearch('')
  }

  const handleExport = async () => {
    try {
      const blob = await studentsApi.exportAll()
      downloadBlob(blob, 'students.xlsx')
    } catch {
      alert('Ошибка экспорта')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Студенты"
        title="Общая база"
        description={`Все студенты CRM · всего: ${total}`}
        action={(
        <div className="flex items-center gap-2 flex-wrap">
          {isManager && (
            <>
              {canRunSync && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  title={syncStatus?.configured === false ? 'Google Sheets не настроен' : 'Забрать новые анкеты из Google Sheets'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  Синхронизировать
                </Button>
              )}
              <Button
                variant={showInbox ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowInbox(!showInbox)}
              >
                <Inbox className="w-3.5 h-3.5 mr-1.5" />
                {showInbox ? 'Все студенты' : 'Входящие'}{newCount > 0 && !showInbox ? ` · ${newCount}` : ''}
              </Button>
              {canRunSync && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => notionSyncMutation.mutate()}
                  disabled={notionSyncMutation.isPending}
                  title={notionStatus?.configured === false ? 'Notion не настроен' : 'Обновить зеркало Notion'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${notionSyncMutation.isPending ? 'animate-spin' : ''}`} />
                  Синк Notion
                </Button>
              )}
              <Button
                variant={showNotion ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowNotion(!showNotion)}
              >
                Notion{(notionStatus?.needs_review ?? 0) > 0 && !showNotion ? ` · ${notionStatus?.needs_review}` : ''}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Экспорт
          </Button>
          {can('students', 'create') && (
            <button
              onClick={() => navigate('/students/new')}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold uppercase tracking-caps
                         bg-black text-white rounded-ctl hover:bg-black/85
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40
                         transition-colors duration-150"
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить студента
            </button>
          )}
        </div>
        )}
      />

      {/* Inbox */}
      {isManager && showInbox && <IntakeInbox />}

      {/* Notion без привязки */}
      {isManager && showNotion && <NotionInbox />}

      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-3.5 h-3.5" />
          <Input
            placeholder="Поиск студентов..."
            value={search}
            onChange={handleSearchChange}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
        {/* Назначить можно и отсюда, но увидеть, КОМУ уже назначено, в таблице
            нельзя: фильтр отвечает про одного человека за раз. Доска отвечает
            про всех сразу — потому и стоит рядом с назначением. */}
        {canSeeBoard && (
          <Button asChild type="button" variant="outline" size="sm" className="h-9 gap-1.5">
            <Link to="/students/distribution">
              <LayoutGrid className="w-3.5 h-3.5" />
              Распределение
            </Link>
          </Button>
        )}
        {canAssign && (
          <Button
            type="button"
            variant={assignMode ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => (assignMode ? exitAssignMode() : setAssignMode(true))}
          >
            <UserPlus className="w-3.5 h-3.5" />
            {assignMode ? 'Выйти из выбора' : 'Выбрать студентов'}
          </Button>
        )}
        <div className="relative">
          <Button
            type="button"
            variant={activeFiltersCount > 0 ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter className="w-3.5 h-3.5" />
            Фильтры
            {activeFiltersCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-white/15 text-2xs font-semibold">
                {activeFiltersCount}
              </span>
            )}
          </Button>
          {filtersOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-80 max-w-[calc(100vw-2rem)] rounded-panel border border-p-line bg-white shadow-lg">
              <div className="flex items-center justify-between px-3 py-2 border-b border-p-line bg-p-bg">
                <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Фильтры</p>
                <button
                  type="button"
                  className="text-p-muted2 hover:text-p-text"
                  onClick={() => setFiltersOpen(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3 space-y-4">
                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Видимость</p>
                  <div className="grid grid-cols-4 gap-1 rounded-panel border border-p-line bg-p-bg p-1">
                    {[
                      { value: 'all', label: 'Все' },
                      { value: 'mine', label: 'Мои' },
                      { value: 'assigned', label: 'С отв.' },
                      { value: 'unassigned', label: 'Без отв.' },
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setScope(item.value as typeof scope)}
                        className={`px-2 py-1.5 text-xs font-medium rounded-ctl transition-colors ${
                          scope === item.value
                            ? 'bg-white text-black shadow-sm'
                            : 'text-p-muted hover:text-black hover:bg-p-bg'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Статус договора</p>
                  <Select
                    value={statusFilter || 'all'}
                    onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все статусы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все статусы</SelectItem>
                      {(facets?.statuses ?? []).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {PIPELINE_STATUS_LABELS[opt.value as PipelineStatus] ?? opt.value} · {opt.count}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Контроль работы</p>
                  <Select
                    value={operationalFilter}
                    onValueChange={(v) => setOperationalFilter(v as OperationalFilter)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все сигналы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="no_roadmap">Нет roadmap</SelectItem>
                      <SelectItem value="no_meeting">Нет ближайшей встречи</SelectItem>
                      <SelectItem value="telegram_unlinked">Telegram не привязан</SelectItem>
                      <SelectItem value="open_tasks">Есть незакрытые задачи</SelectItem>
                      <SelectItem value="overdue_tasks">Просроченные задачи</SelectItem>
                      <SelectItem value="open_complaints">Открытые обращения</SelectItem>
                      <SelectItem value="docs_review">Документы на проверке</SelectItem>
                      <SelectItem value="renewal">Контракт 500 (перепродление)</SelectItem>
                      <SelectItem value="name_only_mentor">Ментор только по имени</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Год</p>
                    <Select
                      value={intakeYearFilter || 'all'}
                      onValueChange={(v) => setIntakeYearFilter(v === 'all' ? '' : v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Все годы" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все годы</SelectItem>
                        {(facets?.years ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.value} · {opt.count}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Ступень</p>
                    <Select
                      value={degreeFilter || 'all'}
                      onValueChange={(v) => setDegreeFilter(v === 'all' ? '' : v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Все ступени" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все ступени</SelectItem>
                        {(facets?.degrees ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {DEGREE_LEVEL_LABELS[opt.value as keyof typeof DEGREE_LEVEL_LABELS] ?? opt.value} · {opt.count}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Страна поступления</p>
                  <Select
                    value={countryFilter || 'all'}
                    onValueChange={(v) => setCountryFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все страны" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все страны</SelectItem>
                      {(facets?.countries ?? []).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.value} · {opt.count}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {countryFilter.trim() && (
                    <div className="flex rounded-full border border-p-line bg-p-bg p-0.5 text-2xs">
                      <button
                        type="button"
                        onClick={() => setCountryPrimaryOnly(false)}
                        className={`flex-1 rounded-full px-2 py-1 font-semibold transition-colors ${!countryPrimaryOnly ? 'bg-white text-p-text shadow-sm' : 'text-p-muted'}`}
                      >
                        Любая
                      </button>
                      <button
                        type="button"
                        onClick={() => setCountryPrimaryOnly(true)}
                        className={`flex-1 rounded-full px-2 py-1 font-semibold transition-colors ${countryPrimaryOnly ? 'bg-white text-p-text shadow-sm' : 'text-p-muted'}`}
                      >
                        Основная
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Программа / услуга</p>
                  <Select
                    value={serviceTypeFilter || 'all'}
                    onValueChange={(v) => setServiceTypeFilter(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Все программы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все программы</SelectItem>
                      {SERVICE_FILTER_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>
                          {SERVICE_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Ответственный</p>
                  <Select
                    value={responsibleRole}
                    onValueChange={(v) => setResponsibleFilter(v as ResponsibleRoleFilter)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Любая роль" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Любая роль</SelectItem>
                      <SelectItem value="mzk_manager">{ROLE_LABELS.mzk_manager}</SelectItem>
                      {/* Не роль сотрудника, а ментор заявки в вуз
                          (applications.lead_mentor_id) — подпись называет это
                          прямо, иначе пункт читается как дубль «Ментора». */}
                      <SelectItem value="lead_mentor">Ментор заявки</SelectItem>
                      <SelectItem value="mentor">{ROLE_LABELS.mentor}</SelectItem>
                    </SelectContent>
                  </Select>
                  {responsibleRole !== 'any' && (
                    <div className="space-y-2">
                      <Input
                        value={responsibleSearch}
                        onChange={(e) => setResponsibleSearch(e.target.value)}
                        placeholder="Найти по имени..."
                        className="h-9 text-sm"
                      />
                      <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                        <button
                          type="button"
                          onClick={() => setResponsibleFilter(responsibleRole)}
                          className={`w-full text-left px-2 py-1.5 text-sm rounded-panel border transition-colors ${
                            selectedResponsibleId === ''
                              ? 'border-black bg-black text-white'
                              : 'border-p-line bg-white hover:bg-p-bg text-p-text'
                          }`}
                        >
                          Все в выбранной роли
                        </button>
                        {currentResponsibleUsers
                          .filter((user) => user.name.toLowerCase().includes(responsibleSearch.trim().toLowerCase()))
                          .map((user) => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => setResponsibleFilter(responsibleRole, user.id)}
                              className={`w-full text-left px-2 py-1.5 text-sm rounded-panel border transition-colors ${
                                selectedResponsibleId === user.id
                                  ? 'border-black bg-black text-white'
                                  : 'border-p-line bg-white hover:bg-p-bg text-p-text'
                              }`}
                            >
                              {user.name}
                            </button>
                          ))}
                        {currentResponsibleUsers.length === 0 && (
                          <p className="px-2 py-2 text-sm text-p-muted">Пользователей нет</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-p-muted"
                    onClick={resetFilters}
                  >
                    Сбросить
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => setFiltersOpen(false)}
                  >
                    Готово
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Активные фильтры — видны без открытия панели */}
      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilterChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-ctl border border-p-line bg-p-bg text-p-text"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                className="text-p-muted2 hover:text-black transition-colors"
                aria-label={`Убрать фильтр ${chip.label}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-p-muted hover:text-black underline underline-offset-4 ml-1"
          >
            Сбросить всё
          </button>
        </div>
      )}

      {/* Панель назначения — видна, пока включён режим выбора.
          Внутри режима выбор роли виден всегда, а не только при выделении: он
          управляет и строчным «+ Назначить». Спрятанный за выделением, он
          превращал бы строчную кнопку в скрытый режим — назначает то ли ментора
          по УП, то ли профориентолога, и по экрану не понять. */}
      {canAssign && assignMode && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-panel border border-p-line bg-p-bg px-3 py-2">
          <span className="text-sm font-semibold text-p-text">
            {selectedVisible.length > 0 ? `Выбрано: ${selectedVisible.length}` : 'Назначить:'}
          </span>
          <Select value={assignRole} onValueChange={changeAssignRole}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="Роль" />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_MENTOR_ROLES.map((value) => (
                <SelectItem key={value} value={value}>
                  {MENTOR_ROLE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Список людей стоит рядом с ролью и виден сразу, а не после выделения
              студентов: роль выбирают, чтобы увидеть, кого вообще можно
              назначить. Спрятанный до галочек, он читался как «выбор роли ничего
              не дал». Кнопка ждёт выделения — и говорит об этом рядом. */}
          <Select value={bulkMentorId} onValueChange={setBulkMentorId}>
            <SelectTrigger className="h-9 w-[220px]">
              <SelectValue placeholder="Кого назначить" />
            </SelectTrigger>
            <SelectContent>
              <AssigneeOptions groups={assignCandidateGroups} />
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!bulkMentorId || selectedVisible.length === 0 || assignMutation.isPending}
            onClick={() =>
              assignMutation.mutate({
                studentIds: selectedVisible,
                mentorId: bulkMentorId,
                role: assignRole,
              })
            }
          >
            {assignMutation.isPending ? 'Назначаем…' : 'Назначить ответственного'}
          </Button>
          {selectedVisible.length === 0 && (
            <span className="text-xs text-p-muted">
              Выберите студентов галочками — или назначайте по одному прямо в строке.
            </span>
          )}
          <button
            hidden={selectedVisible.length === 0}
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-p-muted underline underline-offset-4 hover:text-black"
          >
            Снять выбор
          </button>
        </div>
      )}

      {/* Table */}
      <div className="border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              {assignMode && (
                <TableHead className="w-9">
                  <input
                    type="checkbox"
                    aria-label="Выбрать всех на странице"
                    className="h-4 w-4 cursor-pointer accent-black"
                    checked={allOnPageSelected}
                    onChange={(e) =>
                      setSelectedIds(
                        e.target.checked ? new Set(students.map((s) => s.id)) : new Set()
                      )
                    }
                  />
                </TableHead>
              )}
              <TableHead>Студент</TableHead>
              <TableHead>Степень</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Год</TableHead>
              <TableHead>Страны</TableHead>
              <TableHead>Программы</TableHead>
              <TableHead>Ответственные</TableHead>
              {isManager && <TableHead>Анкеты</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              /* Строкой, а не карточкой QueryError: карточка внутри tbody
                 сломала бы таблицу. Раньше упавший запрос выглядел как
                 «Студенты не найдены» — сотрудник шёл менять фильтры вместо
                 того, чтобы повторить запрос. */
              <TableRow>
                <TableCell colSpan={columnCount} className="py-12 text-center" role="alert">
                  <p className="text-sm font-bold text-p-text">Не удалось загрузить список</p>
                  <p className="mt-1 text-sm text-p-muted">
                    {getErrorMessage(error, 'Данные не пришли. Проверьте связь и повторите.')}
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                    <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                    Повторить
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center py-12 text-p-muted text-sm">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center py-12 text-p-muted text-sm">
                  Студенты не найдены
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => {
                const intake = intakeOverview[student.id]
                return (
                <TableRow key={student.id} className="border-p-line hover:bg-p-bg transition-colors">
                  {assignMode && (
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${student.full_name}`}
                        className="h-4 w-4 cursor-pointer accent-black"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleSelected(student.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Link
                      to={`/students/${student.id}`}
                      className="font-medium text-p-text hover:text-black hover:underline underline-offset-4 transition-colors text-sm"
                    >
                      {student.full_name}
                    </Link>
                    {student.city && (
                      <p className="text-xs text-p-muted mt-0.5">{student.city}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`whitespace-nowrap text-2xs px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
                      {DEGREE_LEVEL_LABELS[student.degree_level]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {student.pipeline_status ? (
                      <span className={`whitespace-nowrap text-2xs px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                        {PIPELINE_STATUS_LABELS[student.pipeline_status]}
                      </span>
                    ) : (
                      <span className="text-p-muted2 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-p-muted">{student.intake_year}</TableCell>
                  <TableCell>
                    <div className="flex max-w-[180px] flex-col gap-0.5">
                      {(student.countries ?? []).length > 0 ? (
                        [...(student.countries ?? [])]
                          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
                          .map((c, idx) => (
                            <span
                              key={`${c.country}-${idx}`}
                              className={`truncate text-xs ${c.is_primary ? 'font-semibold text-p-text' : 'text-p-muted2'}`}
                            >
                              {c.flag_emoji ? `${c.flag_emoji} ` : ''}{c.country}
                            </span>
                          ))
                      ) : (
                        <span className="text-xs text-p-muted2">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[220px] flex-wrap gap-1.5">
                      {(student.services_summary?.items ?? []).length > 0 ? (
                        student.services_summary!.items.slice(0, 3).map((service) => (
                          <span
                            key={service.id}
                            title={`${SERVICE_TYPE_LABELS[service.service_type]} · ${SERVICE_STATUS_LABELS[service.status]}${service.assigned_mentor_name ? ` · ${service.assigned_mentor_name}` : ''}`}
                            className={`whitespace-nowrap rounded-pill border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ${
                              service.status === 'completed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : service.status === 'in_progress' || service.status === 'scheduled'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-p-line bg-p-bg text-p-muted'
                            }`}
                          >
                            {SERVICE_TYPE_LABELS[service.service_type]}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-p-muted2">—</span>
                      )}
                      {(student.services_summary?.items.length ?? 0) > 3 && (
                        <span className="rounded-pill border border-p-line bg-p-bg px-1.5 py-0.5 text-2xs font-semibold text-p-muted">
                          +{(student.services_summary?.items.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {student.is_mine && (
                        <span className="w-fit text-2xs px-1.5 py-0.5 rounded-pill border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium uppercase tracking-wide">
                          Мой
                        </span>
                      )}
                      {/* С ролью, а не просто списком имён: «Зира» в этой
                          колонке одинаково выглядела и как МЗК, и как ментор по
                          УП, а действия по ним разные. Роль есть в данных
                          (responsibles[].role) и раньше просто не выводилась. */}
                      {activeResponsibles(student).length > 0 ? (
                        <div className="flex max-w-[200px] flex-wrap gap-1">
                          {activeResponsibles(student).map((r) => (
                            <span
                              key={r.assignment_id ?? `${r.role}-${r.id}`}
                              className="max-w-full truncate rounded-pill border border-p-line bg-p-bg px-1.5 py-0.5 text-2xs font-medium text-p-muted"
                              title={`${MENTOR_ROLE_LABELS[r.role ?? ''] ?? r.role ?? 'Ответственный'}: ${r.name || 'Без имени'}`}
                            >
                              <span className="text-p-muted2">
                                {MENTOR_ROLE_LABELS[r.role ?? ''] ?? r.role ?? '—'}:
                              </span>{' '}
                              {r.name || 'Без имени'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-p-muted2">—</span>
                      )}

                      {/* Ментор «только по имени»: строка, приехавшая импортом
                          из Notion, а не настоящее назначение. Такой ментор не
                          видит студента у себя — на глаз это неотличимо от
                          нормально назначенного, поэтому показываем явно. */}
                      {activeResponsibles(student).length === 0 &&
                        (student.mentors?.length ?? 0) > 0 && (
                          <span
                            title="Ментор указан текстом из импорта, а не привязан к аккаунту — студента он у себя не видит. Назначьте ответственного."
                            className="w-fit max-w-[180px] truncate rounded-pill border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-2xs font-medium text-amber-700"
                          >
                            по имени: {student.mentors?.join(', ')}
                          </span>
                        )}

                      {assignMode && (
                        <Select
                          value=""
                          onValueChange={(mentorId) =>
                            assignMutation.mutate({
                              studentIds: [student.id],
                              mentorId,
                              role: assignRole,
                            })
                          }
                        >
                          {/* Роль вынесена в подпись: она общая с панелью
                              массового назначения и может быть не «Ментор по
                              УП». Кнопка «+ Назначить» без роли молча ставила
                              бы не того специалиста, которого ждут. */}
                          <SelectTrigger className="h-7 w-[170px] text-xs">
                            <SelectValue placeholder={`+ ${MENTOR_ROLE_LABELS[assignRole]}`} />
                          </SelectTrigger>
                          <SelectContent>
                            <AssigneeOptions groups={assignCandidateGroups} />
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </TableCell>
                  {isManager && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span
                          title="Пакет сопровождения (менеджер)"
                          className={`text-2xs w-5 h-5 flex items-center justify-center rounded-pill border font-semibold ${
                            intake?.has_package
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : 'border-p-line text-p-muted2'
                          }`}
                        >
                          П
                        </span>
                        <span
                          title="Кейс студента"
                          className={`text-2xs w-5 h-5 flex items-center justify-center rounded-pill border font-semibold ${
                            intake?.has_cases
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : 'border-p-line text-p-muted2'
                          }`}
                        >
                          К
                        </span>
                      </div>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className={`label-caps transition-colors ${
                          student.is_mine ? 'text-emerald-700 hover:text-emerald-800' : 'text-p-muted hover:text-black'
                        }`}
                        disabled={assignSelfMutation.isPending || unassignSelfMutation.isPending}
                        onClick={() =>
                          student.is_mine
                            ? unassignSelfMutation.mutate(student.id)
                            : assignSelfMutation.mutate(student.id)
                        }
                      >
                        {student.is_mine ? '★ Мой' : '☆ Взять'}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-p-muted">
        {debouncedSearch.trim()
          ? `Найдено: ${students.length} из ${allStudents.length}`
          : `Всего студентов: ${students.length}`}
      </p>

      {/* Замена ответственного пишется в историю, поэтому причина обязательна.
          Спрашиваем её только по тем студентам, у кого ответственный уже был, —
          остальные из той же пачки к этому моменту уже назначены. Тот же диалог
          показывает доска распределения при перетаскивании карточки. */}
      <ReplacementReasonDialog
        studentCount={reasonDialog ? reasonDialog.studentIds.length : null}
        isPending={assignMutation.isPending}
        onCancel={() => setReasonDialog(null)}
        onConfirm={(reason) =>
          reasonDialog &&
          assignMutation.mutate({
            studentIds: reasonDialog.studentIds,
            mentorId: reasonDialog.mentorId,
            role: reasonDialog.role,
            reason,
          })
        }
      />
    </div>
  )
}
