import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { syncApi, type NotionFieldSyncItem } from '@/api/sync'
import { Button } from '@/components/ui/primitives/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'

const FIELD_LABELS: Record<string, string> = {
  full_name: 'ФИО', phone: 'Телефон', degree_level: 'Ступень', intake_year: 'Набор',
}
const STATUS_LABELS: Record<string, string> = {
  conflict: 'Нужно выбрать источник', dry_run: 'Проверено без записи', pending: 'Ожидает обработки',
  processing: 'Обрабатывается', failed: 'Ошибка, будет повтор', superseded: 'Данные изменились после постановки',
}
const showValue = (value: string | number | null) => value == null || value === '' ? 'Пусто' : String(value)

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NotionFieldSyncReviewDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['notion', 'field-sync-queue'],
    queryFn: syncApi.notionFieldSyncQueue,
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  })
  const resolve = useMutation({
    mutationFn: ({ item, side }: { item: NotionFieldSyncItem; side: 'crm' | 'notion' }) =>
      syncApi.resolveNotionFieldConflict(item.id, side),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['notion', 'field-sync-queue'] })
      toast({
        title: 'Решение сохранено',
        description: `${variables.side === 'crm' ? 'CRM' : 'Notion'} поставлен в очередь для ${FIELD_LABELS[variables.item.field_key] ?? variables.item.field_key}.`,
      })
    },
    onError: (error) => toast({ title: 'Не удалось сохранить решение', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const choose = (item: NotionFieldSyncItem, side: 'crm' | 'notion') => {
    const source = side === 'crm' ? 'CRM' : 'Notion'
    const message = query.data?.dry_run
      ? `Выбрать ${source} для поля «${FIELD_LABELS[item.field_key] ?? item.field_key}»? Задача будет проверена в dry-run; данные пока не изменятся.`
      : `Выбрать ${source} для поля «${FIELD_LABELS[item.field_key] ?? item.field_key}»? После дополнительной проверки очередь запишет значение в противоположный источник.`
    if (window.confirm(message)) resolve.mutate({ item, side })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Сверка полей CRM ↔ Notion</DialogTitle>
          <DialogDescription>
            Выбор создаёт проверяемую задачу. Если значения успели измениться, задача остановится без перезаписи.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading && <p className="text-sm text-muted-foreground">Загружаем очередь…</p>}
        {query.isError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Не удалось загрузить сверку: {getErrorMessage(query.error)}
        </div>}
        {query.data && !query.data.enabled && <div className="rounded-xl border border-ds-line bg-ds-panel2 p-4 text-sm text-ds-muted">
          Автоматическая сверка полей выключена. Очередь включается только после подготовки миграции и отдельного пилотного флага.
        </div>}
        {query.data?.enabled && <>
          {query.data.dry_run && <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Dry-run включён: новые решения будут проверены, но не запишут изменения в CRM или Notion.
          </div>}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {Object.entries(query.data.counts).map(([status, count]) => (
              <span key={status} className="rounded-full bg-ds-panel2 px-2.5 py-1">{STATUS_LABELS[status] ?? status}: {count}</span>
            ))}
          </div>
          <div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">
            {query.data.items.length === 0 && <p className="rounded-xl border border-ds-line p-6 text-center text-sm text-ds-muted">Открытых задач нет.</p>}
            {query.data.items.map((item) => <article key={item.id} className="rounded-xl border border-ds-line bg-ds-panel p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ds-ink">{item.student_name ?? 'Студент не найден'} · {FIELD_LABELS[item.field_key] ?? item.field_key}</p>
                  <p className="text-xs text-ds-muted">{STATUS_LABELS[item.status] ?? item.status} · попыток: {item.attempts}</p>
                </div>
                {item.status === 'conflict' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-3.5 w-3.5" />Требуется выбор</span>}
                {item.status === 'dry_run' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Маппинг проверен</span>}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-ds-panel2 p-2.5 text-sm"><span className="block text-xs text-ds-muted">CRM</span>{showValue(item.crm_value)}</div>
                <div className="rounded-lg bg-ds-panel2 p-2.5 text-sm"><span className="block text-xs text-ds-muted">Notion</span>{showValue(item.notion_value)}</div>
              </div>
              {(item.reason || item.last_error) && <p className="mt-2 text-xs text-ds-muted">{item.last_error ?? item.reason}</p>}
              {item.status === 'conflict' && <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => choose(item, 'notion')}>Взять значение Notion</Button>
                <Button size="sm" disabled={resolve.isPending} onClick={() => choose(item, 'crm')}>Взять значение CRM</Button>
              </div>}
            </article>)}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />Обновить
            </Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  )
}
