import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { actsApi, type RegistryFilters } from '@/api/acts'
import { StudentActsPanel } from '@/components/students/StudentActsPanel'
import { AppButton } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { getErrorMessage } from '@/lib/errorMessage'

const input = 'w-full rounded-ctl border border-p-line bg-p-panel px-3 py-2 text-sm text-p-text'
export function ActsPage() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const selected = params.get('student')
  const [filters, setFilters] = useState<RegistryFilters>({ q: '', kind: 'all', mail_status: 'all', responsible_id: '', date_from: '', date_to: '', page: 1 })
  const [query, setQuery] = useState('')
  const registry = useQuery({ queryKey: ['acts-registry', filters], queryFn: () => actsApi.registry(filters), retry: false })
  const responsibles = useQuery({ queryKey: ['acts-responsibles'], queryFn: actsApi.responsibles, retry: false })
  const update = (key: keyof RegistryFilters, value: string) => setFilters(old => ({ ...old, [key]: value, page: 1 }))
  const selectStudent = (id: string | null) => setParams(old => { const next = new URLSearchParams(old); if (id) next.set('student', id); else next.delete('student'); return next })
  return <div className="mx-auto max-w-6xl space-y-6 p-4 text-p-text sm:p-6">
    <header><p className="text-xs uppercase tracking-wider text-p-muted">Документы студентов</p><h1 className="mt-1 text-3xl font-bold">Договоры и акты</h1><p className="mt-2 text-sm text-p-muted">Договоры TrustMe, подготовка актов и история отправки в одном месте.</p></header>
    {selected ? <>
      <div className="flex flex-wrap gap-3"><AppButton colorPrefix="p" onClick={() => selectStudent(null)}>К реестру</AppButton>
        {can('students', 'view') && <Link className="self-center text-sm underline" to={`${pathname.startsWith('/workspace') ? '/workspace' : ''}/students/${selected}#acts`}>Открыть карточку студента</Link>}</div>
      <StudentActsPanel key={selected} studentId={selected} />
    </> : <>
      <form className="grid gap-3 rounded-card border border-p-line bg-p-panel p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e => { e.preventDefault(); update('q', query.trim()) }}>
        <label className="text-sm">ФИО студента или номер договора<input className={`${input} mt-1`} value={query} maxLength={300} onChange={e => setQuery(e.target.value)} placeholder="Фамилия, имя…" /></label>
        <label className="text-sm">Документы<select className={`${input} mt-1`} value={filters.kind} onChange={e => update('kind', e.target.value)}>
          <option value="all">Все студенты</option><option value="contracts">Есть договор</option><option value="acts">Есть акты или черновики</option><option value="no_contract">Без договора</option><option value="no_act">Без актов и черновиков</option></select></label>
        <label className="text-sm">Ответственный<select className={`${input} mt-1`} value={filters.responsible_id} onChange={e => update('responsible_id', e.target.value)}><option value="">Все доступные</option>{responsibles.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-sm">Отправка<select className={`${input} mt-1`} value={filters.mail_status} onChange={e => update('mail_status', e.target.value)}><option value="all">Любой статус</option><option value="sent">Принято почтовым сервером</option><option value="sending">Отправляется</option><option value="failed">Не отправлено</option><option value="unknown">Результат неизвестен</option></select></label>
        <label className="text-sm">Дата акта с<input className={`${input} mt-1`} type="date" value={filters.date_from} onChange={e => update('date_from', e.target.value)} /></label>
        <label className="text-sm">Дата акта по<input className={`${input} mt-1`} type="date" value={filters.date_to} onChange={e => update('date_to', e.target.value)} /></label>
        <div className="flex gap-2"><AppButton colorPrefix="p" type="submit">Найти</AppButton><AppButton colorPrefix="p" type="button" onClick={() => { setQuery(''); setFilters({ q: '', kind: 'all', mail_status: 'all', responsible_id: '', date_from: '', date_to: '', page: 1 }) }}>Сбросить</AppButton></div>
      </form>
      {registry.isPending && <p role="status">Загружаем реестр…</p>}
      {registry.error && <div role="alert"><p>{getErrorMessage(registry.error, 'Не удалось загрузить реестр')}</p><button className="underline" onClick={() => registry.refetch()}>Повторить</button></div>}
      {registry.data && <>
        <p className="text-sm text-p-muted">Найдено студентов: {registry.data.total}</p>
        {!registry.data.items.length ? <p>По выбранным условиям студентов нет.</p> : <div className="overflow-x-auto rounded-card border border-p-line"><table className="w-full text-left text-sm"><thead className="bg-p-panel"><tr><th className="p-4">Студент</th><th className="p-4">Договоры</th><th className="p-4">Готовые акты</th><th className="p-4">Черновики</th></tr></thead><tbody>{registry.data.items.map(s => <tr key={s.student_id} className="border-t border-p-line"><td className="p-4"><button className="font-semibold underline underline-offset-4" onClick={() => selectStudent(s.student_id)}>{s.student_name}</button></td><td className="p-4">{s.contracts_count || 'Не привязан'}</td><td className="p-4">{s.acts_count}</td><td className="p-4">{s.drafts_count}</td></tr>)}</tbody></table></div>}
        <div className="flex items-center gap-3"><AppButton colorPrefix="p" disabled={filters.page <= 1} onClick={() => setFilters(old => ({ ...old, page: old.page-1 }))}>Назад</AppButton><span className="text-sm">Страница {filters.page}</span><AppButton colorPrefix="p" disabled={filters.page * 30 >= registry.data.total} onClick={() => setFilters(old => ({ ...old, page: old.page+1 }))}>Далее</AppButton></div>
      </>}
    </>}
  </div>
}
