import React, { useEffect, useState, useMemo, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Download, Search, EyeOff, Eye, CheckCheck, Filter, X, UserPlus, LayoutGrid, ChevronDown } from 'lucide-react'
import { studentsApi } from '@/api/students'
// Общие с «Моими студентами»: обе страницы отбирают один и тот же список,
// и вторая копия «Контроля работы» отвечала бы иначе на том же вопросе.
import {
  activeResponsibles,
  matchesOperationalFilter,
  OPERATIONAL_FILTER_LABELS,
  type OperationalFilter,
} from '@/lib/studentFilters'
import { mentorAssignmentsApi, usersApi } from '@/api/index'
import { syncApi, IntakeSubmission, SheetCounters } from '@/api/sync'
import { notionApi, NotionSnapshotItem, type NotionPipelineRow } from '@/api/notion'
import { useAuth } from '@/contexts/AuthContext'
import { useLocalState } from '@/lib/use-local-state'
import {
  PipelineStatusFilter,
  type PipelineStatusOperator,
} from '@/components/shared/PipelineStatusFilter'
import {
  PipelineStatus,
  PIPELINE_STATUS_LABELS,
  DEGREE_LEVEL_LABELS,
  SERVICE_TYPE_LABELS,
  ROLE_LABELS,
  MENTOR_ROLE_LABELS,
  ASSIGNABLE_MENTOR_ROLES,
  splitAssignCandidates,
  ServiceType,
  type StudentListItem,
} from '@/types'
import { Button } from '@/components/ui/primitives/button'
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
import { debounce } from '@/lib/utils'
import { fuzzyStudentMatch } from '@/lib/fuzzyName'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { ReplacementReasonDialog } from '@/components/students/ReplacementReasonDialog'
import { StudentExportDialog } from '@/components/students/StudentExportDialog'
import { BaseStudentDrawer } from '@/components/students/base/BaseStudentDrawer'
import { BaseStudentTable } from '@/components/students/base/BaseStudentTable'
import { NotionFieldSyncReviewDialog } from '@/components/students/base/NotionFieldSyncReviewDialog'

const SOURCE_LABELS: Record<string, string> = {
  package: 'Пакет (менеджер)',
  cases: 'Кейс (студент)',
}

type ResponsibleRoleFilter = 'any' | 'mzk_manager' | 'lead_mentor' | 'mentor'
type ScopeFilter = 'all' | 'mine' | 'assigned' | 'unassigned'
type StatusFilterOperator = PipelineStatusOperator
type BaseView = 'all' | 'needs_assignment' | 'diff' | 'mine'
type BaseGrouping = 'intake' | 'responsible' | 'status'

const REQUIRED_ROLES = ['career', 'ielts', 'lead', 'country'] as const

function needsAssignment(student: StudentListItem, notionRow?: NotionPipelineRow): boolean {
  if (!notionValues(notionRow, 'Статус выплат').some((value) => value.trim().toLocaleLowerCase('ru') === 'активная работа')) return false
  const roles = new Set(activeResponsibles(student).map((item) => item.role))
  return REQUIRED_ROLES.some((role) => !roles.has(role))
}


const SERVICE_FILTER_OPTIONS: ServiceType[] = [
  'proforientation',
  'ielts_mock',
  'ielts_prep',
  'sat_prep',
  'portfolio_improvement',
  'english_general',
]

function notionValues(row: NotionPipelineRow | undefined, field: string): string[] {
  const value = row?.values[field]
  return (Array.isArray(value) ? value : [value]).filter((item) => item != null && String(item).trim()).map(String)
}

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
          {submission.identity_review_required && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              Требуется проверить личность заявки
              {submission.match_candidate_names?.length ? (
                <span>: {submission.match_candidate_names.join(' · ')}</span>
              ) : null}
            </div>
          )}
          <Input
            placeholder="Поиск студента..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto border border-p-line rounded-panel divide-y divide-p-line">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-p-chip text-p-chip-text ring-1 ring-inset ring-p-accent-dim'
                    : 'text-p-text hover:bg-p-panel2'
                }`}
              >
                {s.full_name}
                <span className="ml-2 text-xs text-p-muted">
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
                    ? 'bg-p-panel text-p-text shadow-sm'
                    : 'text-p-muted hover:text-p-text hover:bg-p-panel2'
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
                  ) : sub.match_candidate_names?.length ? (
                    <span className="text-amber-800" title={sub.match_candidate_names.join(' · ')}>
                      Проверить: {sub.match_candidate_names.length} кандидата
                    </span>
                  ) : sub.identity_review_required ? (
                    <span className="text-amber-800">Проверить личность</span>
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
          <div className="max-h-56 overflow-y-auto border border-p-line rounded-panel divide-y divide-p-line">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  selectedId === s.id
                    ? 'bg-p-chip text-p-chip-text ring-1 ring-inset ring-p-accent-dim'
                    : 'text-p-text hover:bg-p-panel2'
                }`}
              >
                {s.full_name}
                <span className="ml-2 text-xs text-p-muted">
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
                    ? 'bg-p-panel text-p-text shadow-sm'
                    : 'text-p-muted hover:text-p-text hover:bg-p-panel2'
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

