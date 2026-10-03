import { TELEGRAM_FIELD_LABELS_RU, type TelegramContextDraft, type TelegramContextProfileUpdate } from '@/types'

export type ContextDraftListKey = keyof Pick<
  TelegramContextDraft,
  'profile_notes' | 'follow_ups' | 'document_flags' | 'contradictions' | 'quality_warnings'
>

export function compactContextDraft(draft: TelegramContextDraft): TelegramContextDraft {
  const cleanList = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)
  return {
    ...draft,
    summary: draft.summary.trim(),
    profile_updates: draft.profile_updates.filter((item) => item.field.trim() && String(item.value ?? '').trim()),
    profile_notes: cleanList(draft.profile_notes),
    follow_ups: cleanList(draft.follow_ups),
    document_flags: cleanList(draft.document_flags),
    contradictions: cleanList(draft.contradictions),
    quality_warnings: cleanList(draft.quality_warnings),
    ignored_as_noise: cleanList(draft.ignored_as_noise),
  }
}

export function replaceDraftListItem(
  draft: TelegramContextDraft,
  key: ContextDraftListKey,
  index: number,
  value: string,
): TelegramContextDraft {
  return {
    ...draft,
    [key]: draft[key].map((item, i) => (i === index ? value : item)),
  }
}

export function addDraftListItem(draft: TelegramContextDraft, key: ContextDraftListKey): TelegramContextDraft {
  return { ...draft, [key]: [...draft[key], ''] }
}

export function removeDraftListItem(draft: TelegramContextDraft, key: ContextDraftListKey, index: number): TelegramContextDraft {
  return { ...draft, [key]: draft[key].filter((_, i) => i !== index) }
}

export function addProfileUpdate(draft: TelegramContextDraft): TelegramContextDraft {
  return { ...draft, profile_updates: [...draft.profile_updates, { field: '', value: '', reason: '' }] }
}

export function removeProfileUpdate(draft: TelegramContextDraft, index: number): TelegramContextDraft {
  return { ...draft, profile_updates: draft.profile_updates.filter((_, i) => i !== index) }
}

export function updateProfileUpdate(
  draft: TelegramContextDraft,
  index: number,
  patch: Partial<TelegramContextProfileUpdate>,
): TelegramContextDraft {
  return {
    ...draft,
    profile_updates: draft.profile_updates.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  }
}

export type ContextDraftSelectableKey = 'profile_updates' | ContextDraftListKey

/** Какие пункты отмечены к сохранению: массивы параллельны массивам черновика. */
export type ContextDraftSelection = Record<ContextDraftSelectableKey, boolean[]>

const SELECTABLE_KEYS: ContextDraftSelectableKey[] = [
  'profile_updates',
  'profile_notes',
  'follow_ups',
  'document_flags',
  'contradictions',
  'quality_warnings',
]

/** Сомнительные пункты по умолчанию не сохраняются — менеджер включает их сам. */
export const REVIEW_KEYS: ContextDraftListKey[] = ['contradictions', 'quality_warnings']

export function defaultSelection(draft: TelegramContextDraft): ContextDraftSelection {
  const selection = {} as ContextDraftSelection
  for (const key of SELECTABLE_KEYS) {
    const checked = !(REVIEW_KEYS as string[]).includes(key)
    selection[key] = draft[key].map(() => checked)
  }
  return selection
}

export function toggleSelection(
  selection: ContextDraftSelection,
  key: ContextDraftSelectableKey,
  index: number,
  checked: boolean,
): ContextDraftSelection {
  return { ...selection, [key]: selection[key].map((value, i) => (i === index ? checked : value)) }
}

export function selectionAfterAdd(selection: ContextDraftSelection, key: ContextDraftSelectableKey): ContextDraftSelection {
  return { ...selection, [key]: [...selection[key], true] }
}

export function selectionAfterRemove(
  selection: ContextDraftSelection,
  key: ContextDraftSelectableKey,
  index: number,
): ContextDraftSelection {
  return { ...selection, [key]: selection[key].filter((_, i) => i !== index) }
}

/**
 * Черновик для POST .../context-draft/apply: только отмеченные пункты, формат
 * тот же, что у compactContextDraft (поля не добавляются и не переименовываются).
 */
export function buildApplyDraft(draft: TelegramContextDraft, selection: ContextDraftSelection): TelegramContextDraft {
  const pick = <T,>(items: T[], key: ContextDraftSelectableKey) => items.filter((_, i) => selection[key][i] === true)
  return compactContextDraft({
    ...draft,
    profile_updates: pick(draft.profile_updates, 'profile_updates'),
    profile_notes: pick(draft.profile_notes, 'profile_notes'),
    follow_ups: pick(draft.follow_ups, 'follow_ups'),
    document_flags: pick(draft.document_flags, 'document_flags'),
    contradictions: pick(draft.contradictions, 'contradictions'),
    quality_warnings: pick(draft.quality_warnings, 'quality_warnings'),
  })
}

/** Сколько будет сохранено (по уже очищенному от пустых строк черновику). */
export function countApplyDraft(apply: TelegramContextDraft) {
  const notes =
    apply.profile_notes.length +
    apply.follow_ups.length +
    apply.document_flags.length +
    apply.contradictions.length +
    apply.quality_warnings.length
  return { fields: apply.profile_updates.length, notes }
}

/** Отпечаток правок (тексты + выбор): по нему окно понимает, что есть что терять. */
export function contextDraftFingerprint(draft: TelegramContextDraft, selection: ContextDraftSelection): string {
  return JSON.stringify([
    draft.summary,
    draft.profile_updates.map((item) => [item.field, item.value, item.reason]),
    draft.profile_notes,
    draft.follow_ups,
    draft.document_flags,
    draft.contradictions,
    draft.quality_warnings,
    selection,
  ])
}

/** Запасной режим бэкенда: черновик собран регулярками, а не моделью (model === 'heuristic'). */
export function isHeuristicDraft(draft: TelegramContextDraft): boolean {
  return draft.model === 'heuristic'
}

export const PROFILE_FIELD_OPTIONS = Object.entries(TELEGRAM_FIELD_LABELS_RU).map(([value, label]) => ({ value, label }))

export function profileFieldLabel(field: string): string {
  return TELEGRAM_FIELD_LABELS_RU[field] ?? field
}

const VALUE_LABELS_RU: Record<string, string> = {
  undergraduate: 'Бакалавриат',
  masters: 'Магистратура',
  foundation: 'Foundation',
  found_ug: 'Foundation + Бакалавриат',
  fall: 'Осень',
  spring: 'Весна',
}

/** Значение поля для показа: пустое -> «не указано», коды ступени/сезона -> по-русски. */
export function formatProfileValue(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') return 'не указано'
  const text = String(value)
  return VALUE_LABELS_RU[text] ?? text
}

/** «1 заметка / 2 заметки / 5 заметок». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function applySummaryText(result: { applied_changes: unknown[]; profile_notes_saved: number }) {
  return `Сохранено: изменений карточки ${result.applied_changes.length}, заметок ${result.profile_notes_saved}`
}
