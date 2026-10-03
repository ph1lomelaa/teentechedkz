import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, LayoutGrid, List } from 'lucide-react'
import { activitiesApi, type BoardItem, type BoardView, type Participation } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { BOARD_COLUMNS, BOARD_LABEL, boardContext } from '@/lib/activityUi'
import { DirectionBadge, FilterChip, ProgressSegments } from './ActivityParts'
import { ParticipationPanel } from './ParticipationPanel'

const views: Array<{ key: BoardView; label: string }> = [{ key: 'waiting', label: 'Ждут меня' }, { key: 'all', label: 'Все ученики' }, { key: 'due_soon', label: 'Срок скоро' }, { key: 'closed', label: 'Не интересно / отменено' }]
function StudentAvatar({ name }: { name: string }) { return <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ds-panel2 text-xs font-bold text-ds-muted">{name.split(/\s+/).slice(0, 2).map(p => p[0]).join('')}</span> }
function BoardCard({ item, onOpen, chatPath }: { item: BoardItem; onOpen: (p: Participation) => void; chatPath: string }) {
  return <article className="rounded-panel border border-ds-line bg-ds-panel p-4 shadow-sm">
    <div className="flex min-w-0 items-center gap-2"><StudentAvatar name={item.student_name || 'Ученик'} /><span title={item.student_name ?? ''} className="truncate text-sm font-bold">{item.student_name || 'Ученик'}</span></div>
    <button className="mt-3 line-clamp-3 break-words text-left text-sm font-semibold hover:underline" title={item.activity.title} onClick={() => onOpen(item)}>{item.activity.title}</button>
    <p className="mt-2 text-xs text-ds-muted">{boardContext(item)}</p><ProgressSegments steps={item.steps} className="mt-3" />
    {item.column === 'planning' && <AppButton size="sm" variant="subtle" className="mt-4 w-full" onClick={() => onOpen(item)}>Составить план</AppButton>}
    {item.column === 'review' && <Link className="mt-4 block rounded-ctl border border-ds-line px-3 py-2 text-center text-xs font-bold hover:bg-ds-panel2" to={`/workspace/tasks?student_id=${item.student_id}&view=review`}>Проверить</Link>}
    {item.needs_reminder && <Link className="mt-4 block text-center text-xs font-bold underline underline-offset-4" to={`${chatPath}?student_id=${item.student_id}`}>Напомнить</Link>}
  </article>
}
export function ParticipationBoard({ studentId }: { studentId?: string }) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<BoardView | null>(null)
  const [table, setTable] = useState(false)
  const [page, setPage] = useState(0)
  const [opened, setOpened] = useState<Participation | null>(null)
  const summary = useQuery({ queryKey: ['activities', 'board-summary', studentId], queryFn: () => activitiesApi.overview({ ...(studentId ? { student_id: studentId } : {}), limit: 1 }) })
  const effective = view ?? (summary.data?.counts.waiting ? 'waiting' : 'all')
  const query = useQuery({ queryKey: ['activities', 'board', studentId, search, effective, table, page], enabled: !!summary.data, queryFn: async () => {
    const params = { ...(studentId ? { student_id: studentId } : {}), q: search, view: effective }
    if (table) return activitiesApi.overview({ ...params, limit: 25, offset: page * 25 })
    const first = await activitiesApi.overview({ ...params, limit: 500 })
    for (let offset = 500; offset < first.total; offset += 500) { const more = await activitiesApi.overview({ ...params, limit: 500, offset }); first.items.push(...more.items) }
    return first
  } })
  const counts = query.data?.counts ?? summary.data?.counts
  return <div className="space-y-4">
    {opened && <ParticipationPanel key={opened.id} item={opened} onClose={() => setOpened(null)} />}
    <div className="flex flex-wrap gap-3"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" /><Input aria-label="Поиск участий" className="pl-10" placeholder="Ученик или активность" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></div><AppButton variant="subtle" onClick={() => { setTable(!table); setPage(0) }}>{table ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}{table ? 'Доской' : 'Таблицей'}</AppButton></div>
    <div className="flex flex-wrap gap-2">{views.map(v => <FilterChip key={v.key} active={effective === v.key} onClick={() => { setView(v.key); setPage(0) }} count={counts?.[v.key]}>{v.label}</FilterChip>)}</div>
    <QueryState isLoading={summary.isLoading || query.isLoading} isError={summary.isError || query.isError} error={summary.error || query.error} onRetry={() => { summary.refetch(); query.refetch() }}>
      {table || effective === 'closed' ? <><div className="overflow-x-auto rounded-card border border-ds-line bg-ds-panel"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-ds-panel2 text-xs text-ds-muted"><tr>{['Ученик', 'Активность', 'Состояние', 'Шаги', ''].map(t => <th key={t} className="p-4">{t}</th>)}</tr></thead><tbody>{query.data?.items.map(p => <tr key={p.id} className="border-t border-ds-line"><td className="p-4">{p.student_name}</td><td className="p-4"><p className="max-w-sm break-words font-bold">{p.activity.title}</p><DirectionBadge direction={p.activity.direction} /></td><td className="p-4">{BOARD_LABEL[p.column]}</td><td className="p-4 text-ds-muted">{boardContext(p)}</td><td className="p-4"><AppButton size="sm" variant="subtle" onClick={() => setOpened(p)}>Открыть план</AppButton></td></tr>)}</tbody></table>{!query.data?.items.length && <p className="p-8 text-center text-sm text-ds-muted">Нет участий по выбранным фильтрам.</p>}</div>{table && <div className="flex items-center justify-between gap-2 text-sm text-ds-muted"><span>Всего: {query.data?.total ?? 0}</span><div className="flex gap-2"><AppButton size="sm" variant="subtle" disabled={!page} onClick={() => setPage(page - 1)}>Назад</AppButton><AppButton size="sm" variant="subtle" disabled={(page + 1) * 25 >= (query.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Далее</AppButton></div></div>}</> : <div className="overflow-x-auto pb-3"><div className="grid min-w-[980px] grid-cols-5 gap-3">{BOARD_COLUMNS.map(col => { const items = query.data?.items.filter(p => p.column === col.key) ?? []; return <section key={col.key} aria-label={col.title} className="min-w-0 rounded-card bg-ds-panel2 p-3"><header className="mb-4 px-1"><h2 className="flex justify-between text-sm font-bold">{col.title}<span className="text-ds-muted">{items.length}</span></h2><p className="mt-1 text-xs text-ds-muted">{col.hint}</p></header><div className="space-y-3">{items.map(item => <BoardCard key={item.id} item={item} onOpen={setOpened} chatPath="/workspace/chat" />)}{!items.length && <p className="py-8 text-center text-xs text-ds-muted">Пока пусто</p>}</div></section> })}</div></div>}
    </QueryState>
  </div>
}
