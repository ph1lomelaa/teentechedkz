import type { ActivityBoardData, BoardDeclined, BoardStage, BoardStudent, ExperienceKey } from '@/api/activities'

/** Участие ученика на доске: стадия берётся из колонки, в которой оно пришло. */
export interface BoardEntry extends BoardStudent {
  stage: BoardStage
  activity_id: string
  title: string
  experience_type: ExperienceKey
  submit_deadline: string | null
}

export interface ActivityGroup {
  activity_id: string
  title: string
  experience_type: ExperienceKey
  submit_deadline: string | null
  entries: BoardEntry[]
  declined: BoardDeclined[]
}

const STAGE_ORDER: BoardStage[] = ['result_review', 'in_work', 'recommendation', 'achievement']

/** Сначала то, что ждёт ментора, потом просроченное, дальше по стадии и сроку. */
export function entryRank(a: BoardEntry, b: BoardEntry): number {
  return Number(b.needs_me) - Number(a.needs_me)
    || Number(b.overdue_days > 0) - Number(a.overdue_days > 0)
    || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
    || (a.due ?? '9999').localeCompare(b.due ?? '9999')
}

export function boardEntries(data: ActivityBoardData | undefined): BoardEntry[] {
  return (data?.columns ?? []).flatMap((column) => column.items.flatMap((card) => card.students.map((s) => ({
    ...s, stage: column.key, activity_id: card.activity_id, title: card.title, experience_type: card.experience_type, submit_deadline: card.submit_deadline,
  }))))
}

/** Колонки канбана: одна активность — одна колонка, по ближайшему сроку подачи. */
export function byActivity(data: ActivityBoardData | undefined): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>()
  for (const entry of boardEntries(data)) {
    const group = groups.get(entry.activity_id) ?? { activity_id: entry.activity_id, title: entry.title, experience_type: entry.experience_type, submit_deadline: entry.submit_deadline, entries: [], declined: [] }
    group.entries.push(entry)
    groups.set(entry.activity_id, group)
  }
  for (const d of data?.declined_students ?? []) groups.get(d.activity_id)?.declined.push(d)
  return [...groups.values()]
    .map((g) => ({ ...g, entries: g.entries.sort(entryRank) }))
    .sort((a, b) => (a.submit_deadline ?? '9999').localeCompare(b.submit_deadline ?? '9999') || a.title.localeCompare(b.title, 'ru'))
}
