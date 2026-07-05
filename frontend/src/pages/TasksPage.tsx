import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/api/client'
import { StudentTask } from '@/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExternalLink } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface TaskWithStudent extends StudentTask {
  student_name?: string
}

async function fetchAllTasks(filter: 'open' | 'done' | 'all', page: number) {
  const params: Record<string, string | number> = { page, size: 100 }
  if (filter !== 'all') params.status = filter
  const res = await apiClient.get('/tasks', { params })
  return res.data as { items: TaskWithStudent[]; total: number; pages: number }
}

export const TasksPage: React.FC = () => {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['all-tasks', filter, page],
    queryFn: () => fetchAllTasks(filter, page),
  })
  const tasks = data?.items ?? []
  const totalPages = data?.pages ?? 1

  const toggleMutation = useMutation({
    mutationFn: (task: TaskWithStudent) =>
      apiClient.patch(`/tasks/${task.id}`, {
        status: task.status === 'open' ? 'done' : 'open',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-tasks'] })
      toast({ title: 'Статус задачи обновлён' })
    },
  })

  const handleFilterChange = (f: 'open' | 'done' | 'all') => {
    setFilter(f)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      <div className="pb-5 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Задачи</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 rounded-[2px] border border-gray-200 bg-gray-50/50 p-1">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-[2px] transition-colors ${
                filter === f
                  ? 'bg-white text-black'
                  : 'text-gray-600 hover:text-black hover:bg-gray-50'
              }`}
            >
              {f === 'open' ? 'Открытые' : f === 'done' ? 'Выполненные' : 'Все'}
            </button>
          ))}
        </div>
        <span className="text-[11px] uppercase tracking-caps text-gray-500 border border-gray-200 rounded-[2px] px-2.5 py-1">
          Всего: {data?.total ?? 0}
        </span>
      </div>

      {/* Table */}
      <div className="border-y border-gray-200">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Загрузка...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-500">Задач не найдено</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Студент</TableHead>
                <TableHead>Задача</TableHead>
                <TableHead className="w-32">Дата</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow
                  key={task.id}
                  className={`border-gray-100 hover:bg-gray-50 ${task.status === 'done' ? 'opacity-50' : ''}`}
                >
                  <TableCell>
                    <Checkbox
                      checked={task.status === 'done'}
                      onCheckedChange={() => toggleMutation.mutate(task)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/students/${task.student_id}`}
                      className="font-medium text-gray-900 hover:text-black hover:underline underline-offset-4"
                    >
                      {task.student_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <p
                      className={`text-sm ${
                        task.status === 'done'
                          ? 'line-through text-gray-500'
                          : 'text-gray-800'
                      }`}
                    >
                      {task.task_text}
                    </p>
                    {task.done_at && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Выполнено: {new Date(task.done_at).toLocaleDateString('ru-RU')}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {new Date(task.created_at).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell>
                    <Link to={`/students/${task.student_id}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            Назад
          </Button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
            Вперёд
          </Button>
        </div>
      )}
    </div>
  )
}
