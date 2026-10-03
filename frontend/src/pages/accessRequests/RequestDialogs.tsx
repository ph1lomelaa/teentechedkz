import { useEffect, useState } from 'react'
import { Check, Clock, Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { cn } from '@/lib/utils'
import {
  closeLinkedText,
  describeActionError,
  replaceConfirmText,
  type BulkRow,
  type BulkSummary,
  type ReplaceTarget,
} from './texts'

/** Пока идёт запрос, окно нельзя закрыть ни Esc, ни кликом мимо, ни крестиком:
 * иначе результат действия остался бы невидимым. */
function lockProps(locked: boolean, onClose: () => void) {
  return {
    onOpenChange: (open: boolean) => {
      if (!open && !locked) onClose()
    },
    contentProps: {
      onEscapeKeyDown: (e: KeyboardEvent) => locked && e.preventDefault(),
      onInteractOutside: (e: Event) => locked && e.preventDefault(),
      onPointerDownOutside: (e: Event) => locked && e.preventDefault(),
    },
  }
}

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-ctl border border-destructive bg-destructive/10 p-3 text-sm text-foreground">
      {children}
    </p>
  )
}

/** Подтверждение (одно действие над одной заявкой) с блокировкой на время запроса. */
function useConfirm(onRun: () => Promise<void>, onDone: () => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onRun()
      onDone()
    } catch (e) {
      setError(describeActionError(e))
    } finally {
      setPending(false)
    }
  }
  return { pending, error, run, reset: () => setError(null) }
}

export function ReplaceDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: ReplaceTarget | null
  onClose: () => void
  onConfirm: (target: ReplaceTarget) => Promise<void>
}) {
  const { pending, error, run, reset } = useConfirm(
    () => (target ? onConfirm(target) : Promise.resolve()),
    onClose,
  )
  useEffect(reset, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = target ? replaceConfirmText(target) : null
  const lock = lockProps(pending, onClose)
  return (
    <Dialog open={Boolean(target)} onOpenChange={lock.onOpenChange}>
      <DialogContent className="max-w-md" {...lock.contentProps}>
        <DialogHeader>
          <DialogTitle>Заменить кабинет?</DialogTitle>
          <DialogDescription>{text?.description}</DialogDescription>
        </DialogHeader>
        {text?.recent && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-ctl border border-st-busy/40 bg-st-busy/15 p-3 text-sm font-semibold text-st-busy"
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Пользователь недавно заходил
          </p>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button
            disabled={pending}
            onClick={run}
            className={cn(
              text?.recent && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {pending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {pending ? 'Заменяем…' : (text?.confirmLabel ?? 'Заменить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CloseLinkedDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: { id: string; cardName: string | null } | null
  onClose: () => void
  onConfirm: (id: string) => Promise<void>
}) {
  const { pending, error, run, reset } = useConfirm(
    () => (target ? onConfirm(target.id) : Promise.resolve()),
    onClose,
  )
  useEffect(reset, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  const lock = lockProps(pending, onClose)
  return (
    <Dialog open={Boolean(target)} onOpenChange={lock.onOpenChange}>
      <DialogContent className="max-w-md" {...lock.contentProps}>
        <DialogHeader>
          <DialogTitle>Закрыть заявку?</DialogTitle>
          <DialogDescription>{closeLinkedText(target?.cardName ?? null)}</DialogDescription>
        </DialogHeader>
        {error && <ErrorText>{error}</ErrorText>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={pending} onClick={run}>
            {pending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {pending ? 'Закрываем…' : 'Закрыть заявку'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type BulkState =
  | { stage: 'confirm' | 'running'; rows: BulkRow[] }
  | { stage: 'result'; rows: BulkRow[]; summary: BulkSummary }

const SUMMARY_TONE: Record<BulkSummary['kind'], string> = {
  success: 'border-st-attach/40 bg-st-attach/15',
  partial: 'border-st-check/40 bg-st-check/15',
  failed: 'border-destructive bg-destructive/10',
}

/** Массовое прикрепление: подтверждение со списком → ожидание → отчёт. */
export function BulkAttachDialog({
  state,
  onConfirm,
  onClose,
}: {
  state: BulkState | null
  onConfirm: () => void
  onClose: () => void
}) {
  const running = state?.stage === 'running'
  const lock = lockProps(running, onClose)
  return (
    <Dialog open={Boolean(state)} onOpenChange={lock.onOpenChange}>
      <DialogContent className="max-w-lg" {...lock.contentProps}>
        {state?.stage === 'result' ? (
          <>
            <DialogHeader>
              <DialogTitle>Результат</DialogTitle>
              <DialogDescription className="sr-only">Итог массового прикрепления</DialogDescription>
            </DialogHeader>
            <p
              role="status"
              className={cn('rounded-ctl border p-3 text-sm font-semibold text-foreground', SUMMARY_TONE[state.summary.kind])}
            >
              {state.summary.headline}
            </p>
            {state.summary.failed.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Эти заявки остались в списке, с пометкой об ошибке:
                </p>
                <ul className="max-h-64 space-y-2 overflow-y-auto rounded-ctl border border-border bg-muted p-3 text-sm">
                  {state.summary.failed.map((f) => (
                    <li key={f.id}>
                      <span className="font-medium text-foreground">{f.name}</span>
                      <span className="block text-destructive">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Готово</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Прикрепить заявки: {state?.rows.length ?? 0}</DialogTitle>
              <DialogDescription>
                Каждый заявитель получит кабинет выбранной карточки. Сервер перед этим проверит
                заявки ещё раз и пропустит те, что изменились.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 space-y-2 overflow-y-auto rounded-ctl border border-border bg-muted p-3 text-sm">
              {state?.rows.map((r) => (
                <li key={r.id} className="min-w-0">
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="text-muted-foreground"> · {r.phone}</span>
                  <span className="block truncate text-muted-foreground" title={r.cardName}>
                    → {r.cardName}
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" disabled={running} onClick={onClose}>
                Отмена
              </Button>
              <Button disabled={running} onClick={onConfirm}>
                {running ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {running ? 'Прикрепляем…' : `Прикрепить (${state?.rows.length ?? 0})`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
