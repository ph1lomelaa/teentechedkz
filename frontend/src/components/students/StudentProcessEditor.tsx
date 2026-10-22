import { StudentWorkStatus } from './StudentWorkStatus'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { invalidateStudent } from '@/lib/queryKeys'
import { PIPELINE_STATUS_LABELS, type PipelineStatus, type StudentFull } from '@/types'

export function StudentProcessEditor({ student, workspace = false }: { student: StudentFull; workspace?: boolean }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [year, setYear] = useState(String(student.intake_year ?? ''))
  const [status, setStatus] = useState<PipelineStatus>(student.pipeline_status ?? 'no_status')
  const allowYear = can('students', 'edit')
  const allowStatus = allowYear && can('student_work_status', 'edit')
  useEffect(() => {
    if (!editing) {
      setYear(String(student.intake_year ?? ''))
      setStatus(student.pipeline_status ?? 'no_status')
    }
  }, [student.intake_year, student.pipeline_status, editing])
  const save = useMutation({
    mutationFn: () => studentsApi.update(student.id, {
      ...(allowYear && year !== String(student.intake_year ?? '') ? { intake_year: Number(year) } : {}),
      ...(allowStatus && status !== (student.pipeline_status ?? 'no_status') ? { pipeline_status: status } : {}),
    }),
    onSuccess: (saved) => {
      invalidateStudent(queryClient, student.id)
      queryClient.invalidateQueries({ queryKey: ['assignment-board'] })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      queryClient.invalidateQueries({ queryKey: ['notion'] })
      setEditing(false)
      const sync = saved.notion_sync
      const description = sync?.state === 'not_linked' ? 'Для синхронизации сначала привяжите карточку к Notion.'
        : sync?.state === 'ambiguous_link' ? 'Найдено несколько связей с Notion — нужна проверка.'
        : sync?.state === 'conflict' ? 'В Notion тоже изменили данные. Выберите верное значение в сверке полей.'
        : sync?.dry_run ? 'Синхронизация пока проверяется без записи.'
        : sync?.queued ? 'Изменения поставлены в очередь синхронизации с Notion.'
        : sync?.state === 'disabled' ? 'Автоматическая синхронизация с Notion выключена.' : undefined
      toast({ title: 'Год и статус сохранены', description })
    },
    onError: (error) => toast({ title: 'Не удалось сохранить', description: getErrorMessage(error), variant: 'destructive' }),
  })
  const yearChanged = year !== String(student.intake_year ?? '')
  const validYear = !yearChanged || (/^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2200)
  const changed = yearChanged || (allowStatus && status !== (student.pipeline_status ?? 'no_status'))
  const fields = workspace ? 'rounded-lg border border-w-line bg-w-panel p-2 text-sm' : 'rounded-lg border border-p-line bg-p-panel p-2 text-sm'
  return <div className={`mb-4 rounded-panel border p-3 ${workspace ? 'border-w-line' : 'border-p-line'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Год набора и статус работы</p>
      {allowYear && !editing && <button type="button" className="text-sm font-semibold underline" onClick={() => setEditing(true)}>Изменить год и статус</button>}
    </div>
    {!editing ? <div className="mt-2 text-sm"><p className="mb-1">Набор: {student.intake_year || 'не указан'}</p><StudentWorkStatus student={student} /></div> : <form onSubmit={(event) => { event.preventDefault(); if (validYear && changed) save.mutate() }}>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Год поступления / набора<input aria-label="Год поступления / набора" type="number" min={1900} max={2200} step={1} className={fields} value={year} onChange={(event) => setYear(event.target.value)} disabled={save.isPending} /></label>
        <label className="grid gap-1 text-sm">Статус работы<select aria-label="Статус работы" className={fields} value={status} onChange={(event) => setStatus(event.target.value as PipelineStatus)} disabled={!allowStatus || save.isPending}>{Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <p className={`mt-2 text-xs ${workspace ? 'text-w-muted' : 'text-p-muted'}`}>Статус «Работа окончена» сохраняет карточку и историю. Связанные поля синхронизируются с Notion; конфликты доступны в сверке полей.</p>
      <div className="mt-3 flex gap-3"><button type="submit" className="text-sm font-semibold underline disabled:opacity-50" disabled={!validYear || !changed || save.isPending}>{save.isPending ? 'Сохранение…' : 'Сохранить год и статус'}</button><button type="button" className="text-sm underline" disabled={save.isPending} onClick={() => setEditing(false)}>Отмена</button></div>
    </form>}
  </div>
}