const CrmStudentsListView: React.FC = () => {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can } = useAuth()
  // Панели сверки с интейком и Notion: sync:manage и notion:manage — те же
  // три роли, что стояли здесь по hasRole.
  const isManager = can('sync', 'manage')
  const canSeeNotion = can('notion', 'manage')
  // Sync/import stays admin-only even though the rest of the CRM is now shared.
  const canRunSync = can('sync', 'create')
  const [searchParams, setSearchParams] = useSearchParams()
  const [exportOpen, setExportOpen] = useState(false)
  const [fieldSyncReviewOpen, setFieldSyncReviewOpen] = useState(false)
  const [dataMenuOpen, setDataMenuOpen] = useState(false)
  const dataMenuRef = useRef<HTMLDivElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const [baseView, setBaseView] = useLocalState<BaseView>('students:list:baseView', 'all')
  const [baseGrouping, setBaseGrouping] = useLocalState<BaseGrouping>('students:list:baseGrouping', 'intake')
  const [groupRole, setGroupRole] = useLocalState<string>('students:list:groupRole', 'mzk')
  const [openStudent, setOpenStudent] = useState<StudentListItem | null>(null)
  const [roleStudent, setRoleStudent] = useState<StudentListItem | null>(null)
  const [sortAscending, setSortAscending] = useLocalState('students:list:sortAscending', true)
  const [showCountries, setShowCountries] = useLocalState('students:list:columnCountries', true)
  const [showForms, setShowForms] = useLocalState('students:list:columnForms', true)
  const [columnsOpen, setColumnsOpen] = useState(false)
  useEffect(() => {
    if (!canSeeNotion && (baseView === 'needs_assignment' || baseView === 'diff')) setBaseView('all')
  }, [canSeeNotion, baseView, setBaseView])

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
  // The same storage key used to hold one string. Accept it for one render and
  // migrate in place so users do not lose their saved filter after deployment.
  const [storedStatusFilters, setStoredStatusFilters] = useLocalState<PipelineStatus[] | string>('students:list:status', [])
  const statusFilters = Array.isArray(storedStatusFilters)
    ? storedStatusFilters
    : storedStatusFilters ? [storedStatusFilters as PipelineStatus] : []
  const setStatusFilters = (values: PipelineStatus[]) => setStoredStatusFilters(values)
  const [statusFilterOperator, setStatusFilterOperator] = useLocalState<StatusFilterOperator>('students:list:statusOperator', 'is')
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
  const [notionField, setNotionField] = useLocalState('students:list:notionField', 'Статус выплат')
  const [notionValue, setNotionValue] = useLocalState('students:list:notionValue', '')
  const [filtersOpen, setFiltersOpen] = useLocalState('students:list:filtersOpen', false)
  // Не сохраняется: это поиск по людям внутри уже открытой панели, а не отбор
  // студентов — на составе списка он никак не сказывается.
  const [responsibleSearch, setResponsibleSearch] = useState('')

  useEffect(() => {
    if (typeof storedStatusFilters === 'string') {
      setStoredStatusFilters(storedStatusFilters ? [storedStatusFilters as PipelineStatus] : [])
    }
  }, [storedStatusFilters, setStoredStatusFilters])

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
      statusFilters,
      statusFilterOperator,
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
        pipeline_statuses: statusFilters.length ? statusFilters.join(',') : undefined,
        pipeline_status_operator: statusFilters.length ? statusFilterOperator : undefined,
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

  const toggleSelected = (studentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else if (next.size < 200) next.add(studentId)
      else toast({ title: 'Можно выбрать не более 200 студентов за одно назначение' })
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
    enabled: canSeeNotion,
    refetchInterval: 60_000,
  })
  const { data: notionTable, isLoading: isNotionLoading, isError: isNotionError, refetch: refetchNotionTable } = useQuery({
    queryKey: ['notion', 'pipeline-table', 'all'],
    queryFn: () => notionApi.pipelineTable(false),
    enabled: canSeeNotion,
    staleTime: 60_000,
  })
  const { data: notionReport, isLoading: isReportLoading, isError: isReportError, refetch: refetchNotionReport } = useQuery({
    queryKey: ['notion', 'pipeline-report'],
    queryFn: notionApi.pipelineReport,
    enabled: canSeeNotion,
    staleTime: 60_000,
  })
  const reportDiffIds = useMemo(() => new Set(
    (notionReport?.rows ?? []).filter((row) => row.student_id && row.changes.length > 0).map((row) => row.student_id!),
  ), [notionReport])
  const notionByStudent = useMemo(() => {
    const rows = new Map<string, NotionPipelineRow>()
    const duplicated = new Set<string>()
    for (const row of notionTable?.items ?? []) {
      if (row.source !== 'notion' || !row.student_id) continue
      if (rows.has(row.student_id)) duplicated.add(row.student_id)
      rows.set(row.student_id, row)
    }
    for (const id of duplicated) rows.delete(id)
    return rows
  }, [notionTable])
  const notionStatuses = useMemo(() => {
    const statuses = new Map<string, string>()
    for (const [studentId, row] of notionByStudent) {
      const raw = row.values['Статус выплат']
      const value = Array.isArray(raw) ? raw.find((item) => item != null) : raw
      statuses.set(studentId, value == null || !String(value).trim() ? 'no_status' : String(value))
    }
    return statuses
  }, [notionByStudent])
  const notionOptions = useMemo(() => {
    const values = new Set<string>()
    for (const row of notionTable?.items ?? []) {
      if (row.source !== 'notion') continue
      const raw = row.values[notionField]
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value != null && String(value).trim()) values.add(String(value))
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'ru'))
  }, [notionTable, notionField])

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
      .filter((s) => !notionValue || notionValues(notionByStudent.get(s.id), notionField).includes(notionValue))
  }, [allStudents, debouncedSearch, operationalFilter, notionByStudent, notionField, notionValue])
  const total = students.length
  const incompleteResult = (data?.total ?? 0) > allStudents.length
  const viewCounts = {
    all: students.length,
    needs_assignment: students.filter((student) => needsAssignment(student, notionByStudent.get(student.id))).length,
    diff: students.filter((student) => reportDiffIds.has(student.id)).length,
    mine: students.filter((s) => s.is_mine).length,
  }
  const viewedStudents = useMemo(() => {
    const filtered = students.filter((student) =>
      baseView === 'mine' ? student.is_mine : baseView === 'needs_assignment' ? needsAssignment(student, notionByStudent.get(student.id)) : baseView === 'diff' ? reportDiffIds.has(student.id) : true,
    )
    return [...filtered].sort((a, b) => sortAscending
      ? a.full_name.localeCompare(b.full_name, 'ru')
      : b.full_name.localeCompare(a.full_name, 'ru'))
  }, [students, baseView, sortAscending, notionByStudent, reportDiffIds])
  const groupedStudents = useMemo(() => {
    const groups = new Map<string, StudentListItem[]>()
    for (const student of viewedStudents) {
      const key = baseGrouping === 'intake'
        ? `Набор ${student.intake_year || 'не указан'}`
        : baseGrouping === 'status'
          ? PIPELINE_STATUS_LABELS[student.pipeline_status ?? 'no_status']
          : activeResponsibles(student).filter((r) => r.role === groupRole).map((r) => r.name).join(', ') || `Без «${MENTOR_ROLE_LABELS[groupRole]}»`
      groups.set(key, [...(groups.get(key) ?? []), student])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru', { numeric: true }))
  }, [viewedStudents, baseGrouping, groupRole])
  useEffect(() => {
    setSelectedIds(new Set())
  }, [baseView, baseGrouping, groupRole, debouncedSearch, operationalFilter, notionValue, scope, intakeYearFilter, leadMentorFilter, degreeFilter, countryFilter, mentorFilter, mzkManagerFilter, serviceTypeFilter, statusFilterOperator, storedStatusFilters, boardMentorId, boardMissingRole])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDataMenuOpen(false)
        setFiltersOpen(false)
        setColumnsOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [setFiltersOpen])
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (dataMenuOpen && !dataMenuRef.current?.contains(target)) setDataMenuOpen(false)
      if (filtersOpen && !filtersRef.current?.contains(target)) setFiltersOpen(false)
      if (columnsOpen && !columnsRef.current?.contains(target)) setColumnsOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [dataMenuOpen, filtersOpen, columnsOpen, setFiltersOpen])
  // «Выбрать всех» относится к тому, что реально видно после фильтров, а не ко
  // всей базе: иначе галочка молча захватила бы студентов вне выборки.
  // Действуем только по видимым — выделение переживает смену фильтров.
  // Иначе: отметил двадцать, сузил поиск до трёх, нажал «Назначить» — и
  // ответственный молча уехал всем двадцати, включая тех, кого на экране нет.
  const selectedVisible = useMemo(
    () => viewedStudents.filter((s) => selectedIds.has(s.id)).map((s) => s.id),
    [viewedStudents, selectedIds],
  )
  const newCount = syncStatus?.new_submissions ?? 0
  const activeFiltersCount =
    (scope !== 'all' ? 1 : 0) +
    (statusFilters.length ? 1 : 0) +
    (mentorFilter ? 1 : 0) +
    (leadMentorFilter ? 1 : 0) +
    (mzkManagerFilter ? 1 : 0) +
    (intakeYearFilter ? 1 : 0) +
    (countryFilter.trim() ? 1 : 0) +
    (degreeFilter ? 1 : 0) +
    (serviceTypeFilter ? 1 : 0) +
    (operationalFilter !== 'all' ? 1 : 0) +
    (notionValue ? 1 : 0)

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
    setNotionValue('')
    setStatusFilters([])
    setStatusFilterOperator('is')
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
  statusFilters.forEach((status) => {
    activeFilterChips.push({
      key: `status-${status}`,
      label: `Статус CRM ${statusFilterOperator === 'is_not' ? 'не ' : ''}${PIPELINE_STATUS_LABELS[status]}`,
      onRemove: () => setStatusFilters(statusFilters.filter((value) => value !== status)),
    })
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
  if (notionValue) activeFilterChips.push({
    key: 'notion-value', label: `${notionField}: ${notionValue}`, onRemove: () => setNotionValue(''),
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

  return (
    <div className="space-y-5">
      <StudentExportDialog open={exportOpen} onOpenChange={setExportOpen} currentView={{
        studentIds: viewedStudents.map((student) => student.id),
        selectedStudentIds: viewedStudents.filter((student) => selectedIds.has(student.id)).map((student) => student.id),
        selectedNames: viewedStudents.filter((student) => selectedIds.has(student.id)).map((student) => student.full_name),
        label: baseView === 'all' ? 'Все' : baseView === 'mine' ? 'Мои' : baseView === 'diff' ? 'Расхождения' : 'Требуют назначения',
        labels: [
          ...(baseView !== 'all' ? [`Вид: ${baseView === 'mine' ? 'Мои' : baseView === 'diff' ? 'Расхождения с Notion' : 'Требуют назначения'}`] : []),
          ...(debouncedSearch.trim() ? [`Поиск: «${debouncedSearch.trim()}»`] : []),
          ...(intakeYearFilter ? [`Набор: ${intakeYearFilter}`] : []),
          ...(leadMentorFilter ? [`Lead-Mentor: ${responsibleName(leadMentorFilter)}`] : []),
          ...(degreeFilter ? [`Ступень: ${DEGREE_LEVEL_LABELS[degreeFilter as keyof typeof DEGREE_LEVEL_LABELS] ?? degreeFilter}`] : []),
          ...(countryFilter ? [`Страна: ${countryFilter}`] : []),
          ...(countryPrimaryOnly ? ['Страна: только основная'] : []),
          ...(statusFilters.length ? [`Статус CRM: ${statusFilters.map((status) => PIPELINE_STATUS_LABELS[status]).join(', ')}`] : []),
          ...(serviceTypeFilter ? [`Программа: ${SERVICE_TYPE_LABELS[serviceTypeFilter as ServiceType] ?? serviceTypeFilter}`] : []),
          ...(leadMentorFilter ? [`Lead-Mentor: ${responsibleName(leadMentorFilter)}`] : []),
          ...(mzkManagerFilter ? [`МЗК: ${responsibleName(mzkManagerFilter)}`] : []),
          ...(mentorFilter ? [`Ментор: ${responsibleName(mentorFilter)}`] : []),
          ...(scope !== 'all' ? [`Область: ${scope === 'mine' ? 'мои' : scope === 'assigned' ? 'с ответственным' : 'без ответственного'}`] : []),
          ...(notionValue ? [`${notionField}: ${notionValue}`] : []),
          ...(operationalFilter !== 'all' ? [`Доп. условие: ${operationalFilter}`] : []),
          ...(boardMentorId ? [`Ментор: ${responsibleName(boardMentorId)}`] : []),
          ...(boardMissingRole ? [`Не назначена роль: ${MENTOR_ROLE_LABELS[boardMissingRole] ?? boardMissingRole}`] : []),
          ...(baseGrouping !== 'intake' ? [`Группировка: ${baseGrouping === 'responsible' ? MENTOR_ROLE_LABELS[groupRole] : 'Статус'}`] : []),
          ...(!sortAscending ? ['Сортировка: Имя ↓'] : []),
        ],
      }} />
      {fieldSyncReviewOpen && <NotionFieldSyncReviewDialog open onOpenChange={setFieldSyncReviewOpen} />}
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-ds-accentText">Студенты</p>
          <h1 className="mt-1 text-[36px] font-extrabold tracking-[-.02em] leading-tight text-ds-ink">Общая база</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ds-muted">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span>{incompleteResult ? `Показано ${total} из ${data?.total} студентов CRM` : `${data?.total ?? total} студентов CRM`}</span>
            {canSeeNotion && <><span>·</span><span>{notionStatus?.last_run?.ok && notionStatus.last_run.at
              ? `Notion синхронизирован ${new Date(notionStatus.last_run.at).toLocaleString('ru-RU')}`
              : 'Время синхронизации Notion неизвестно'}</span>
              <span>·</span><button type="button" className="font-semibold text-ds-accentText underline underline-offset-2" onClick={() => setShowNotion(true)}>
                {notionStatus?.needs_review ?? 0} строк Notion без привязки
              </button></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeBoard && <Button asChild variant="outline" size="sm"><Link to="/students/distribution"><LayoutGrid className="mr-1.5 h-4 w-4" />Распределение</Link></Button>}
          {(isManager || canSeeNotion) && <div ref={dataMenuRef} className="relative">
            <Button type="button" variant="outline" size="sm" aria-expanded={dataMenuOpen} onClick={() => setDataMenuOpen(!dataMenuOpen)}>
              Данные <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
            {dataMenuOpen && <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-ds-line bg-ds-panel p-1.5 shadow-lg">
              {canRunSync && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ds-ink hover:bg-ds-panel2" disabled={syncMutation.isPending} onClick={() => { setDataMenuOpen(false); syncMutation.mutate() }}>Синхронизировать анкеты Google Sheets<span className="block text-xs text-ds-muted">Забрать новые ответы</span></button>}
              {canRunSync && canSeeNotion && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ds-ink hover:bg-ds-panel2" disabled={notionSyncMutation.isPending} onClick={() => { setDataMenuOpen(false); notionSyncMutation.mutate() }}>Обновить данные Notion<span className="block text-xs text-ds-muted">Обновить локальную копию</span></button>}
              {isManager && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ds-ink hover:bg-ds-panel2" onClick={() => { setDataMenuOpen(false); setShowInbox(true) }}>Входящие анкеты · {newCount}<span className="block text-xs text-ds-muted">Ответы Google Sheets</span></button>}
              {canSeeNotion && <Link to="/dashboard" className="block rounded-lg px-3 py-2 text-sm text-ds-ink hover:bg-ds-panel2" onClick={() => setDataMenuOpen(false)}>Обзор Notion<span className="block text-xs text-ds-muted">Пайплайн клиентов</span></Link>}
              {canSeeNotion && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ds-ink hover:bg-ds-panel2" onClick={() => { setDataMenuOpen(false); setFieldSyncReviewOpen(true) }}>Сверка полей CRM ↔ Notion<span className="block text-xs text-ds-muted">Очередь проверок и конфликтов</span></button>}
              {canSeeNotion && <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ds-ink hover:bg-ds-panel2" onClick={() => { setDataMenuOpen(false); setShowNotion(true) }}>Привязки Notion · {notionStatus?.needs_review ?? 0}<span className="block text-xs text-ds-muted">Страницы без студента CRM</span></button>}
            </div>}
          </div>}
          {can('export', 'manage') && <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} title="Выгрузка настраивается отдельно и не наследует фильтры таблицы"><Download className="mr-1.5 h-4 w-4" />Экспорт</Button>}
          {can('students', 'create') && <Button size="sm" className="bg-ds-accent font-bold text-[#141413] hover:brightness-95" onClick={() => navigate('/students/new')}><Plus className="mr-1 h-4 w-4" />Студент</Button>}
        </div>
      </header>

      {canSeeNotion && isNotionError && <div role="alert" className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Не удалось загрузить данные Notion. CRM-колонки доступны. <button className="font-semibold underline" onClick={() => refetchNotionTable()}>Повторить</button>
      </div>}

      <nav aria-label="Виды общей базы" className="flex flex-wrap gap-1 border-b border-ds-line">
        {([{ value: 'all', label: 'Все' }, ...(canSeeNotion ? [{ value: 'needs_assignment', label: 'Требуют назначения' } as const, { value: 'diff', label: 'Расхождения с Notion' } as const] : []), { value: 'mine', label: 'Мои' }] as const).map((view) =>
          <button key={view.value} type="button" title={view.value === 'needs_assignment' ? 'Связанные с Notion студенты со статусом «Активная работа», которым не назначена одна из обязательных ролей: профориентолог, учитель IELTS, ментор по УП, ментор по стране' : undefined} aria-current={baseView === view.value ? 'page' : undefined} onClick={() => setBaseView(view.value)} className={`min-h-10 border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent ${baseView === view.value ? 'border-ds-accent text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink'}`}>
            {view.label} <span className="ml-1 rounded-full bg-ds-panel2 px-2 py-0.5 text-xs tabular-nums">{view.value === 'diff' ? 'не сверено' : view.value === 'needs_assignment' && (isNotionLoading || isNotionError) ? '—' : incompleteResult ? `${viewCounts[view.value]}+` : viewCounts[view.value]}</span>
          </button>)}
      </nav>
      {baseView === 'diff' && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        {isReportError ? <>Не удалось загрузить отчёт сверки. <button type="button" className="font-bold underline" onClick={() => refetchNotionReport()}>Повторить</button></>
          : isReportLoading ? 'Загружаем подтверждённые различия…' : 'Показаны подтверждённые различия проверенных связей по статусу, набору и странам. Автоматические связи и остальные поля сверяйте в карточке студента; общий счётчик пока недоступен.'}
      </p>}
      {baseView === 'needs_assignment' && (isNotionLoading || isNotionError) && <p className="rounded-xl border border-ds-line bg-ds-panel2 px-3 py-2 text-xs text-ds-muted">{isNotionLoading ? 'Загружаем статусы Notion для этого вида…' : 'Не удалось загрузить статусы Notion. Повторите запрос выше.'}</p>}

      {/* Inbox */}
      {isManager && showInbox && <IntakeInbox />}

      {/* Notion без привязки */}
      {canSeeNotion && showNotion && <NotionInbox />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-p-muted2 w-3.5 h-3.5" />
          <Input
            placeholder="Имя, телефон"
            value={search}
            onChange={handleSearchChange}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Select value={intakeYearFilter || 'all'} onValueChange={(v) => setIntakeYearFilter(v === 'all' ? '' : v)}><SelectTrigger className="h-9 w-auto min-w-24 text-xs"><SelectValue placeholder="Набор" /></SelectTrigger><SelectContent><SelectItem value="all">Набор</SelectItem>{(facets?.years ?? []).map((item) => <SelectItem key={item.value} value={item.value}>{item.value} · {item.count}</SelectItem>)}</SelectContent></Select>
        <Select value={leadMentorFilter || 'all'} onValueChange={(v) => setLeadMentorFilter(v === 'all' ? '' : v)}><SelectTrigger className="h-9 w-auto min-w-28 text-xs"><SelectValue placeholder="Lead-Mentor" /></SelectTrigger><SelectContent><SelectItem value="all">Ментор заявки</SelectItem>{leadMentorUsers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
        <Select value={degreeFilter || 'all'} onValueChange={(v) => setDegreeFilter(v === 'all' ? '' : v)}><SelectTrigger className="h-9 w-auto min-w-24 text-xs"><SelectValue placeholder="Ступень" /></SelectTrigger><SelectContent><SelectItem value="all">Ступень</SelectItem>{(facets?.degrees ?? []).map((item) => <SelectItem key={item.value} value={item.value}>{DEGREE_LEVEL_LABELS[item.value as keyof typeof DEGREE_LEVEL_LABELS] ?? item.value}</SelectItem>)}</SelectContent></Select>
        <Select value={countryFilter || 'all'} onValueChange={(v) => setCountryFilter(v === 'all' ? '' : v)}><SelectTrigger className="h-9 w-auto min-w-24 text-xs"><SelectValue placeholder="Страна" /></SelectTrigger><SelectContent><SelectItem value="all">Страна</SelectItem>{(facets?.countries ?? []).map((item) => <SelectItem key={item.value} value={item.value}>{item.value}</SelectItem>)}</SelectContent></Select>
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
        <div ref={filtersRef} className="relative">
          <Button
            type="button"
            variant={activeFiltersCount > 0 ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter className="w-3.5 h-3.5" />
            + Фильтр
            {activeFiltersCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-white/15 text-2xs font-semibold">
                {activeFiltersCount}
              </span>
            )}
          </Button>
          {filtersOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-80 max-w-[calc(100vw-2rem)] rounded-panel border border-ds-line bg-ds-panel text-ds-ink shadow-lg">
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
                            ? 'bg-p-panel text-p-text shadow-sm'
                            : 'text-p-muted hover:text-p-text hover:bg-p-panel2'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Статус CRM</p>
                  <PipelineStatusFilter
                    value={statusFilters}
                    onChange={setStatusFilters}
                    operator={statusFilterOperator}
                    onOperatorChange={setStatusFilterOperator}
                    counts={Object.fromEntries((facets?.statuses ?? []).map((option) => [option.value, option.count]))}
                  />
                </div>

                {canSeeNotion && <div className="space-y-2 border-t border-p-line pt-3">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-p-muted">Данные Notion</p>
                  <Select value={notionField} onValueChange={(value) => { setNotionField(value); setNotionValue('') }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Поле Notion" /></SelectTrigger>
                    <SelectContent>{(notionTable?.columns ?? ['Статус выплат']).filter((field) => field !== 'Статус CRM').map((field) =>
                      <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={notionValue || '__all__'} onValueChange={(value) => setNotionValue(value === '__all__' ? '' : value)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Любое значение" /></SelectTrigger>
                    <SelectContent><SelectItem value="__all__">Все значения</SelectItem>{notionOptions.map((value) =>
                      <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-p-muted">Фильтр применён к связанным строкам Notion. Несвязанные доступны в разделе «Notion».</p>
                </div>}

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
                      {Object.entries(OPERATIONAL_FILTER_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
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
                              ? 'border-p-accent-dim bg-p-chip text-p-chip-text'
                              : 'border-p-line bg-p-panel hover:bg-p-panel2 text-p-text'
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
                                ? 'border-p-accent-dim bg-p-chip text-p-chip-text'
                                : 'border-p-line bg-p-panel hover:bg-p-panel2 text-p-text'
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
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <span className="text-xs font-semibold text-ds-muted">Группировка</span>
          <div className="flex rounded-[10px] bg-ds-panel2 p-[3px]">
            {([{ value: 'intake', label: 'Набор' }, { value: 'responsible', label: 'Ответственный' }, { value: 'status', label: 'Статус' }] as const).map((item) => <button key={item.value} type="button" onClick={() => setBaseGrouping(item.value)} className={`min-h-8 rounded-lg px-2.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent ${baseGrouping === item.value ? 'bg-ds-panel text-ds-ink shadow-sm' : 'text-ds-muted'}`}>{item.label}</button>)}
          </div>
          {baseGrouping === 'responsible' && <Select value={groupRole} onValueChange={setGroupRole}><SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent>{ASSIGNABLE_MENTOR_ROLES.map((role) => <SelectItem key={role} value={role}>{MENTOR_ROLE_LABELS[role]}</SelectItem>)}</SelectContent></Select>}
          <div ref={columnsRef} className="relative">
            <Button type="button" variant="outline" size="sm" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(!columnsOpen)}>Столбцы · {7 + Number(showCountries) + Number(showForms)}</Button>
            {columnsOpen && <div className="absolute right-0 top-full z-30 mt-2 w-44 rounded-xl border border-ds-line bg-ds-panel p-3 text-sm text-ds-ink shadow-lg"><p className="mb-2 text-xs font-bold text-ds-muted">Дополнительные столбцы</p><label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={showCountries} onChange={(event) => setShowCountries(event.target.checked)} />Страны</label><label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={showForms} onChange={(event) => setShowForms(event.target.checked)} />Анкеты</label></div>}
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
      {canAssign && (assignMode || selectedVisible.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ds-line bg-ds-ink px-3 py-2 text-ds-bg">
          <span className="text-sm font-semibold">
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
            disabled={!bulkMentorId || selectedVisible.length === 0 || selectedVisible.length > 200 || assignMutation.isPending}
            onClick={() =>
              assignMutation.mutate({
                studentIds: selectedVisible,
                mentorId: bulkMentorId,
                role: assignRole,
              })
            }
          >
            {assignMutation.isPending ? 'Назначаем…' : 'Назначить'}
          </Button>
          {selectedVisible.length > 200 && <span className="text-xs">За одно действие можно назначить не более 200 студентов.</span>}
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

      <BaseStudentTable
        groups={groupedStudents}
        selectedIds={selectedIds}
        onToggle={toggleSelected}
        onSelectAll={(ids, selected) => setSelectedIds((previous) => {
          const next = new Set(previous)
          for (const id of ids) {
            if (selected && next.size < 200) next.add(id)
            else if (!selected) next.delete(id)
          }
          if (selected && ids.some((id) => !next.has(id))) toast({ title: 'Выбраны первые 200 студентов', description: 'Назначьте их, затем выберите оставшихся.' })
          return next
        })}
        onOpen={setOpenStudent}
        onRole={(student, role) => { changeAssignRole(role); setRoleStudent(student) }}
        onSelf={(student) => student.is_mine ? unassignSelfMutation.mutate(student.id) : assignSelfMutation.mutate(student.id)}
        canAssign={canAssign}
        isManager={isManager}
        intakeOverview={intakeOverview}
        sortAscending={sortAscending}
        onSort={() => setSortAscending(!sortAscending)}
        isLoading={isLoading || (baseView === 'diff' && isReportLoading) || (baseView === 'needs_assignment' && isNotionLoading)}
        error={isError ? getErrorMessage(error, 'Данные не пришли. Проверьте связь и повторите.') : undefined}
        onRetry={() => refetch()}
        selfPending={assignSelfMutation.isPending || unassignSelfMutation.isPending}
        showCountries={showCountries}
        showForms={showForms}
        notionStatuses={notionStatuses}
        showSelection={assignMode}
      />
      <p className="text-xs text-ds-muted">Роли: ПО профориентолог · IE учитель IELTS · УП ментор по УП · СТ ментор по стране · ПФ портфолио · МЗ МЗК. Пунктир значит «не назначен».</p>

      <p className="text-sm text-p-muted">
        {debouncedSearch.trim()
          ? `Найдено: ${viewedStudents.length} из ${allStudents.length}${incompleteResult ? ` (всего в запросе ${data?.total})` : ''}`
          : `Показано студентов: ${viewedStudents.length}${incompleteResult ? ` из ${data?.total}` : ''}`}
      </p>

      {openStudent && <BaseStudentDrawer student={allStudents.find((student) => student.id === openStudent.id) ?? openStudent} intake={intakeOverview[openStudent.id]} canSeeNotion={canSeeNotion} canAssign={canAssign} onClose={() => setOpenStudent(null)} onRole={(role) => { changeAssignRole(role); setRoleStudent(allStudents.find((student) => student.id === openStudent.id) ?? openStudent) }} />}

      {roleStudent && <Dialog open onOpenChange={(open) => { if (!open) setRoleStudent(null) }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><p className="text-xs font-bold uppercase tracking-[.16em] text-ds-accentText">{MENTOR_ROLE_LABELS[assignRole]}</p><DialogTitle>{roleStudent.full_name}</DialogTitle><DialogDescription>Набор {roleStudent.intake_year} · {roleStudent.countries?.map((country) => country.country).join(', ') || 'Страна не указана'}</DialogDescription></DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {assignCandidateGroups.flatMap((group) => group.users).map((user) => {
              const current = activeResponsibles(roleStudent).some((responsible) => responsible.role === assignRole && responsible.id === user.id)
              return <button key={user.id} type="button" disabled={assignMutation.isPending} onClick={() => { assignMutation.mutate({ studentIds: [roleStudent.id], mentorId: user.id, role: assignRole }); setRoleStudent(null) }} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent ${current ? 'border-ds-accent bg-ds-accent/15' : 'border-ds-line bg-ds-panel hover:bg-ds-panel2'}`}>{user.name}{current && <span className="ml-2 text-xs font-normal text-ds-muted">· сейчас ведёт</span>}</button>
            })}
            {assignableUsers.length === 0 && <p className="text-sm text-ds-muted">Сотрудники для этой роли не найдены.</p>}
          </div>
          <DialogFooter><Button variant="outline" type="button" onClick={() => setRoleStudent(null)}>Отмена</Button></DialogFooter>
        </DialogContent>
      </Dialog>}

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

export const StudentsListPage = CrmStudentsListView
