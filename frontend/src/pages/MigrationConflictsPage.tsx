import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { AlertTriangle } from 'lucide-react'
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

export const MigrationConflictsPage: React.FC = () => {
  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => studentsApi.getAll({ size: 500 }),
  })

  const conflictStudents = students.filter((s) => {
    const status = s.pipeline_status
    return status === 'on_visa' || status === 'suspended' || status === 'transferred_pipeline'
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 pb-5 border-b border-gray-200">
        <AlertTriangle className="w-5 h-5 text-orange-600" />
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Конфликты миграции</h1>
      </div>

      <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-[2px] text-sm text-orange-800">
        Студенты с потенциальными проблемами в процессе подачи документов или визы.
        Статусы: «На визе», «Подвешено», «Перевели».
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
            ) : conflictStudents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  Конфликтов не обнаружено
                </TableCell>
              </TableRow>
            ) : (
              conflictStudents.map((student) => (
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
    </div>
  )
}
