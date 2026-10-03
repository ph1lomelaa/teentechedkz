import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Lock, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/primitives/button'
import { Checkbox } from '@/components/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog'
import { Input } from '@/components/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { AutoTextarea } from '@/components/shared/AutoTextarea'
import { cn } from '@/lib/utils'
import {
  addDraftListItem,
  addProfileUpdate,
  buildApplyDraft,
  contextDraftFingerprint,
  countApplyDraft,
  defaultSelection,
  formatProfileValue,
  isHeuristicDraft,
  PROFILE_FIELD_OPTIONS,
  pluralRu,
  profileFieldLabel,
  removeDraftListItem,
  removeProfileUpdate,
  replaceDraftListItem,
  selectionAfterAdd,
  selectionAfterRemove,
  toggleSelection,
  updateProfileUpdate,
  type ContextDraftListKey,
  type ContextDraftSelectableKey,
  type ContextDraftSelection,
} from '@/lib/contextDraft'
import type { TelegramContextDraft } from '@/types'

type Variant = 'light' | 'workspace'

const VARIANT_CONTENT_CLASS: Record<Variant, string> = {
  light: '',
  workspace: 'border-w-line bg-w-panel text-w-ink',
}

type ListSection = {
  id: string
  title: string
  dest: string
  keys: ContextDraftListKey[]
  noun: string
  review?: boolean
  confidential?: boolean
}

const LIST_SECTIONS: ListSection[] = [
  {
    id: 'notes',
    title: 'Заметки в карточку',
    dest: '→ в конфиденциальные заметки студента и в конспект',
    keys: ['profile_notes'],
    noun: 'заметку',
    confidential: true,
  },
  {
    id: 'follow-ups',
    title: 'Проверить позже',
    dest: '→ в заметки студента и в конспект (задачи пока не создаются)',
    keys: ['follow_ups'],
    noun: 'пункт «проверить позже»',
  },
  {
    id: 'documents',
    title: 'Документы',
    dest: '→ в заметки студента и в конспект',
    keys: ['document_flags'],
    noun: 'пункт о документе',
  },
  {
    id: 'review',
    title: 'Требует проверки',
    dest: '→ в заметки студента, только если вы отметите пункт',
    keys: ['contradictions', 'quality_warnings'],
    noun: 'пункт для проверки',
    review: true,
  },
]

const REVIEW_KIND_LABEL: Partial<Record<ContextDraftListKey, string>> = {
  contradictions: 'Противоречие / неясность',
  quality_warnings: 'Сомнительное распознавание',
}

type AddOption = { id: string; label: string; key: ContextDraftSelectableKey }

const ADD_OPTIONS: AddOption[] = [
  { id: 'field', label: 'Добавить изменение поля', key: 'profile_updates' },
  { id: 'note', label: 'Добавить заметку', key: 'profile_notes' },
  { id: 'follow', label: 'Добавить «проверить позже»', key: 'follow_ups' },
  { id: 'doc', label: 'Добавить документ', key: 'document_flags' },
  { id: 'review', label: 'Добавить пункт для проверки', key: 'contradictions' },
]

type Props = {
  open: boolean
  draft: TelegramContextDraft | null
  onDraftChange: (draft: TelegramContextDraft) => void
  onCancel: () => void
  /** Получает черновик только из отмеченных пунктов, в формате API apply. */
  onConfirm: (payload: TelegramContextDraft) => void
  isApplying: boolean
  variant?: Variant
  footnote?: string
}

/**
 * Окно «AI-разбор переписки»: менеджер видит, что ИИ предлагает и куда это
 * попадёт, отмечает нужное и применяет. Сомнительные пункты по умолчанию
 * не отмечены. Правки и выбор живут только пока окно открыто.
 */
export function ContextDraftReviewDialog({ open, draft, ...rest }: Props) {
  if (!open || !draft) return null
  return <ReviewDialog draft={draft} {...rest} />
}

