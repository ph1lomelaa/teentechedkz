import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Lock } from 'lucide-react'
import { activitiesApi, type Participation } from '@/api/activities'
import { AppButton } from '@/components/ui'
import { Textarea } from '@/components/ui/primitives/textarea'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errorMessage'
import { PortfolioFiles } from './PortfolioFiles'
import { StatusTag } from './StatusTag'

/**
 * Последний пункт плана участия: итог и сертификат. Стоит в том же списке, что
 * и шаги, — это продолжение одного пути, а не отдельный процесс. Итог ментор
 * проверяет всегда; подтверждение само завершает участие.
 */
export function ResultStep({ item, number, own, canManage, ready }: {
  item: Participation; number: number; own: boolean; canManage: boolean; ready: boolean
}) {
  const client = useQueryClient()
  const [text, setText] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => ['activities', 'portal', 'workspace'].forEach((k) => client.invalidateQueries({ queryKey: [k] })),
  })
  const closed = ['completed', 'cancelled'].includes(item.status) || item.decision !== 'selected'
  const done = item.status === 'completed'
  const pending = item.result_review_status === 'pending'
  const returned = item.result_review_status === 'returned'
  // Ученику пункт открывается, когда обязательные шаги выполнены; ментор видит его всегда.
  const locked = own && !ready && !pending && !done
  const value = text ?? item.result_text ?? ''
  const tag = done ? <StatusTag tone="good">Подтверждено</StatusTag> : pending ? <StatusTag tone="info">На проверке</StatusTag>
    : returned ? <StatusTag tone="danger">Нужны правки</StatusTag> : locked ? <StatusTag>После шагов</StatusTag> : null
  return <article id="result" className={cn('scroll-mt-6 overflow-hidden rounded-card border bg-ds-panel', done ? 'border-ds-good/40' : returned ? 'border-ds-danger/40' : 'border-ds-line')}>
    <header className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
      <span aria-hidden className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black', done ? 'bg-ds-good/15 text-ds-good' : locked ? 'bg-ds-panel2 text-ds-muted' : 'bg-ds-accent text-black')}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">Итог</h3>
        <p className="mt-0.5 text-xs text-ds-muted">{locked ? 'Откроется, когда обязательные шаги будут выполнены.' : 'Опишите, что получилось, и приложите сертификат или диплом. Ментор подтвердит итог — и он появится в ваших достижениях.'}</p>
      </div>
      {tag}
    </header>
    {!locked && <div className="space-y-4 border-t border-ds-line p-4 sm:p-5">
      {item.result_review_comment && <div className={cn('rounded-ctl border p-3 text-sm', returned ? 'border-ds-danger/40' : 'border-ds-line')}><p className="mb-1 font-semibold">Комментарий ментора</p><p className="whitespace-pre-wrap">{item.result_review_comment}</p></div>}
      {own && !closed && !pending
        ? <label className="block text-sm font-semibold">Что получилось<Textarea className="mt-2" value={value} maxLength={20000} onChange={(e) => setText(e.target.value)} placeholder="Результат, место, ссылка на проект" /></label>
        : item.result_text ? <p className="whitespace-pre-wrap break-words text-sm">{item.result_text}</p> : !done && <p className="text-sm text-ds-muted">Ученик ещё не отправил итог.</p>}
      <PortfolioFiles target={{ participation_id: item.id }} result editable={(own || canManage) && item.decision === 'selected' && item.status !== 'cancelled'} />
      {own && !closed && (pending
        ? <p className="text-sm text-ds-info">Итог отправлен. Ментор проверит его и ответит здесь.</p>
        : <AppButton disabled={!value.trim() || action.isPending} onClick={() => action.mutate(() => activitiesApi.submitResult(item.id, value))}>{returned ? 'Отправить исправленный итог' : 'Отправить итог ментору'}</AppButton>)}
      {canManage && pending && !closed && <div className="space-y-3 rounded-panel bg-ds-panel2 p-4">
        <label className="block text-sm font-semibold">Комментарий ученику<Textarea className="mt-2" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="При возврате укажите, что исправить" /></label>
        <div className="flex flex-wrap gap-2">
          <AppButton disabled={action.isPending} onClick={() => action.mutate(() => activitiesApi.reviewResult(item.id, 'approve', comment))}>Подтвердить итог</AppButton>
          <AppButton variant="subtle" disabled={!comment.trim() || action.isPending} onClick={() => action.mutate(() => activitiesApi.reviewResult(item.id, 'return', comment))}>Вернуть на правки</AppButton>
        </div>
        <p className="text-xs text-ds-muted">После подтверждения участие завершится и попадёт в достижения ученика.</p>
      </div>}
      {action.isError && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(action.error)}</p>}
    </div>}
  </article>
}
