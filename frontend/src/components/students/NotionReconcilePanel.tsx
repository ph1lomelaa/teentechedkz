import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, X } from 'lucide-react'
import { notionApi, type NotionReconcileReport } from '@/api/notion'
import { Button } from '@/components/ui/primitives/button'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'

type Tab = 'platform_only' | 'notion_only' | 'mismatched' | 'notion_hidden'

const STATE_RU: Record<string, string> = {
  new: 'не привязана', ignored: 'скрыта', linked: 'привязана', linked_to_deleted: 'к удалённой карточке',
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—')

/**
 * Сверка «платформа ↔ Notion»: счётчики по каждому статусу и списки — кого
 * не хватает с каждой стороны и где значения разошлись. Только чтение, кроме
 * кнопки «Создать в Notion» для студента без похожей строки.
 */
export function NotionReconcilePanel({ onClose, canCreate }: { onClose: () => void; canCreate: boolean }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('platform_only')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notion', 'reconcile'],
    queryFn: notionApi.reconcile,
    refetchInterval: 60_000,
  })

  const create = useMutation({
    mutationFn: (id: string) => notionApi.createPageForStudent(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['notion'] })
      qc.invalidateQueries({ queryKey: ['students'] })
      const text: Record<string, string> = {
        created: 'Страница создана в Notion', linked_existing: 'Найдена страница с таким ФИО — привязана',
        similar_in_notion: 'В Notion есть похожая строка — привяжите её в «Привязки Notion»',
        several_in_notion: 'В Notion несколько страниц с таким ФИО — нужна ручная проверка',
        no_status: 'Сначала поставьте статус', already_linked: 'Уже есть в Notion',
      }
      toast({ title: text[res.state] ?? res.state, variant: ['created', 'linked_existing', 'already_linked'].includes(res.state) ? undefined : 'destructive' })
    },
    onError: (err) => toast({ title: 'Не удалось создать страницу', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const tabs: { value: Tab; label: string; count: (r: NotionReconcileReport) => number }[] = [
    { value: 'platform_only', label: 'Нет в Notion', count: r => r.platform_only.length },
    { value: 'notion_only', label: 'Нет на платформе', count: r => r.notion_only.length },
    { value: 'mismatched', label: 'Расходятся значения', count: r => r.mismatched.length },
    { value: 'notion_hidden', label: 'Скрытые строки Notion', count: r => r.notion_hidden.length },
  ]

  return (
    <div className="rounded-card border border-p-line">
      <div className="flex flex-wrap items-center gap-3 border-b border-p-line px-4 py-3">
        <p className="label-caps">Сверка с Notion</p>
        {data && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${data.unmatched === 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          {data.unmatched === 0 ? 'Всё сходится' : `Не сходится: ${data.unmatched}`}
        </span>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClose} aria-label="Закрыть сверку"><X className="mr-1 h-4 w-4" />Закрыть</Button>
      </div>

      {isLoading && <p className="px-4 py-6 text-sm text-p-muted">Считаем…</p>}
      {error && <p className="px-4 py-6 text-sm text-red-700">Не удалось загрузить сверку. <button className="underline" onClick={() => refetch()}>Повторить</button></p>}

      {data && <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-p-line p-3"><p className="text-xs text-p-muted">Платформа</p><p className="text-2xl font-bold tabular-nums">{data.platform_total}</p></div>
          <div className="rounded-xl border border-p-line p-3"><p className="text-xs text-p-muted">Notion</p><p className="text-2xl font-bold tabular-nums">{data.notion_total}</p></div>
          <div className="rounded-xl border border-p-line p-3"><p className="text-xs text-p-muted">Ждут статуса (в Notion уйдут после статуса)</p><p className="text-2xl font-bold tabular-nums">{data.waiting_status}</p></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="border-b border-p-line text-left text-xs text-p-muted"><th className="py-2 pr-3">Статус</th><th className="py-2 pr-3 text-right">Платформа</th><th className="py-2 pr-3 text-right">Notion</th><th className="py-2 text-right">Разница</th></tr></thead>
            <tbody>
              {data.by_status.map(row => <tr key={row.status} className="border-b border-p-line/60">
                <td className="py-1.5 pr-3">{row.label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.platform}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.notion}</td>
                <td className={`py-1.5 text-right tabular-nums font-semibold ${row.difference === 0 || row.status === 'no_status' ? 'text-p-muted' : 'text-amber-700 dark:text-amber-300'}`}>{row.difference > 0 ? `+${row.difference}` : row.difference}</td>
              </tr>)}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-1 rounded-panel border border-p-line bg-p-bg p-1">
          {tabs.map(t => <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`rounded-ctl px-3 py-1.5 text-xs font-medium ${tab === t.value ? 'bg-p-panel text-p-text shadow-sm' : 'text-p-muted hover:text-p-text'}`}>
            {t.label} · {t.count(data)}
          </button>)}
        </div>

        <div className="overflow-x-auto">
          {tab === 'platform_only' && <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-p-line text-left text-xs text-p-muted"><th className="py-2 pr-3">Студент</th><th className="pr-3">Статус</th><th className="pr-3">Год</th><th className="pr-3">Создан</th><th className="pr-3">Анкеты</th><th className="pr-3">Что дальше</th><th /></tr></thead>
            <tbody>{data.platform_only.map(r => <tr key={r.student_id} className="border-b border-p-line/60 align-top">
              <td className="py-1.5 pr-3"><Link className="font-medium underline-offset-2 hover:underline" to={`/students/${r.student_id}`}>{r.full_name}</Link><div className="text-xs text-p-muted">{r.phone}</div></td>
              <td className="pr-3">{data.by_status.find(s => s.status === r.status)?.label ?? r.status}</td>
              <td className="pr-3 tabular-nums">{r.intake_year ?? '—'}</td>
              <td className="pr-3 tabular-nums">{fmtDate(r.created_at)}</td>
              <td className="pr-3">{r.forms || '—'}</td>
              <td className="pr-3 text-xs">{r.reason}{r.similar?.map(s => <div key={s.name}>{s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name} <span className="text-p-muted">({STATE_RU[s.state] ?? s.state})</span></div>)}</td>
              <td className="py-1">{canCreate && r.status !== 'no_status' && !r.similar?.length && <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate(r.student_id)}>Создать в Notion</Button>}</td>
            </tr>)}</tbody>
          </table>}

          {(tab === 'notion_only' || tab === 'notion_hidden') && <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-p-line text-left text-xs text-p-muted"><th className="py-2 pr-3">Строка Notion</th><th className="pr-3">Статус</th><th className="pr-3">Год</th><th className="pr-3">Телефон</th><th className="pr-3">Состояние</th></tr></thead>
            <tbody>{(tab === 'notion_only' ? data.notion_only : data.notion_hidden).map((r, i) => <tr key={`${r.url}-${i}`} className="border-b border-p-line/60">
              <td className="py-1.5 pr-3">{r.url ? <a className="inline-flex items-center gap-1 underline-offset-2 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.name}<ExternalLink className="h-3 w-3" /></a> : r.name}</td>
              <td className="pr-3">{data.by_status.find(s => s.status === r.status)?.label ?? r.status}</td>
              <td className="pr-3 tabular-nums">{r.intake_year ?? '—'}</td>
              <td className="pr-3">{r.phone ?? '—'}</td>
              <td className="pr-3 text-xs">{STATE_RU[r.state] ?? r.state}</td>
            </tr>)}</tbody>
          </table>}

          {tab === 'mismatched' && <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-p-line text-left text-xs text-p-muted"><th className="py-2 pr-3">Студент</th><th className="pr-3">Поле</th><th className="pr-3">Платформа</th><th className="pr-3">Notion</th></tr></thead>
            <tbody>{data.mismatched.flatMap(r => (r.diffs ?? []).map((d, i) => <tr key={`${r.student_id}-${d.field}`} className="border-b border-p-line/60">
              <td className="py-1.5 pr-3">{i === 0 && <><Link className="font-medium hover:underline" to={`/students/${r.student_id}`}>{r.full_name}</Link>{r.notion_url && <a className="ml-1 inline-flex" href={r.notion_url} target="_blank" rel="noreferrer" aria-label="Открыть в Notion"><ExternalLink className="h-3 w-3" /></a>}</>}</td>
              <td className="pr-3">{d.field}</td><td className="pr-3">{String(d.platform ?? '—')}</td><td className="pr-3">{String(d.notion ?? '—')}</td>
            </tr>))}</tbody>
          </table>}
        </div>
      </div>}
    </div>
  )
}
