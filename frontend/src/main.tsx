import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
