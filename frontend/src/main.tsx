import { reportClientRuntimeError } from '@/lib/clientRuntimeErrors'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App, { isRecoverableAppError, recoverPageOnce } from './App'
import './index.css'
import { TestDbBanner } from './components/shared/TestDbBanner'

// Error-tracking. Включается только если задан VITE_SENTRY_DSN — без него no-op.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // Трейсинг выключен по умолчанию (0) — включай точечно, когда понадобится.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  })
}

// Boundary ловит ошибки рендера React, но не отклонённые Promise и отдельные
// DOM-операции браузера. Для известных восстанавливаемых сбоев (устаревший
// чанк, рассинхронизация DOM) действуем одинаково во всех трёх каналах.
// Неизвестные ошибки не перезагружаем: их увидит Sentry и экран диагностики.
function recoverGlobalRuntimeError(reason: unknown) {
  const error = reason instanceof Error
    ? reason
    : new Error(typeof reason === 'string' ? reason : String(reason))
  reportClientRuntimeError(error, '', 'unhandled')
  if (isRecoverableAppError(error)) recoverPageOnce()
}

window.addEventListener('error', (event) => recoverGlobalRuntimeError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => recoverGlobalRuntimeError(event.reason))

function renderApp() {
ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <TestDbBanner />
    <App />
  </>
)

}
// Explicit local-only mode for reviewing the real student card with sample contracts.
const actsPreview = import.meta.env.DEV && import.meta.env.VITE_LOCAL_API_PORT === '8099'
  && ['127.0.0.1', 'localhost'].includes(location.hostname)
  && new URLSearchParams(location.search).get('actsPreview') === '1'
if (actsPreview) {
  import('./dev/actsPreviewFixtures').then(({ installActsPreview }) => {
    installActsPreview('Асель Демо', 'Айгуль Демо')
    renderApp()
  })
} else renderApp()
