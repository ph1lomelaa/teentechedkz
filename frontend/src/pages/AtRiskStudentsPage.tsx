import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import { AlertTriangle, Copy } from 'lucide-react'
import {
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVEL_COLORS,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_COLORS,
} from '@/types'
import { Link } from 'react-router-dom'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const AtRiskStudentsPage: React.FC = () => {
  const { hasRole } = useAuth()
  const isManager = hasRole('admin', 'mzk_manager')

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const { data: duplicates } = useQuery({
    queryKey: ['students', 'duplicates'],
    queryFn: studentsApi.duplicates,
    enabled: isManager,
  })

  const atRiskStudents = students.filter((s) => {
    const status = s.pipeline_status
    return status === 'on_visa' || status === 'suspended' || status === 'transferred_pipeline'
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 pb-5 border-b border-gray-200">
        <AlertTriangle className="w-5 h-5 text-orange-600" />
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Зона риска</h1>
      </div>

      <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-[2px] text-sm text-orange-800">
        Студенты, за процессом которых стоит следить внимательнее: виза в работе,
        процесс подвешен или студента перевели. Статусы: «На визе», «Подвешено», «Перевели».
      </div>

      <div className="border-y border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
              <TableHead>Студент</TableHead>
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
            ) : atRiskStudents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  В зоне риска никого нет
                </TableCell>
              </TableRow>
            ) : (
              atRiskStudents.map((student) => (
                <TableRow key={student.id} className="border-gray-100 hover:bg-gray-50">
                  <TableCell className="font-medium text-gray-900">{student.full_name}</TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${DEGREE_LEVEL_COLORS[student.degree_level]}`}>
                      {DEGREE_LEVEL_LABELS[student.degree_level]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {student.pipeline_status && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${PIPELINE_STATUS_COLORS[student.pipeline_status]}`}>
                        {PIPELINE_STATUS_LABELS[student.pipeline_status]}
                      </span>
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

      {/* Возможные дубли: телефон или транслит-совпадение ФИО */}
      {isManager && duplicates && (
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-4">
            <Copy className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">
              Возможные дубли · {duplicates.total}
            </h2>
          </div>
          {duplicates.total === 0 ? (
            <p className="text-sm text-gray-500">Дублей не найдено — все студенты уникальны.</p>
          ) : (
            <>
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-[2px] text-sm text-red-800">
                Пары студентов с одинаковым телефоном или совпадающим именем (включая
                написание на разных языках). Проверь каждую пару: перенеси данные в одну
                карточку, вторую архивируй (кнопка «Архивировать» в профиле, только админ).
              </div>
              <div className="border-y border-gray-200">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 hover:bg-transparent">
                      <TableHead>Студент А</TableHead>
                      <TableHead>Студент Б</TableHead>
                      <TableHead>Совпадение</TableHead>
                      <TableHead>Телефоны</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {duplicates.pairs.map((pair, i) => (
                      <TableRow key={i} className="border-gray-100 hover:bg-gray-50">
                        <TableCell>
                          <Link to={`/students/${pair.a.id}`} className="font-medium text-gray-900 hover:underline">
                            {pair.a.full_name}
                          </Link>
                          <span className="text-gray-400 text-xs ml-2">{pair.a.intake_year}</span>
                        </TableCell>
                        <TableCell>
                          <Link to={`/students/${pair.b.id}`} className="font-medium text-gray-900 hover:underline">
                            {pair.b.full_name}
                          </Link>
                          <span className="text-gray-400 text-xs ml-2">{pair.b.intake_year}</span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${
                            pair.reason === 'phone'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {pair.reason === 'phone' ? 'Телефон' : 'Имя'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {pair.a.phone || '—'} · {pair.b.phone || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
