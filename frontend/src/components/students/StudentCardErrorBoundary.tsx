import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { reportClientRuntimeError } from '@/lib/clientRuntimeErrors'

type Props = { children: React.ReactNode; workspace?: boolean }

class CardBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientRuntimeError(error, info.componentStack ?? '')
    Sentry.captureException(error, { tags: { error_source: 'student_card' } })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert" className="rounded-card border border-current/15 p-6">
      <h1 className="text-xl font-bold">Не удалось открыть карточку</h1>
      <p className="mt-2 text-sm">Попробуйте открыть её ещё раз или вернитесь к списку учеников.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="rounded border px-4 py-2 text-sm" onClick={() => this.setState({ failed: false })}>Повторить</button>
        <Link className="rounded border px-4 py-2 text-sm" to={this.props.workspace ? '/workspace/students' : '/students'}>К списку учеников</Link>
      </div>
    </section>
  }
}

/** A broken card must leave navigation and the authenticated session mounted. */
export function StudentCardErrorBoundary(props: Props) {
  const location = useLocation()
  return <CardBoundary key={location.pathname} {...props} />
}
