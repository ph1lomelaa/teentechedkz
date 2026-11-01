/** Local Vite entry only; never imported by the application or its production build. */
import ReactDOM from 'react-dom/client'
import { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { authApi } from '@/api/auth'
import { StudentActsPanel } from '@/components/students/StudentActsPanel'
import '@/index.css'
import { installActsPreview } from './actsPreviewFixtures'
const student = 'Аманбай Амина Өсімханқызы'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Local development preview only')
const resetFixture = installActsPreview()
const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Preview() {
  const [revision, setRevision] = useState(0)
  function reset(kind: string) {
    resetFixture(kind); cache.clear(); setRevision(v => v+1)
  }
  return <div className="min-h-screen bg-p-bg text-p-text"><div className="border-b border-p-line bg-p-panel px-4 py-3 text-center text-xs">ТЕСТ ДИЗАЙНА · договоры, данные и действия демонстрационные · PDF показывает пример вёрстки</div><main className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10"><p className="text-xs font-semibold tracking-widest text-p-muted">TEENTECHED / КАРТОЧКА СТУДЕНТА</p><h1 className="mt-5 text-xl font-semibold sm:text-2xl">{student}</h1><p className="mt-2 text-sm text-p-muted">Бакалавр · Активная работа · Intake 2027</p><div className="my-6 flex flex-wrap gap-2">{[['empty','Без договора'],['linked','Договор привязан'],['partial','Не хватает реквизитов'],['revoked','Договор отозван'],['search-error','Ошибка поиска']].map(([key,label]) => <button key={key} className="rounded-md border border-p-line bg-p-panel px-3 py-2 text-xs" onClick={() => reset(key)}>{label}</button>)}</div><section className="rounded-xl border border-p-line bg-p-panel p-4 sm:p-6"><h2 className="mb-5 text-base font-semibold">Договоры и акты</h2><StudentActsPanel key={revision} studentId="demo" /></section><p className="mt-4 text-xs text-p-muted">Для повторной проверки выберите состояние сверху. Изменения на этом экране не сохраняются в рабочей базе.</p></main></div>
}
async function boot() {
  await authApi.login('demo.admin@teenteched.kz', 'demo12345')
  ReactDOM.createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><QueryClientProvider client={cache}><Preview /></QueryClientProvider></AuthProvider></BrowserRouter>)
}
boot().catch(() => { document.getElementById('root')!.textContent = 'Тестовый API недоступен. Запустите локальный сервер на порту 8099.' })
