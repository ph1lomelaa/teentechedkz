import { invalidateStudent } from '@/lib/queryKeys'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/types'
import { toast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'

export function BulkStudentStatus({ students }: { students: { id: string; full_name: string }[] }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<PipelineStatus>('active_work')
  const [failed, setFailed] = useState<string[]>([])
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: async () => {
      // Bounded concurrency; a failed row is reported and never hides others.
      const errors: string[] = []
      for (let start = 0; start < students.length; start += 5) {
        const batch = students.slice(start, start + 5)
        const results = await Promise.allSettled(batch.map(student => studentsApi.update(student.id, { pipeline_status: status })))
        results.forEach((result, index) => { if (result.status === 'rejected') errors.push(batch[index].full_name) })
      }
      return errors
    },
    onSuccess: errors => {
      for (const key of ['students', 'assignment-board', 'workspace', 'notion', 'my-students']) qc.invalidateQueries({ queryKey: [key] })
      students.forEach(student => invalidateStudent(qc, student.id))
      setFailed(errors)
      if (!errors.length) setOpen(false)
      toast({ title: `Сохранено: ${students.length - errors.length} из ${students.length}`, description: errors.length ? 'Не все карточки удалось обновить. Список ошибок показан в окне.' : 'Состояние обмена с Notion видно в карточках.', variant: errors.length ? 'destructive' : 'default' })
    },
  })
  return <><button type="button" disabled={!students.length || students.length > 200} onClick={() => { setFailed([]); setOpen(true) }} className="min-h-9 rounded-ctl border border-p-line px-3 text-xs font-semibold disabled:opacity-40">Изменить статус выбранных</button>
    <Dialog open={open} onOpenChange={next => { if (!save.isPending) setOpen(next) }}><DialogContent><DialogHeader><DialogTitle>Изменить статус · {students.length} учеников</DialogTitle><DialogDescription>Карточки и назначения сохраняются. Связанные статусы передаются в Notion; спорные значения остаются на сверку.</DialogDescription></DialogHeader>
      <details><summary className="cursor-pointer text-sm">Выбранные ученики</summary><ul className="max-h-40 overflow-auto text-sm">{students.map(student => <li key={student.id}>{student.full_name}</li>)}</ul></details>
      <label className="grid gap-2 text-sm">Новый статус<select aria-label="Массовый статус" value={status} onChange={event => setStatus(event.target.value as PipelineStatus)} disabled={save.isPending} className="rounded-ctl border border-p-line bg-p-panel p-2">{Object.entries(PIPELINE_STATUS_LABELS).filter(([value]) => value !== 'no_status').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {failed.length > 0 && <div role="alert" className="text-sm text-red-600">Не сохранены: {failed.join(', ')}. Закройте окно и повторно выберите эти карточки.</div>}
      <button type="button" disabled={save.isPending || failed.length > 0} onClick={() => save.mutate()} className="min-h-9 rounded-ctl bg-p-accent px-3 text-sm font-semibold text-black">{save.isPending ? 'Сохраняем…' : `Применить к ${students.length} ученикам`}</button>
    </DialogContent></Dialog>
  </>
}
