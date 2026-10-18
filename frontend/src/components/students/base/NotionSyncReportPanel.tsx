import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { notionApi } from '@/api/notion'
import { syncApi, type NotionFieldChoice } from '@/api/sync'
import { Button } from '@/components/ui/primitives/button'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'

const QUEUE_LABELS: Record<string, string> = {
  pending: 'Ожидают', processing: 'Обрабатываются', dry_run: 'Проверены без записи',
  succeeded: 'Применены', conflict: 'Конфликты', superseded: 'Устарели', failed: 'Ошибки', resolved: 'Решены',
}

export function NotionSyncReportPanel() {
  const cache = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [side, setSide] = useState<'crm' | 'notion'>('notion')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const query = useQuery({ queryKey: ['notion', 'field-report'], queryFn: () => syncApi.notionFieldReport() })
  useEffect(() => { setSelected(new Set()); setPage(0) }, [query.data?.revision, side, search, filter])
  const fields = useMemo(() => query.data?.rows.flatMap(row => row.fields
    .filter(field => field.decision !== 'resolved')
    .map(field => ({ ...field, student: row.student_name, studentId: row.student_id, snapshotId: row.snapshot_id,
      key: `${row.snapshot_id}:${field.field_key}` }))) ?? [], [query.data])
  const visible = fields.filter(field => (!search || `${field.student} ${field.label}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
    && (filter === 'all' || (filter === 'ready' ? field.eligible : !field.eligible)))
  const selectable = visible.filter(field => !field.eligible && field.allowed_sides.includes(side))
  const choices: NotionFieldChoice[] = fields.filter(field => selected.has(field.key)).map(field => ({
    snapshot_id: field.snapshotId, field_key: field.field_key, side,
  }))
  const apply = useMutation({
    mutationFn: (conflicts: boolean) => syncApi.applyNotionFieldReport(query.data!.revision, conflicts ? choices : []),
    onSuccess: (result) => {
      toast({ title: result.dry_run ? 'Партия отправлена на проверку без записи' : 'Партия поставлена в очередь', description: `Полей: ${result.queued}. Актуальность значений проверяется перед применением.` })
      setSelected(new Set())
      void cache.invalidateQueries({ queryKey: ['notion'] })
      void cache.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (error) => {
      toast({ title: 'Партия не применена', description: getErrorMessage(error), variant: 'destructive' })
      void query.refetch()
    },
  })
  const refresh = useMutation({
    mutationFn: notionApi.run,
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['notion'] }); toast({ title: 'Данные Notion обновлены' }) },
    onError: (error) => toast({ title: 'Не удалось прочитать Notion', description: getErrorMessage(error), variant: 'destructive' }),
  })
  if (query.isLoading) return <p className="py-8 text-center text-sm text-ds-muted">Сверяем всю базу…</p>
  if (query.isError) return <div role="alert" className="space-y-3 text-sm"><p>{getErrorMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>Повторить</Button></div>
  const report = query.data
  if (!report) return null
  const canApply = report.enabled && report.fresh && !apply.isPending && !refresh.isPending && !query.isFetching
  const confirm = (conflicts: boolean) => {
    const count = conflicts ? choices.length : report.ready
    const message = conflicts ? `Выбрать ${side === 'notion' ? 'Notion' : 'платформу'} источником для ${count} выбранных полей?` : `Поставить ${count} однозначных изменений всей базы в очередь?`
    if (window.confirm(`${message} ${report.dry_run ? 'Включена проверка без записи.' : 'Перед записью значения будут проверены повторно.'}`)) apply.mutate(conflicts)
  }
  return <div className="space-y-4">
    <div className="rounded-xl border border-ds-line bg-ds-panel2 p-3 text-sm" role="status">
      <p className="font-semibold">{!report.enabled ? 'Автоматическое применение выключено' : report.dry_run ? 'Проверка без записи' : 'Автоматический обмен включён'}</p>
      <p className="mt-1 text-ds-muted">Последнее успешное чтение: {report.last_read.ok && report.last_read.at ? new Date(report.last_read.at).toLocaleString('ru-RU') : 'не подтверждено'}.</p>
      {!report.fresh && <p className="mt-1 text-amber-700 dark:text-amber-300">Данные требуют обновления из Notion. Применение недоступно до успешного чтения.</p>}
      {!!report.pilot_students && <p>Пилот: обработка ограничена выбранными студентами ({report.pilot_students}).</p>}
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><span>Студентов: <b>{report.students}</b></span><span>Готово: <b>{report.ready}</b></span><span>Notion → платформа: <b>{report.directions.notion ?? 0}</b></span><span>Платформа → Notion: <b>{report.directions.crm ?? 0}</b></span><span>Требуют разбора: <b>{report.review}</b></span></div>
    <p className="text-xs text-ds-muted">Несколько страниц Notion: {report.duplicate_students} студентов. Назначения команды и права доступа этим обменом не меняются.</p>
    <div className="flex flex-wrap gap-2 text-xs text-ds-muted">{Object.entries(report.queue_counts).map(([key, value]) => <span key={key}>{QUEUE_LABELS[key] ?? key}: {value}</span>)}</div>
    <div className="flex flex-wrap items-center gap-2">
      {report.can_refresh && <Button variant="outline" size="sm" disabled={refresh.isPending || apply.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? 'Читаем Notion…' : 'Обновить из Notion'}</Button>}
      <input aria-label="Поиск в отчёте" value={search} onChange={event => setSearch(event.target.value)} placeholder="Студент или поле" className="rounded-lg border border-ds-line bg-ds-panel px-3 py-2 text-sm" />
      <select aria-label="Поля отчёта" value={filter} onChange={event => setFilter(event.target.value)} className="rounded-lg border border-ds-line bg-ds-panel px-3 py-2 text-sm"><option value="all">Все расхождения</option><option value="ready">Однозначные</option><option value="review">Требуют разбора</option></select>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching || apply.isPending}><RefreshCw className="mr-2 h-4 w-4" />Обновить отчёт</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm"><span>Для выбранных конфликтов:</span><select aria-label="Источник для конфликтов" value={side} onChange={event => setSide(event.target.value as 'crm' | 'notion')} className="rounded-lg border border-ds-line bg-ds-panel p-2"><option value="notion">Взять из Notion</option><option value="crm">Взять с платформы</option></select><Button variant="outline" size="sm" onClick={() => setSelected(new Set(selectable.map(field => field.key)))} disabled={!selectable.length || apply.isPending}>Выбрать доступные ({selectable.length})</Button>{!!selected.size && <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Снять выбор</Button>}</div>
    <div className="max-h-[38dvh] space-y-2 overflow-y-auto pr-1">
      {visible.slice(page * 50, (page + 1) * 50).map(field => <article key={field.key} className="rounded-xl border border-ds-line p-3 text-sm">
        <div className="flex items-start gap-2">{!field.eligible && field.allowed_sides.includes(side) && <input type="checkbox" aria-label={`Выбрать ${field.label}: ${field.student}`} checked={selected.has(field.key)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(field.key); else next.delete(field.key); return next })} className="mt-1" />}<div className="min-w-0 flex-1"><Link to={`/students/${field.studentId}#notion`} className="font-semibold underline underline-offset-2">{field.student}</Link><p>{field.label}</p></div><span className="text-xs text-ds-muted">{field.eligible ? field.winner === 'notion' ? 'Notion → платформа' : 'Платформа → Notion' : 'Требует разбора'}</span></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><p className="rounded-lg bg-ds-panel2 p-2"><span className="block text-xs text-ds-muted">Платформа</span>{field.crm ?? 'Пусто'}</p><p className="rounded-lg bg-ds-panel2 p-2"><span className="block text-xs text-ds-muted">Notion</span>{field.notion ?? 'Пусто'}</p></div>{field.reason && <p className="mt-2 text-xs text-ds-muted">{field.reason}</p>}
      </article>)}
      {!visible.length && <p className="py-6 text-center text-ds-muted">Расхождений по выбранным условиям нет.</p>}
    </div>
    {visible.length > 50 && <div className="flex items-center justify-center gap-3 text-sm"><Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Назад</Button><span>{page + 1} / {Math.ceil(visible.length / 50)}</span><Button size="sm" variant="outline" disabled={(page + 1) * 50 >= visible.length} onClick={() => setPage(page + 1)}>Далее</Button></div>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={!canApply || !choices.length} onClick={() => confirm(true)}>Подтвердить выбранные ({choices.length})</Button><Button disabled={!canApply || !report.ready} onClick={() => confirm(false)}>Обработать однозначные ({report.ready})</Button></div>
  </div>
}
