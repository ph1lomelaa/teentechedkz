import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { useAuth } from '@/contexts/AuthContext'
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'
import { normalizeStudentPipelineStatus, StudentPipelineStatusBadge } from './StudentPipelineStatusBadge'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'
import { invalidateStudent } from '@/lib/queryKeys'

export interface WorkStatusFields {
  pipeline_status?: string | null
  crm_status?: string | null
  notion_status?: string | null
  notion_status_raw?: string | null
  status_source?: string
  status_sync_state?: string
  notion_linked?: boolean
}
const SYNC_LABELS: Record<string, string> = {
  ambiguous_link: 'Несколько страниц Notion — нужна сверка',
  not_linked: 'Нет связи с Notion', unrecognized: 'Неизвестный статус Notion',
  different: 'Расхождение с CRM', crm_empty: 'Статус из Notion',
  pending: 'Ожидает синхронизации', portal_edit: 'Изменён на платформе', sync_error: 'Ошибка синхронизации',
}
export function StudentWorkStatus({ student }: { student: WorkStatusFields & { id: string; full_name?: string } }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PipelineStatus>('no_status')
  const save = useMutation({
    mutationFn: () => studentsApi.update(student.id, { pipeline_status: draft }),
    onSuccess: saved => {
      invalidateStudent(qc, student.id)
      for (const key of ['students', 'assignment-board', 'my-students', 'workspace', 'notion']) qc.invalidateQueries({ queryKey: [key] })
      setEditing(false)
      toast({ title: 'Статус сохранён', description: saved.notion_sync?.state === 'disabled' ? 'Обмен с Notion выключен. Статус платформы сохранён.' : saved.notion_sync?.state === 'conflict' ? 'Нужно разрешить расхождение с Notion в сверке полей.' : undefined })
    },
    onError: error => toast({ title: 'Не удалось сохранить статус', description: getErrorMessage(error), variant: 'destructive' }),
  })
  if (editing) return <form className="grid gap-1.5" onSubmit={event => { event.preventDefault(); save.mutate() }}>
    <select aria-label={`Статус: ${student.full_name ?? 'ученик'}`} value={draft} onChange={event => setDraft(event.target.value as PipelineStatus)} disabled={save.isPending} className="max-w-full rounded-ctl border border-p-line bg-p-panel p-1.5 text-xs text-p-text">
      {Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <div className="flex gap-3 text-xs"><button type="submit" disabled={save.isPending} className="font-semibold underline">{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button><button type="button" disabled={save.isPending} onClick={() => setEditing(false)}>Отмена</button></div>
  </form>
  const source = student.status_source === 'notion' ? 'Notion' : student.status_source === 'crm' ? 'Платформа' : ''
  return <div className="max-w-64 space-y-1">
    <StudentPipelineStatusBadge status={student.pipeline_status ?? 'no_status'} />
    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-p-muted">
      {source && <span>{source}</span>}
      {can('student_work_status', 'edit') && <button type="button" aria-label={`Изменить статус: ${student.full_name ?? 'ученик'}`} className="underline" onClick={() => { setDraft(normalizeStudentPipelineStatus(student.pipeline_status)); setEditing(true) }}>Изменить</button>}
    </div>
    {student.status_sync_state && SYNC_LABELS[student.status_sync_state] && student.status_sync_state !== 'crm_empty' && <details className="text-[11px] text-p-muted">
      <summary className="cursor-pointer">{SYNC_LABELS[student.status_sync_state]}</summary>
      <p>Notion: {student.notion_status_raw || 'не заполнен'}<br />Платформа: {PIPELINE_STATUS_LABELS[student.crm_status as PipelineStatus] ?? student.crm_status ?? 'не заполнен'}</p>
    </details>}
  </div>
}
