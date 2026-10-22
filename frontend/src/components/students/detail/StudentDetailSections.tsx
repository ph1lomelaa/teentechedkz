import React, { createContext, useContext, useEffect, useId, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Route, CalendarDays, GraduationCap, Star, ClipboardList, MessageCircle, UserRound, FileText, BookText } from 'lucide-react'
import {
  AccordionItem as OriginalItem,
  AccordionTrigger as OriginalTrigger,
  AccordionContent as OriginalContent,
} from '@/components/ui/primitives/accordion'
import { cn } from '@/lib/utils'

export const DETAIL_GROUPS = [
  { id: 'roadmap', label: 'Roadmap', icon: Route, sections: [{ id: 'roadmap', label: 'Дорожная карта' }] },
  { id: 'meetings', label: 'Встречи', icon: CalendarDays, sections: [{ id: 'meetings', label: 'Встречи' }] },
  { id: 'universities', label: 'Вузы и заявки', icon: GraduationCap, sections: [{ id: 'applications', label: 'Заявки' }, { id: 'shortlist', label: 'Рассматриваем' }, { id: 'credentials', label: 'Admission-доступы' }] },
  { id: 'portfolio', label: 'Portfolio UP', icon: Star, sections: [{ id: 'portfolio', label: 'Личный план' }] },
  { id: 'work', label: 'Задачи и записи', icon: ClipboardList, sections: [{ id: 'tasks', label: 'Задачи' }, { id: 'confidential', label: 'Заметки' }] },
  { id: 'documents', label: 'Документы', icon: FileText, sections: [{ id: 'documents', label: 'Документы' }] },
  { id: 'notes', label: 'Конспекты', icon: BookText, sections: [{ id: 'notes', label: 'Конспекты' }] },
  { id: 'communication', label: 'Общение', icon: MessageCircle, sections: [{ id: 'chat', label: 'Чат' }, { id: 'telegram', label: 'Telegram' }] },
  { id: 'about', label: 'О студенте', icon: UserRound, sections: [{ id: 'profile', label: 'Профиль' }, { id: 'team', label: 'Команда и услуги' }, { id: 'payments', label: 'Договор и оплаты' }, { id: 'checks', label: 'Сверки' }, { id: 'portal-access', label: 'Доступ' }, { id: 'timeline', label: 'История' }] },
] as const

const SECTION_GROUP: Record<string, string> = {
  responsibles: 'team', responsibilities: 'team', services: 'team',
  contract: 'payments', finances: 'payments', intake: 'checks', notion: 'checks',
  'notion-sync': 'checks', 'student-notes': 'confidential',
  card: 'profile', overview: 'profile', crm: 'profile', programs: 'team', guardians: 'profile',
  activities: 'portfolio', access: 'portal-access',
}
export function resolveDetailSection(hash: string, aliases: Record<string, string> = {}): string {
  let raw = hash.replace(/^#/, '')
  try { raw = decodeURIComponent(raw) } catch { return 'roadmap' }
  const id = aliases[raw] || SECTION_GROUP[raw] || raw
  const group = DETAIL_GROUPS.find((g) => g.id === id)
  if (group) return group.sections[0].id
  return DETAIL_GROUPS.some((g) => g.sections.some((s) => s.id === id)) ? id : 'roadmap'
}

const DetailContext = createContext<{ active: string; visited: Set<string> } | null>(null)
const ItemContext = createContext(false)
export function useStudentDetailMode() { return useContext(DetailContext) !== null }

/** Shared navigation for CRM and workspace; visited panels stay mounted to preserve drafts. */
export function StudentDetailSections({ children, available, hashAliases = {} }: { children: React.ReactNode; available: string[]; hashAliases?: Record<string, string> }) {
  const location = useLocation()
  const navigate = useNavigate()
  const uid = useId()
  const allowedGroups = DETAIL_GROUPS.map((g) => ({ ...g, sections: g.sections.filter((s) => available.includes(s.id)) })).filter((g) => g.sections.length)
  const requested = resolveDetailSection(location.hash, hashAliases)
  const active = available.includes(requested) ? requested : allowedGroups[0]?.sections[0]?.id || 'profile'
  const group = allowedGroups.find((g) => g.sections.some((s) => s.id === active))
  const [visited, setVisited] = useState(() => new Set([active]))
  useEffect(() => { setVisited((old) => old.has(active) ? old : new Set([...old, active])) }, [active])
  const go = (section: string) => navigate({ pathname: location.pathname, search: location.search, hash: Object.entries(hashAliases).find(([, target]) => target === section)?.[0] || section }, { replace: true, preventScrollReset: true })
  return (
    <DetailContext.Provider value={{ active, visited: new Set([...visited, active]) }}>
      <div className="student-detail-navigation">
        <div role="tablist" aria-label="Разделы карточки студента" className="student-detail-tabs">
          {allowedGroups.map((g, index) => {
            const selected = g.id === group?.id
            const Icon = g.icon
            return <button key={g.id} id={`${uid}-${g.id}`} type="button" role="tab" aria-selected={selected} aria-controls={`${uid}-panel`} tabIndex={selected ? 0 : -1}
              className={cn('student-detail-tab', selected && 'is-active')}
              onClick={() => go(g.sections[0].id)}
              onKeyDown={(event) => {
                let next: number | undefined
                if (event.key === 'ArrowRight') next = (index + 1) % allowedGroups.length
                if (event.key === 'ArrowLeft') next = (index - 1 + allowedGroups.length) % allowedGroups.length
                if (event.key === 'Home') next = 0
                if (event.key === 'End') next = allowedGroups.length - 1
                if (next !== undefined) { event.preventDefault(); go(allowedGroups[next].sections[0].id); document.getElementById(`${uid}-${allowedGroups[next].id}`)?.focus() }
              }}><Icon className="h-4 w-4" aria-hidden="true" />{g.label}</button>
          })}
        </div>
        {group && group.sections.length > 1 && <nav className="student-detail-subnav" aria-label={`Подразделы: ${group.label}`}>
          {group.sections.map((s) => <button key={s.id} type="button" aria-current={active === s.id ? 'page' : undefined} onClick={() => go(s.id)} className={cn('student-detail-subtab', active === s.id && 'is-active')}>{s.label}</button>)}
        </nav>}
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-${group?.id}`} className="student-detail-panels">{children}</div>
    </DetailContext.Provider>
  )
}

export function AccordionItem({ value, className, children, unframed, ...props }: React.ComponentPropsWithoutRef<typeof OriginalItem> & { unframed?: boolean }) {
  const detail = useContext(DetailContext)
  if (!detail) return <OriginalItem value={value} className={className} {...props}>{children}</OriginalItem>
  const section = SECTION_GROUP[value] || value
  if (!detail.visited.has(section)) return null
  return <ItemContext.Provider value={true}><section {...props} hidden={detail.active !== section} data-student-section={value} className={cn('student-detail-section', unframed && 'student-detail-section--unframed')}>{children}</section></ItemContext.Provider>
}
export function AccordionTrigger({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof OriginalTrigger>) {
  const inside = useContext(ItemContext)
  return inside ? <div role="heading" aria-level={2} className={cn('student-detail-section-heading', className)}>{children}</div> : <OriginalTrigger className={className} {...props}>{children}</OriginalTrigger>
}
export function AccordionContent({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof OriginalContent>) {
  const inside = useContext(ItemContext)
  return inside ? <div className={cn('student-detail-section-body', className)}>{children}</div> : <OriginalContent className={className} {...props}>{children}</OriginalContent>
}
