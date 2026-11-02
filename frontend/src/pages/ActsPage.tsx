import { useSearchParams } from 'react-router-dom'
import { ActsTable } from '@/components/acts/ActsTable'

export function ActsPage() {
  const [params, setParams] = useSearchParams()
  const selectStudent = (id: string | null) => setParams(old => { const next = new URLSearchParams(old); if (id) next.set('student', id); else next.delete('student'); return next })
  return <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 text-p-text sm:p-6">
    <header><p className="text-xs font-semibold uppercase tracking-wider text-p-muted">Документы студентов</p><h1 className="mt-1 text-3xl font-bold">Договоры и акты</h1>
      <p className="mt-2 text-sm text-p-muted">Договор TrustMe и акты по каждой услуге. Нажмите на акт — скачается PDF, на ФИО — откроются договоры и акты студента.</p></header>
    <ActsTable selected={params.get('student')} onSelect={selectStudent} />
  </div>
}