function ReviewDialog({
  draft,
  onDraftChange,
  onCancel,
  onConfirm,
  isApplying,
  variant = 'light',
  footnote,
}: Omit<Props, 'open' | 'draft'> & { draft: TelegramContextDraft }) {
  const [selection, setSelection] = useState<ContextDraftSelection>(() => defaultSelection(draft))
  const [initialFingerprint] = useState(() => contextDraftFingerprint(draft, defaultSelection(draft)))
  const [addOpen, setAddOpen] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const keepEditingRef = useRef<HTMLButtonElement>(null)

  // Фокус остаётся на чекбоксе/поле под футером — переносим на безопасную кнопку подтверждения.
  useEffect(() => {
    if (confirmClose) keepEditingRef.current?.focus()
  }, [confirmClose])

  const dirty = contextDraftFingerprint(draft, selection) !== initialFingerprint
  const applyDraft = buildApplyDraft(draft, selection)
  const counts = countApplyDraft(applyDraft)
  const hasSummary = draft.summary.trim() !== ''
  const canApply = counts.fields + counts.notes > 0 || hasSummary
  const heuristic = isHeuristicDraft(draft)
  const limit = draft.source_filter?.limit

  const requestClose = () => {
    if (isApplying) return
    if (dirty) setConfirmClose(true)
    else onCancel()
  }

  const toggle = (key: ContextDraftSelectableKey, index: number, checked: boolean) =>
    setSelection((current) => toggleSelection(current, key, index, checked))

  const removeListItem = (key: ContextDraftListKey, index: number) => {
    onDraftChange(removeDraftListItem(draft, key, index))
    setSelection((current) => selectionAfterRemove(current, key, index))
  }

  const removeField = (index: number) => {
    onDraftChange(removeProfileUpdate(draft, index))
    setSelection((current) => selectionAfterRemove(current, 'profile_updates', index))
  }

  const addItem = (option: AddOption) => {
    if (option.key === 'profile_updates') onDraftChange(addProfileUpdate(draft))
    else onDraftChange(addDraftListItem(draft, option.key as ContextDraftListKey))
    setSelection((current) => selectionAfterAdd(current, option.key))
    setAddOpen(false)
  }

  const visibleSections = LIST_SECTIONS.filter((section) => section.keys.some((key) => draft[key].length > 0))
  const hasFieldUpdates = draft.profile_updates.length > 0
  const nothingProposed = !hasFieldUpdates && visibleSections.length === 0

  const counterParts: string[] = []
  if (counts.fields > 0) {
    counterParts.push(`${counts.fields} ${pluralRu(counts.fields, 'изменение карточки', 'изменения карточки', 'изменений карточки')}`)
  }
  if (counts.notes > 0) {
    counterParts.push(`${counts.notes} ${pluralRu(counts.notes, 'заметка', 'заметки', 'заметок')}`)
  }
  const counterText = counterParts.length
    ? `Будет сохранено: ${counterParts.join(', ')}${hasSummary ? ' + конспект' : ''}`
    : hasSummary
      ? 'Будет создан только конспект из резюме'
      : 'Ничего не выбрано'

  return (
    <Dialog open onOpenChange={(next) => !next && requestClose()}>
      <DialogContent
        className={cn(
          'flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:p-0',
          VARIANT_CONTENT_CLASS[variant],
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-w-line px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>AI-разбор переписки</DialogTitle>
          <DialogDescription className="text-w-muted">
            {draft.student_name}
            {limit ? ` · по последним сообщениям (до ${limit})` : ''}
          </DialogDescription>
          {heuristic && (
            <div
              role="status"
              className="mt-2 flex items-start gap-2 rounded-panel border border-w-accentDim/60 bg-w-accent/15 px-3 py-2 text-xs font-semibold text-w-ink"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-w-accentText" aria-hidden />
              Разбор без ИИ (по ключевым словам): проверьте предложения особенно внимательно.
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6">
          {draft.source_filter?.q && (
            <div className="rounded-panel border border-w-line bg-w-panel2 p-3 text-xs text-w-muted">
              AI-разбор создан только по сообщениям, найденным по запросу: «{draft.source_filter.q}».
            </div>
          )}

          <Section title="Резюме переписки" dest="→ войдёт в конспект студента">
            <AutoTextarea
              aria-label="Резюме переписки"
              value={draft.summary}
              placeholder="Кратко: о чём договорились"
              className="text-sm"
              onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })}
            />
          </Section>

          {hasFieldUpdates && (
            <Section title="Изменения в карточке" dest="→ в карточку студента: поля будут перезаписаны">
              {draft.profile_updates.map((item, index) => {
                const checked = selection.profile_updates[index] === true
                const label = item.field ? profileFieldLabel(item.field) : 'новое поле'
                return (
                  <ItemRow
                    key={index}
                    checked={checked}
                    checkLabel={`Применить изменение: ${label}`}
                    onCheckedChange={(value) => toggle('profile_updates', index, value)}
                    removeLabel="Удалить изменение поля"
                    onRemove={() => removeField(index)}
                  >
                    {item.field ? (
                      <p className="text-sm font-semibold text-w-ink">{label}</p>
                    ) : (
                      <Select
                        value=""
                        onValueChange={(field) =>
                          onDraftChange(
                            updateProfileUpdate(draft, index, {
                              field,
                              old_value: draft.profile_snapshot?.[field],
                            }),
                          )
                        }
                      >
                        <SelectTrigger aria-label="Какое поле изменить">
                          <SelectValue placeholder="Выберите поле" />
                        </SelectTrigger>
                        <SelectContent>
                          {PROFILE_FIELD_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="min-w-0 break-words text-sm text-w-muted sm:w-2/5">
                        <span className="sr-only">Было: </span>
                        {formatProfileValue(item.old_value)}
                      </span>
                      <ArrowRight className="hidden h-4 w-4 shrink-0 text-w-muted sm:block" aria-hidden />
                      <Input
                        aria-label={`Новое значение: ${label}`}
                        value={String(item.value ?? '')}
                        placeholder="Новое значение"
                        className="sm:flex-1"
                        onChange={(event) => onDraftChange(updateProfileUpdate(draft, index, { value: event.target.value }))}
                      />
                    </div>
                    {item.reason && <p className="text-xs text-w-muted">Причина: {item.reason}</p>}
                  </ItemRow>
                )
              })}
            </Section>
          )}

          {visibleSections.map((section) => (
            <Section
              key={section.id}
              title={section.title}
              dest={section.dest}
              badge={
                section.confidential ? (
                  <span className="inline-flex items-center gap-1 text-xs text-w-muted">
                    <Lock className="h-3 w-3" aria-hidden /> конфиденциально
                  </span>
                ) : section.review ? (
                  <span className="rounded-pill border border-w-accentDim/60 bg-w-accent/15 px-2 py-0.5 text-[11px] font-semibold text-w-ink">
                    проверьте перед сохранением
                  </span>
                ) : undefined
              }
            >
              {section.keys.flatMap((key) =>
                draft[key].map((text, index) => (
                  <ItemRow
                    key={`${key}-${index}`}
                    checked={selection[key][index] === true}
                    checkLabel={`Сохранить ${section.noun}`}
                    onCheckedChange={(value) => toggle(key, index, value)}
                    removeLabel={`Удалить ${section.noun}`}
                    onRemove={() => removeListItem(key, index)}
                  >
                    {section.review && <p className="text-xs font-semibold text-w-muted">{REVIEW_KIND_LABEL[key]}</p>}
                    <AutoTextarea
                      aria-label={section.title}
                      value={text}
                      autoFocus={text === ''}
                      className="text-sm"
                      onChange={(event) => onDraftChange(replaceDraftListItem(draft, key, index, event.target.value))}
                    />
                  </ItemRow>
                )),
              )}
            </Section>
          ))}

          {nothingProposed && (
            <p className="rounded-panel border border-dashed border-w-line p-3 text-sm text-w-muted">
              ИИ не нашёл, что сохранить. Можно оставить только резюме или добавить пункты вручную.
            </p>
          )}

          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={addOpen}
              onClick={() => setAddOpen((current) => !current)}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Добавить пункт
            </Button>
            {addOpen && (
              <div role="group" aria-label="Что добавить" className="flex flex-wrap gap-2">
                {ADD_OPTIONS.map((option) => (
                  <Button key={option.id} type="button" variant="outline" size="sm" onClick={() => addItem(option)}>
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {footnote && <p className="text-xs text-w-muted">{footnote}</p>}

          {draft.ignored_as_noise.length > 0 && (
            <details className="group rounded-panel border border-w-line p-3">
              <summary className="cursor-pointer rounded-ctl text-sm font-semibold text-w-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Отброшено ИИ ({draft.ignored_as_noise.length})
              </summary>
              <p className="mt-2 text-xs text-w-muted">Не будет сохранено: ИИ счёл это неважным или уже известным.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-w-muted">
                {draft.ignored_as_noise.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="shrink-0 border-t border-w-line px-4 py-3 sm:px-6">
          {confirmClose ? (
            <div role="alert" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-w-ink">Закрыть без сохранения? Ваши правки пропадут.</p>
              <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex">
                <Button ref={keepEditingRef} type="button" variant="outline" onClick={() => setConfirmClose(false)}>
                  Продолжить правку
                </Button>
                <Button type="button" variant="destructive" onClick={onCancel}>
                  Закрыть
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p aria-live="polite" className="text-sm text-w-muted">
                {counterText}
                {!canApply && <span className="block text-xs">Отметьте хотя бы один пункт или заполните резюме.</span>}
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex">
                <Button type="button" variant="outline" onClick={requestClose} disabled={isApplying}>
                  Отмена
                </Button>
                <Button
                  type="button"
                  disabled={!canApply || isApplying}
                  title={canApply ? undefined : 'Отметьте хотя бы один пункт или заполните резюме'}
                  onClick={() => onConfirm(applyDraft)}
                >
                  {isApplying ? 'Применяю…' : 'Применить выбранное'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  dest,
  badge,
  children,
}: {
  title: string
  dest: string
  badge?: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id={headingId} className="text-sm font-semibold text-w-ink">
            {title}
          </h3>
          {badge}
        </div>
        <p className="text-xs text-w-muted">{dest}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function ItemRow({
  checked,
  checkLabel,
  onCheckedChange,
  removeLabel,
  onRemove,
  children,
}: {
  checked: boolean
  checkLabel: string
  onCheckedChange: (checked: boolean) => void
  removeLabel: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-panel border p-3',
        checked ? 'border-w-line bg-w-panel2' : 'border-dashed border-w-line bg-transparent',
      )}
    >
      <Checkbox
        checked={checked}
        aria-label={checkLabel}
        className="mt-2.5 h-5 w-5 border-w-muted"
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-w-muted hover:text-w-ink"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}
