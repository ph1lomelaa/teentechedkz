import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { notionApi } from '@/api/notion'
import { activeResponsibles } from '@/lib/studentFilters'
import { ASSIGNABLE_MENTOR_ROLES, DEGREE_LEVEL_LABELS, MENTOR_ROLE_LABELS, type StudentListItem } from '@/types'
import { StudentWorkStatus } from '@/components/students/StudentWorkStatus'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/primitives/sheet'

export function BaseStudentDrawer({ student, intake, canSeeNotion, canAssign, onClose, onRole }: {
  student: StudentListItem
  intake?: { has_package?: boolean; has_cases?: boolean }
  canSeeNotion: boolean
  canAssign: boolean
  onClose: () => void
  onRole: (role: string) => void
}) {
  const { data: notion } = useQuery({
    queryKey: ['notion', 'student', student.id], queryFn: () => notionApi.studentNotion(student.id), enabled: canSeeNotion,
  })
  const responsibles = activeResponsibles(student)
  const profilePath = `/students/${student.id}`
  const attention = [
    student.has_overdue_tasks && { label: 'Просрочены задачи', section: 'tasks' },
    student.has_open_complaints && { label: 'Есть открытое обращение', section: 'timeline' },
    (student.documents_unverified ?? 0) > 0 && { label: 'Документы ожидают проверки', section: 'documents' },
    intake?.has_package === false && { label: 'Не заполнена анкета пакета сопровождения', section: 'intake' },
    intake?.has_cases === false && { label: 'Не заполнена анкета кейса', section: 'intake' },
  ].filter((item): item is { label: string; section: string } => Boolean(item))
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
    <SheetContent className="max-w-[620px] overflow-y-auto p-4 sm:p-6">
      <div className="student-detail-card space-y-6 rounded-[18px] border border-ds-line bg-ds-panel p-5 sm:p-6">
        <header className="pr-9">
          <SheetTitle className="text-2xl font-extrabold text-ds-ink">{student.full_name}</SheetTitle>
          <p className="mt-1 text-sm text-ds-muted">{DEGREE_LEVEL_LABELS[student.degree_level]} · Набор {student.intake_year} · {student.countries?.map((c) => c.country).join(', ') || 'Страна не указана'}{student.city ? ` · ${student.city}` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {notion?.snapshot?.notion_url && <a href={notion.snapshot.notion_url} target="_blank" rel="noreferrer" className="rounded-lg border border-ds-line px-3 py-1.5 text-xs font-semibold text-ds-ink hover:bg-ds-panel2">Открыть в Notion ↗</a>}
            <Link to={`/students/${student.id}`} className="rounded-lg border border-ds-line px-3 py-1.5 text-xs font-semibold text-ds-ink hover:bg-ds-panel2">Профиль</Link>
          </div>
        </header>
        <section className="space-y-3" aria-label="Важная информация о студенте">
          <StudentWorkStatus student={student} />
          {student.phone && <a href={`tel:${student.phone}`} className="inline-flex text-sm font-medium text-ds-ink underline underline-offset-4">{student.phone}</a>}
        </section>
        {attention.length > 0 && <section>
          <h3 className="font-semibold text-ds-ink">Требует внимания</h3>
          <ul className="mt-3 space-y-2">
            {attention.map((item) => <li key={item.label}><Link to={`${profilePath}#${item.section}`} className="block rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{item.label} ↗</Link></li>)}
          </ul>
        </section>}
        <section><h3 className="font-bold text-ds-ink">Команда</h3>{canAssign && <p className="mt-1 text-xs text-ds-muted">Нажмите на роль, чтобы назначить ответственного</p>}<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{ASSIGNABLE_MENTOR_ROLES.map((role) => { const matches = responsibles.filter((r) => r.role === role); return <button key={role} type="button" disabled={!canAssign} onClick={() => onRole(role)} className={`min-h-20 rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent ${matches.length ? 'border-ds-line bg-ds-panel2' : 'border-dashed border-ds-line'}`}><span className="block text-xs text-ds-muted2">{MENTOR_ROLE_LABELS[role]}</span><span className={`mt-1 block text-sm font-bold ${matches.length ? 'text-ds-ink' : 'text-ds-muted2'}`}>{matches.length ? matches.map((r) => `${r.name ?? 'Без имени'}${r.country_scope ? ` (${r.country_scope})` : ''}`).join(', ') : '+ Назначить'}</span>{matches.some((r) => r.assignment_status === 'awaiting_signature') && <span className="block text-xs text-amber-700">Ждёт подписи регламента</span>}</button> })}</div></section>
      </div>
    </SheetContent>
  </Sheet>
}
