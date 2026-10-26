import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { activitiesApi, type ExperienceKey } from '@/api/activities'
import { Input } from '@/components/ui/primitives/input'
import { QueryState } from '@/components/shared/QueryState'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { EXPERIENCE_TYPES } from '@/lib/portfolio/dictionary'
import { boardEntries, byActivity, type BoardEntry } from '@/lib/portfolio/boardGroups'
import { FilterSelect } from './ActivityParts'
import { ActivityBoard } from './ActivityBoard'
import { StudentsOverview } from './StudentsOverview'

const ALL = 'all'

/** Работа ментора с учениками: канбан по активностям или список учеников с общими фильтрами. Клик ведёт в карточку ученика. */
export function MentorPortfolio({ view, onAddStudent }: { view: 'activities' | 'students'; onAddStudent?: (activityId: string) => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ExperienceKey | ''>('')
  const [needMe, setNeedMe] = useState(false)
  const mentors = useQuery({ queryKey: ['activities', 'staff-mentors'], queryFn: activitiesApi.staffMentors })
  const isMentor = !!user && !!mentors.data?.some((m) => m.id === user.id)
  // Ментору по умолчанию — свои ученики, остальным — все.
  const [mentorChoice, setMentorChoice] = useState<string | null>(null)
  const mentor = mentorChoice ?? (isMentor ? user!.id : ALL)
  const mentorId = mentor === ALL ? undefined : mentor
  const board = useQuery({ queryKey: ['activities', 'board', search, type, mentorId ?? ''], queryFn: () => activitiesApi.board({ q: search, experience_type: type, mentor_id: mentorId }), enabled: view === 'activities' && !mentors.isLoading })
  const overview = useQuery({ queryKey: ['activities', 'students-overview', mentorId ?? ''], queryFn: () => activitiesApi.studentsOverview(mentorId ? { mentor_id: mentorId } : {}), enabled: view === 'students' && !mentors.isLoading })

  const entries = useMemo(() => boardEntries(board.data), [board.data])
  const needCount = entries.filter((e) => e.needs_me).length
  const filtered = useMemo(() => {
    if (!board.data || !needMe) return board.data
    return { ...board.data, columns: board.data.columns.map((c) => ({ ...c, items: c.items.map((card) => ({ ...card, students: card.students.filter((s) => s.needs_me) })).filter((card) => card.students.length) })) }
  }, [board.data, needMe])
  const groups = useMemo(() => byActivity(filtered), [filtered])
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ru')
    return (overview.data ?? []).filter((r) => !q || r.name.toLocaleLowerCase('ru').includes(q))
  }, [overview.data, search])

  // Работа с учеником — в его карточке: раздел Portfolio UP, раскрытая активность.
  const open = (entry: BoardEntry) => navigate(`/workspace/students/${entry.student_id}?p=${entry.participation_id}#portfolio`)
  const query = view === 'students' ? overview : board

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-full sm:basis-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-muted" aria-hidden /><Input aria-label="Поиск" className="pl-10" placeholder={view === 'students' ? 'Имя ученика' : 'Ученик или активность'} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {(mentors.data?.length ?? 0) > 0 && <FilterSelect label="Ученики" value={mentor === ALL ? '' : mentor} lowercase={false} onChange={(v) => setMentorChoice(v || ALL)}
        options={[...(isMentor ? [{ value: user!.id, label: 'мои' }] : []), ...(mentors.data ?? []).filter((m) => m.id !== user?.id).map((m) => ({ value: m.id, label: m.name }))]} />}
      {view === 'activities' && <FilterSelect label="Тип опыта" value={type} onChange={setType} options={EXPERIENCE_TYPES.filter((t) => t.key !== 'other').map((t) => ({ value: t.key, label: t.short }))} />}
      {view === 'activities' && <button type="button" aria-pressed={needMe} onClick={() => setNeedMe(!needMe)} disabled={!needCount && !needMe}
        className={cn('shrink-0 rounded-ctl border px-3 py-2 text-sm transition disabled:opacity-50', needMe ? 'border-ds-accent bg-ds-accent font-bold text-black' : 'border-ds-line text-ds-muted hover:border-ds-muted2 hover:text-ds-ink')}>
        Нужно от меня{needCount ? ` · ${needCount}` : ''}
      </button>}
    </div>
    <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
      {view === 'activities' ? <ActivityBoard groups={groups} onOpen={open} onAddStudent={onAddStudent} /> : <StudentsOverview rows={rows} />}
    </QueryState>
  </div>
}
