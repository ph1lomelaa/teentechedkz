import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Layers, Users } from 'lucide-react'
import {
  AREA_LABELS,
  ResponsibilityArea,
  responsibilitiesApi,
} from '@/api/responsibilities'
import { usersApi } from '@/api/index'
import { ROLE_LABELS, User } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Input } from '@/components/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import { toast } from '@/hooks/use-toast'
import { PageHeader, StatCard } from '@/components/ui'

/** Первое слово имени — в десяти колонках полное не помещается. */
function shortName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

interface EditTarget {
  studentId: string
  studentName: string
  area: ResponsibilityArea
  currentUserId: string | null
}

/**
 * Конструктор ответственности: ученики × зоны.
 *
 * Заполнять по одному ученику невозможно — их сотни, а зон десять. Этот экран
 * и есть то «отдельное окно», ради которого раздел затевался: он показывает
 * дыры (зоны без ответственного) и даёт закрыть их подряд.
 *
 * Ответственность ничего не запрещает — см. `api/responsibilities.ts`.
 */
export const SettingsResponsibilitiesPage: React.FC = () => {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const canManage = can('responsibilities', 'manage')

  const [onlyIncomplete, setOnlyIncomplete] = useState(false)
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState<EditTarget | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['responsibilities', 'overview', onlyIncomplete],
    queryFn: () => responsibilitiesApi.overview({ only_incomplete: onlyIncomplete || undefined }),
  })

  const { data: staff = [] } = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => usersApi.list(),
    enabled: canManage,
    staleTime: 60_000,
    select: (users: User[]) => users.filter((u) => u.is_active !== false && u.role !== 'student'),
  })

  const assign = useMutation({
    mutationFn: ({ studentId, area, userId }: { studentId: string; area: ResponsibilityArea; userId: string }) =>
      userId
        ? responsibilitiesApi.assign(studentId, area, userId)
        : responsibilitiesApi.clear(studentId, area),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['responsibilities'] })
      setEdit(null)
    },
    onError: () => toast({ title: 'Не удалось сохранить', variant: 'destructive' }),
  })

  const areas = data?.areas ?? []
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return data?.students ?? []
    return (data?.students ?? []).filter((row) => row.student_name.toLowerCase().includes(needle))
  }, [data?.students, query])

  const stats = useMemo(() => {
    const students = data?.students ?? []
    const complete = students.filter((s) => s.coverage.is_complete).length
    const gaps = students.reduce((sum, s) => sum + s.coverage.missing_areas.length, 0)
    return { total: students.length, complete, incomplete: students.length - complete, gaps }
  }, [data?.students])

  const columnCount = areas.length + 1

  return (
    <div>
      <PageHeader
        eyebrow="Управление"
        title="Кто за что отвечает"
        description="Участки работы с учеником: встречи, переписка, заметки, задачи, roadmap. Ответственность не ограничивает доступ — она показывает, к кому идти с вопросом."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard colorPrefix="p" icon={<Users className="h-4 w-4" />} label="Учеников" value={String(stats.total)} />
        <StatCard
          colorPrefix="p"
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Все зоны закрыты"
          value={String(stats.complete)}
        />
        <StatCard
          colorPrefix="p"
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Есть незакрытые"
          value={String(stats.incomplete)}
          valueClassName={stats.incomplete ? 'text-amber-500' : undefined}
          warn={stats.incomplete > 0}
          onClick={() => setOnlyIncomplete(true)}
        />
        <StatCard
          colorPrefix="p"
          icon={<Layers className="h-4 w-4" />}
          label="Пустых зон всего"
          value={String(stats.gaps)}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти ученика"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-p-muted">
          <input
            type="checkbox"
            checked={onlyIncomplete}
            onChange={(e) => setOnlyIncomplete(e.target.checked)}
          />
          Только с незакрытыми зонами
        </label>
      </div>

      {/* Десять колонок не помещаются на узком экране — таблица прокручивается
          внутри себя, страница по горизонтали не едет. */}
      <div className="overflow-x-auto border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead className="sticky left-0 bg-p-bg">Ученик</TableHead>
              {areas.map((area) => (
                <TableHead key={area} className="whitespace-nowrap text-center text-xs">
                  {AREA_LABELS[area]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columnCount || 11} className="py-8 text-center text-p-muted">
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount || 11} className="py-8 text-center text-p-muted">
                  Не удалось загрузить
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-p-muted">
                  Ничего не найдено
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.student_id} className="border-p-line hover:bg-p-bg">
                  <TableCell className="sticky left-0 bg-p-panel font-medium text-p-text">
                    <span className="flex items-center gap-2">
                      {row.student_name}
                      {!row.coverage.is_complete && (
                        <span className="rounded-pill border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                          {row.coverage.missing_areas.length} без ответственного
                        </span>
                      )}
                    </span>
                  </TableCell>
                  {areas.map((area) => {
                    const cell = row.areas[area]
                    return (
                      <TableCell key={area} className="text-center text-sm">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setEdit({
                              studentId: row.student_id,
                              studentName: row.student_name,
                              area,
                              currentUserId: cell?.user_id ?? null,
                            })
                          }
                          title={cell?.user_name ? `${cell.user_name} · ${AREA_LABELS[area]}` : `Не назначен · ${AREA_LABELS[area]}`}
                          className={`w-full rounded-ctl px-2 py-1 text-xs transition-colors ${
                            canManage ? 'hover:bg-p-line/40' : 'cursor-default'
                          } ${cell?.user_name ? 'text-p-text' : 'text-p-muted2'}`}
                        >
                          {cell?.user_name ? shortName(cell.user_name) : '—'}
                        </button>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{edit ? AREA_LABELS[edit.area] : ''}</DialogTitle>
            <DialogDescription>{edit?.studentName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => edit && assign.mutate({ studentId: edit.studentId, area: edit.area, userId: '' })}
              disabled={assign.isPending}
              className={`w-full rounded-ctl px-3 py-2 text-left text-sm transition-colors hover:bg-p-bg ${
                !edit?.currentUserId ? 'font-semibold text-p-text' : 'text-p-muted'
              }`}
            >
              — не назначен —
            </button>
            {staff.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => edit && assign.mutate({ studentId: edit.studentId, area: edit.area, userId: person.id })}
                disabled={assign.isPending}
                className={`flex w-full items-baseline justify-between gap-3 rounded-ctl px-3 py-2 text-left text-sm transition-colors hover:bg-p-bg ${
                  edit?.currentUserId === person.id ? 'font-semibold text-p-text' : 'text-p-text'
                }`}
              >
                <span className="truncate">{person.name}</span>
                <span className="shrink-0 text-xs text-p-muted">{ROLE_LABELS[person.role]}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
