import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App, { isRecoverableAppError, recoverPageOnce } from './App'
import './index.css'

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
  if (isRecoverableAppError(error)) recoverPageOnce()
}

window.addEventListener('error', (event) => recoverGlobalRuntimeError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => recoverGlobalRuntimeError(event.reason))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
