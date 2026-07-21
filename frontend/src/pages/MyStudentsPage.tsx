import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Users } from 'lucide-react'
import { studentsApi } from '@/api/students'
import {
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PipelineStatus,
} from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { debounce } from '@/lib/utils'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'

export const MyStudentsPage: React.FC = () => {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), 300),
    []
  )

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    debouncedSetSearch(e.target.value)
    setPage(1)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['my-students', debouncedSearch, statusFilter, page],
    queryFn: () =>
      studentsApi.list({
        search: debouncedSearch || undefined,
        pipeline_status: (statusFilter as PipelineStatus) || undefined,
        scope: 'mine',
        page,
        size: 20,
      }),
  })

  const students = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.pages ?? 1

  return (
    <div>
      <CrmPageHeader
        eyebrow="Студенты"
        title="Мои студенты"
        description="Студенты с активным назначением в CRM. Эти же студенты будут открываться в личном кабинете ментора."
        action={(
          <div className="flex items-center gap-3">
          <span className="label-caps">Всего: {total}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/students?scope=unassigned">
              <Users className="w-4 h-4 mr-2" />
              Назначить студентов
            </Link>
          </Button>
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(PIPELINE_STATUS_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-y border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
              <TableHead>Имя</TableHead>
              <TableHead>Степень</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Год</TableHead>
              <TableHead>Дней в работе</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : students.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  У вас пока нет студентов. Откройте общий список и назначьте себя или нужного ментора ответственным.
                </TableCell>
              </TableRow>
            ) : (
              students.map((student) => (
                <TableRow key={student.id} className="border-gray-100 hover:bg-gray-50">
                  <TableCell className="font-medium">
                    <Link
                      to={`/students/${student.id}`}
                      className="text-gray-900 hover:text-black hover:underline underline-offset-4"
                    >
                      {student.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
                      {DEGREE_LEVEL_LABELS[student.degree_level]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {student.pipeline_status ? (
                      <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                        {PIPELINE_STATUS_LABELS[student.pipeline_status]}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-gray-600">{student.intake_year}</TableCell>
                  <TableCell className="text-gray-600">{student.days_in_work ?? '—'}</TableCell>
                  <TableCell>
                    <Link
                      to={`/students/${student.id}`}
                      className="label-caps text-gray-500 hover:text-black transition-colors"
                    >
                      Открыть →
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && students.length === 0 && (
        <div className="mt-4 rounded-[2px] border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          У вас нет активных ответственных назначений. В CRM откройте студента и назначьте ментора в блоке «Ответственные»
          или нажмите «Взять» в общем списке.
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Показано {students.length} из {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </Button>
            <span className="text-sm text-gray-600">{page} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
