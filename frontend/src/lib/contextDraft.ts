import type { TelegramContextDraft, TelegramContextProfileUpdate } from '@/types'

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
