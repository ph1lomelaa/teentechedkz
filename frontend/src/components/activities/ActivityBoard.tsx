import { Plus } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { cn } from '@/lib/utils'
import { EXPERIENCE_LABEL, PARTICIPATION_STAGE, formatDay, formatDue } from '@/lib/portfolio/dictionary'
import type { ActivityGroup, BoardEntry } from '@/lib/portfolio/boardGroups'
import { ProgressSegments } from './ActivityParts'

/** Что ждёт ментора по участию — коротко, для метки. */
function mentorNeed(entry: BoardEntry): string | null {
  if (!entry.needs_me) return null
  if (entry.stage === 'result_review') return 'Проверить итог'
  if (entry.step_pending) return 'Проверить шаг'
  if (!entry.step_total) return 'Составить план'
  return 'Нужно от меня'
}

/** Где ученик сейчас одной строкой: следующий шаг и срок. */
function whereNow(entry: BoardEntry): { text: string; late: boolean } {
  const late = entry.overdue_days > 0
  if (entry.stage === 'recommendation') return { text: entry.due ? `Ученик решает · ${formatDue(entry.due)}` : 'Ученик решает', late: false }
  if (entry.stage === 'achievement') return { text: 'Итог подтверждён', late: false }
  if (entry.stage === 'result_review') return { text: 'Итог прислан', late: false }
  if (!entry.step_total) return { text: 'Шагов пока нет', late: false }
  if (!entry.next_title) return { text: 'Шаги готовы, ждём итог', late: false }
  const due = entry.due ? (late ? ` · просрочено ${entry.overdue_days} дн.` : ` · ${formatDue(entry.due)}`) : ''
  return { text: `Шаг ${entry.step_index} из ${entry.step_total}: ${entry.next_title}${due}`, late }
}

/** Участие одной карточкой. В колонке активности заголовок — ученик, в списке ученика — активность. */
export function EntryCard({ entry, heading, onOpen }: { entry: BoardEntry; heading: 'student' | 'activity'; onOpen: (entry: BoardEntry) => void }) {
  const need = mentorNeed(entry)
  const now = whereNow(entry)
  const title = heading === 'student' ? entry.name || 'Ученик' : entry.title
  return <button type="button" onClick={() => onOpen(entry)} aria-label={`Путь: ${entry.name || 'ученик'} · ${entry.title}`}
    className={cn('flex h-full w-full flex-col items-stretch justify-start gap-2 rounded-card border bg-ds-panel p-3 text-left transition hover:border-ds-muted2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-dim',
      need ? 'border-ds-accent-dim' : 'border-ds-line')}>
    <span className="flex items-start gap-2">
      {heading === 'student' && <Avatar name={entry.name || 'Ученик'} size={24} className="shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-bold leading-snug">{title}</span>
        {heading === 'activity' && <span className="block text-2xs text-ds-muted">{[EXPERIENCE_LABEL[entry.experience_type], entry.submit_deadline ? `подача до ${formatDay(entry.submit_deadline)}` : null].filter(Boolean).join(' · ')}</span>}
      </span>
      <span className="shrink-0 text-2xs font-semibold text-ds-muted">{PARTICIPATION_STAGE[entry.stage].label}</span>
    </span>
    {entry.step_total > 0 && <ProgressSegments steps={{ total: entry.step_total, done: entry.step_done, pending: entry.step_pending, returned: 0, overdue: 0, next: null }} />}
    <span className={cn('block text-xs leading-snug', now.late ? 'font-semibold text-ds-danger' : 'text-ds-muted')}>{now.text}</span>
    {need && <span className="inline-flex self-start rounded-pill bg-ds-accent px-2 py-0.5 text-2xs font-bold text-black">{need}</span>}
  </button>
}

/** Канбан: одна активность — одна колонка, внутри её ученики. */
export function ActivityBoard({ groups, onOpen, onAddStudent }: { groups: ActivityGroup[]; onOpen: (entry: BoardEntry) => void; onAddStudent?: (activityId: string) => void }) {
  if (!groups.length) return <p className="rounded-card border border-dashed border-ds-line px-5 py-6 text-sm text-ds-muted">Пока никто не участвует. Подберите активность ученику во вкладке «Ученики» или в каталоге.</p>
  return <div className="flex flex-col gap-3 md:-mx-1 md:flex-row md:items-start md:overflow-x-auto md:px-1 md:pb-3">
    {groups.map((group) => <section key={group.activity_id} aria-label={group.title} className="min-w-0 space-y-2 rounded-card bg-ds-panel2 p-2.5 md:w-[300px] md:shrink-0">
      <header className="flex items-start gap-2 px-1 pt-0.5">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-sm font-bold leading-snug">{group.title} <span className="font-normal text-ds-muted">{group.entries.length}</span></h2>
          <p className="mt-0.5 text-2xs text-ds-muted">{[EXPERIENCE_LABEL[group.experience_type], group.submit_deadline ? `подача до ${formatDay(group.submit_deadline)}` : null].filter(Boolean).join(' · ')}</p>
        </div>
        {onAddStudent && <button type="button" onClick={() => onAddStudent(group.activity_id)} aria-label={`Рекомендовать «${group.title}» ещё ученикам`} title="Рекомендовать ещё ученикам"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-ctl text-ds-muted hover:bg-ds-panel hover:text-ds-ink"><Plus className="h-4 w-4" /></button>}
      </header>
      <div className="space-y-2">{group.entries.map((entry) => <EntryCard key={entry.participation_id} entry={entry} heading="student" onOpen={onOpen} />)}</div>
      {!!group.declined.length && <p className="px-1 text-2xs text-ds-muted" title={group.declined.map((d) => d.name).join(', ')}>Отказались · {group.declined.length}</p>}
    </section>)}
  </div>
}
