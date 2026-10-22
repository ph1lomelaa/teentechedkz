import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { syncApi } from '@/api/sync'
import { Button } from '@/components/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'

export function NotionSyncPreflight({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false)
  const cache = useQueryClient()
  const query = useQuery({ queryKey: ['notion', 'preflight', studentId], queryFn: () => syncApi.notionFieldReport(studentId), enabled: open })
  const apply = useMutation({
    mutationFn: () => syncApi.applyNotionFieldReport(query.data!.revision, studentId),
    onSuccess: (result) => {
      toast({ title: result.dry_run ? 'Изменения отправлены на проверку без записи' : 'Изменения поставлены в очередь', description: `Полей: ${result.queued}. Неоднозначные расхождения сохранены для разбора.` })
      cache.invalidateQueries({ queryKey: ['notion'] })
    },
    onError: (error) => toast({ title: 'Отчёт не применён', description: getErrorMessage(error), variant: 'destructive' }),
  })
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Отчёт перед синхронизацией</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-4xl">
      <DialogHeader><DialogTitle>Изменения Notion ↔ сайт</DialogTitle><DialogDescription>Сравнение с последним загруженным снимком Notion. Перед выпуском нужно обновить источник. Последнее изменение поля побеждает, когда его порядок достоверно известен.</DialogDescription></DialogHeader>
      {query.isLoading && <p className="text-sm text-p-muted">Готовим отчёт…</p>}
      {query.isError && <p role="alert" className="text-sm text-p-danger-text">{getErrorMessage(query.error)}</p>}
      {query.data && <>
        <div className="flex flex-wrap gap-3 text-sm"><span>Готово к передаче: <b>{query.data.ready}</b></span><span>Требует разбора: <b>{query.data.review}</b></span></div>
        <p className="rounded-panel border border-p-line bg-p-panel2 p-3 text-sm text-p-muted">{!query.data.enabled ? 'Автоматический обмен выключен. Сейчас доступен просмотр отчёта.' : query.data.dry_run ? 'Включена проверка без записи: данные источников не изменятся.' : 'Подтверждённые изменения передаются через очередь с повторной проверкой актуальности.'}</p>
        <div className="max-h-[45dvh] space-y-3 overflow-y-auto">
          {query.data.rows.flatMap((row) => row.fields.filter((field) => field.decision !== 'resolved').map((field) => <article key={`${row.snapshot_id}-${field.field_key}`} className="rounded-panel border border-p-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{field.label}</b><span className="text-xs text-p-muted">{field.eligible ? field.winner === 'notion' ? 'Notion → сайт' : 'Сайт → Notion' : 'Требует разбора'}</span></div>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><div className="rounded-ctl bg-p-panel2 p-2"><span className="block text-xs text-p-muted">Сайт</span>{field.crm ?? 'Пусто'}</div><div className="rounded-ctl bg-p-panel2 p-2"><span className="block text-xs text-p-muted">Notion</span>{field.notion ?? 'Пусто'}</div></div>
            {field.reason && <p className="mt-2 text-xs text-p-muted">{field.reason}</p>}
          </article>))}
          {query.data.ready + query.data.review === 0 && <p className="py-6 text-center text-sm text-p-muted">{query.data.students ? 'Общие поля совпадают.' : 'Связанная запись Notion не найдена.'}</p>}
        </div>
        <p className="text-xs text-p-muted">В этот обмен не входят: {query.data.excluded.join(', ').toLocaleLowerCase('ru')}.</p>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Обновить отчёт</Button>
          {query.data.enabled && query.data.ready > 0 && <Button disabled={apply.isPending} onClick={() => { if (window.confirm(`Передать ${query.data!.ready} проверенных изменений через очередь? Неопределимые конфликты останутся без изменений.`)) apply.mutate() }}>{apply.isPending ? 'Подтверждаем…' : 'Подтвердить изменения'}</Button>}
        </div>
      </>}
    </DialogContent></Dialog>
  </>
}
