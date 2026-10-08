import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { notionApi } from '@/api/notion'
import { mentorAssignmentsApi } from '@/api/index'
import { activeResponsibles } from '@/lib/studentFilters'
import { ASSIGNABLE_MENTOR_ROLES, DEGREE_LEVEL_LABELS, MENTOR_ROLE_LABELS, type StudentListItem } from '@/types'
import { StudentPipelineStatusBadge } from '@/components/students/StudentPipelineStatusBadge'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/primitives/sheet'

export function BaseStudentDrawer({ student, intake, canSeeNotion, canAssign, onClose, onRole }: {
  student: StudentListItem
  intake?: { has_package?: boolean; has_cases?: boolean }
  canSeeNotion: boolean
  canAssign: boolean
  onClose: () => void
  onRole: (role: string) => void
}) {
  const { data: notion, isLoading: notionLoading, isError: notionError, refetch: refetchNotion } = useQuery({
    queryKey: ['notion', 'student', student.id], queryFn: () => notionApi.studentNotion(student.id), enabled: canSeeNotion,
  })
  const { data: history = [] } = useQuery({
    queryKey: ['mentor-assignments', 'history', student.id], queryFn: () => mentorAssignmentsApi.history(student.id), enabled: canAssign,
  })
  const responsibles = activeResponsibles(student)
  const filledRoles = ASSIGNABLE_MENTOR_ROLES.filter((role) => responsibles.some((r) => r.role === role)).length
  const mismatches = notion?.comparison.filter((row) => row.matches === false).length ?? 0
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
    <SheetContent className="max-w-[620px] overflow-y-auto p-4 sm:p-6">
      <div className="space-y-6 rounded-[18px] border border-ds-line bg-ds-panel p-5 sm:p-6">
        <header className="pr-9">
          <SheetTitle className="text-2xl font-extrabold text-ds-ink">{student.full_name}</SheetTitle>
          <p className="mt-1 text-sm text-ds-muted">{DEGREE_LEVEL_LABELS[student.degree_level]} · Набор {student.intake_year} · {student.countries?.map((c) => c.country).join(', ') || 'Страна не указана'}{student.city ? ` · ${student.city}` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {notion?.snapshot?.notion_url && <a href={notion.snapshot.notion_url} target="_blank" rel="noreferrer" className="rounded-lg border border-ds-line px-3 py-1.5 text-xs font-semibold text-ds-ink hover:bg-ds-panel2">Открыть в Notion ↗</a>}
            <Link to={`/students/${student.id}`} className="rounded-lg border border-ds-line px-3 py-1.5 text-xs font-semibold text-ds-ink hover:bg-ds-panel2">Профиль</Link>
          </div>
        </header>
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-ds-ink">Платформа и Notion</h3>{canSeeNotion && notion?.snapshot && <span className={`text-xs font-semibold ${mismatches ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{mismatches ? `Расходится полей: ${mismatches}` : 'Всё совпадает'}</span>}</div>
          {!canSeeNotion ? <p className="mt-2 text-sm text-ds-muted">Данные Notion доступны сотрудникам с правом просмотра.</p>
            : notionLoading ? <p className="mt-2 text-sm text-ds-muted">Загружаем сравнение…</p>
            : notionError ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">Не удалось загрузить сравнение с Notion. <button type="button" className="font-semibold underline" onClick={() => refetchNotion()}>Повторить</button></p>
            : !notion?.snapshot ? <p className="mt-2 text-sm text-ds-muted">Нет связанной записи Notion.</p>
            : <div className="mt-3 overflow-x-auto rounded-xl border border-ds-line"><table className="w-full min-w-[420px] text-left text-xs"><thead className="bg-ds-panel2 text-ds-muted"><tr><th className="p-2">Поле</th><th className="p-2">Платформа</th><th className="p-2">Notion</th><th className="p-2">Сверка</th></tr></thead><tbody>{notion.comparison.map((row) => <tr key={row.field} className={`border-t border-ds-line ${row.matches === false ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}><th className="p-2 font-semibold">{row.label}</th><td className="p-2">{row.crm ?? '—'}</td><td className="p-2">{row.notion ?? '—'}</td><td className="p-2 whitespace-nowrap text-ds-muted">{row.matches === null ? 'Не сверено' : row.matches ? '✓ совпадает' : '≠ отличается'}</td></tr>)}</tbody></table></div>}
          <div className="mt-3 flex items-center gap-2"><span className="text-xs text-ds-muted">Статус:</span><StudentPipelineStatusBadge status={notion?.snapshot?.status === 'linked' ? (notion.snapshot.payment_status || 'no_status') : (student.pipeline_status ?? 'no_status')} /></div>
        </section>
        <section><h3 className="font-bold text-ds-ink">Команда · {filledRoles} из 6 ролей</h3><p className="mt-1 text-xs text-ds-muted">Нажмите на роль, чтобы назначить ответственного</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{ASSIGNABLE_MENTOR_ROLES.map((role) => { const matches = responsibles.filter((r) => r.role === role); return <button key={role} type="button" disabled={!canAssign} onClick={() => onRole(role)} className={`min-h-20 rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent ${matches.length ? 'border-ds-line bg-ds-panel2' : 'border-dashed border-ds-line'}`}><span className="block text-xs text-ds-muted2">{MENTOR_ROLE_LABELS[role]}</span><span className={`mt-1 block text-sm font-bold ${matches.length ? 'text-ds-ink' : 'text-ds-muted2'}`}>{matches.length ? matches.map((r) => `${r.name ?? 'Без имени'}${r.country_scope ? ` (${r.country_scope})` : ''}`).join(', ') : '+ Назначить'}</span>{matches.some((r) => r.assignment_status === 'awaiting_signature') && <span className="block text-xs text-amber-700">Ждёт подписи регламента</span>}</button> })}</div></section>
        {history.length > 0 && <section><h3 className="font-bold text-ds-ink">История назначений</h3><div className="mt-2 space-y-2">{history.slice(0, 8).map((item) => <p key={item.id} className="border-b border-ds-line pb-2 text-xs text-ds-muted"><strong className="text-ds-ink">{MENTOR_ROLE_LABELS[item.role] ?? item.role}:</strong> {item.replacement_mentor_name ?? 'назначение снято'}{item.previous_mentor_name && ` (было: ${item.previous_mentor_name})`} · {new Date(item.created_at).toLocaleString('ru-RU')}{item.changed_by_name && ` · ${item.changed_by_name}`}</p>)}</div></section>}
        {intake && <section><h3 className="font-bold text-ds-ink">Анкеты Google Sheets</h3><div className="mt-2 space-y-2 text-sm">{[['Пакет сопровождения', intake.has_package], ['Кейсы студентов', intake.has_cases]].map(([label, done]) => <p key={String(label)} className={`rounded-lg border border-ds-line px-3 py-2 ${done ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'text-ds-muted'}`}>{label}: {done ? 'заполнена' : 'нет'}</p>)}</div></section>}
      </div>
    </SheetContent>
  </Sheet>
}
