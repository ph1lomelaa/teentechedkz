import { X } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/primitives/dialog'
import { Input } from '@/components/ui/primitives/input'
import { Textarea } from '@/components/ui/primitives/textarea'
import { cn } from '@/lib/utils'
import {
  addDraftListItem,
  addProfileUpdate,
  removeDraftListItem,
  removeProfileUpdate,
  replaceDraftListItem,
  updateProfileUpdate,
  type ContextDraftListKey,
} from '@/lib/contextDraft'
import type { TelegramContextDraft } from '@/types'

const LIST_SECTIONS: Array<{ key: ContextDraftListKey; title: string }> = [
  { key: 'profile_notes', title: 'Заметки профиля' },
  { key: 'follow_ups', title: 'Follow-up' },
  { key: 'document_flags', title: 'Документы' },
  { key: 'contradictions', title: 'Противоречия / неясности' },
  { key: 'quality_warnings', title: 'Предупреждения качества' },
]

type Variant = 'light' | 'workspace'

const VARIANT_CONTENT_CLASS: Record<Variant, string> = {
  light: '',
  workspace: 'border-w-line bg-w-panel text-w-ink',
}

const VARIANT_PANEL_CLASS: Record<Variant, string> = {
  light: 'border-p-line',
  workspace: 'border-w-line bg-w-panel2',
}

const VARIANT_MUTED_CLASS: Record<Variant, string> = {
  light: 'text-p-muted',
  workspace: 'text-w-muted',
}

const VARIANT_MUTED2_CLASS: Record<Variant, string> = {
  light: 'text-p-muted2',
  workspace: 'text-w-muted2',
}

type Props = {
  open: boolean
  draft: TelegramContextDraft | null
  onDraftChange: (draft: TelegramContextDraft) => void
  onCancel: () => void
  onConfirm: () => void
  isApplying: boolean
  variant?: Variant
  title?: string
  description?: string
  confirmLabel?: string
  footnote?: string
}

/**
 * Shared "review the AI draft before it becomes DB rows" dialog. Every string
 * in profile_notes/follow_ups/document_flags/contradictions/quality_warnings
 * turns into its own ConfidentialNote (or, on the combined workspace flow,
 * gets folded into a note/tasks) on confirm — so staff need to see and be able
 * to edit/remove each one individually here, not just a summary + counts.
 */
export function ContextDraftReviewDialog({
  open,
  draft,
  onDraftChange,
  onCancel,
  onConfirm,
  isApplying,
  variant = 'light',
  title = 'Заметки из Telegram',
  description = 'Проверьте черновик перед сохранением. В профиль попадут только оставленные пункты.',
  confirmLabel = 'Сохранить выбранное',
  footnote,
}: Props) {
  const panelClass = VARIANT_PANEL_CLASS[variant]
  const mutedClass = VARIANT_MUTED_CLASS[variant]
  const muted2Class = VARIANT_MUTED2_CLASS[variant]

  const renderList = (key: ContextDraftListKey, listTitle: string) => {
    if (!draft) return null
    const items = draft[key]
    return (
      <div className="space-y-2" key={key}>
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-xs font-medium uppercase tracking-[0.16em]', mutedClass)}>{listTitle}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => onDraftChange(addDraftListItem(draft, key))}
          >
            Добавить
          </Button>
        </div>
        {items.length === 0 ? (
          <p className={cn('text-xs', muted2Class)}>Нет пунктов</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${key}-${index}`} className="flex items-start gap-2">
                <Textarea
                  value={item}
                  className="min-h-[64px] text-sm"
                  onChange={(event) => onDraftChange(replaceDraftListItem(draft, key, index, event.target.value))}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  onClick={() => onDraftChange(removeDraftListItem(draft, key, index))}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className={cn('max-w-4xl max-h-[90vh] overflow-y-auto', VARIANT_CONTENT_CLASS[variant])}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={variant === 'workspace' ? 'text-w-muted' : undefined}>
            {description}
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="space-y-5">
            {draft.source_filter?.q && (
              <div className="rounded-panel border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                AI-разбор создан только по сообщениям, найденным по запросу: "{draft.source_filter.q}".
              </div>
            )}
            <div className="space-y-2">
              <p className={cn('text-xs font-medium uppercase tracking-[0.16em]', mutedClass)}>Кратко</p>
              <Textarea
                value={draft.summary}
                className="min-h-[84px]"
                onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className={cn('text-xs font-medium uppercase tracking-[0.16em]', mutedClass)}>Изменения полей</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onDraftChange(addProfileUpdate(draft))}
                >
                  Добавить
                </Button>
              </div>
              {draft.profile_updates.length === 0 ? (
                <p className={cn('text-xs', muted2Class)}>Подтверждённых изменений полей нет</p>
              ) : (
                <div className="space-y-2">
                  {draft.profile_updates.map((item, index) => (
                    <div key={index} className={cn('grid gap-2 rounded-panel border p-3 md:grid-cols-[1fr_1fr_auto]', panelClass)}>
                      <Input
                        value={item.field}
                        placeholder="field"
                        onChange={(event) => onDraftChange(updateProfileUpdate(draft, index, { field: event.target.value }))}
                      />
                      <Input
                        value={String(item.value ?? '')}
                        placeholder="Новое значение"
                        onChange={(event) => onDraftChange(updateProfileUpdate(draft, index, { value: event.target.value }))}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 w-10 p-0"
                        onClick={() => onDraftChange(removeProfileUpdate(draft, index))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                      <Textarea
                        value={item.reason || ''}
                        placeholder="Почему это подтверждено"
                        className="min-h-[56px] md:col-span-3"
                        onChange={(event) => onDraftChange(updateProfileUpdate(draft, index, { reason: event.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {LIST_SECTIONS.map(({ key, title: listTitle }) => renderList(key, listTitle))}

            {footnote && <p className={cn('text-xs', muted2Class)}>{footnote}</p>}

            {draft.ignored_as_noise.length > 0 && (
              <div className={cn('rounded-panel border p-3', panelClass)}>
                <p className={cn('text-xs font-medium uppercase tracking-[0.16em]', mutedClass)}>Не сохранять</p>
                <ul className={cn('mt-2 list-disc pl-5 text-sm', mutedClass)}>
                  {draft.ignored_as_noise.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={!draft || isApplying} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
