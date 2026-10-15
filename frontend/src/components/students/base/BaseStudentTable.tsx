import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { activeResponsibles } from '@/lib/studentFilters'
import { ASSIGNABLE_MENTOR_ROLES, DEGREE_LEVEL_LABELS, MENTOR_ROLE_LABELS, SERVICE_TYPE_LABELS, type StudentListItem } from '@/types'
import { StudentWorkStatus } from '@/components/students/StudentWorkStatus'
import { Button } from '@/components/ui/primitives/button'

const ROLE_SHORT: Record<string, string> = { career: 'ПО', ielts: 'IELTS', lead: 'УП', country: 'Страна', portfolio: 'Портфолио', mzk: 'МЗК' }

export function BaseStudentTable({
  groups, selectedIds, onToggle, onSelectAll, onOpen, onRole, onSelf, canAssign, isManager,
  intakeOverview, sortAscending, onSort, showYear = true, isLoading, error, onRetry, selfPending, showCountries, showForms, notionStatuses, notionStatusColors, showSelection,
}: {
  showYear?: boolean
  groups: [string, StudentListItem[]][]
  selectedIds: Set<string>
  onToggle: (studentId: string) => void
  onSelectAll: (ids: string[], selected: boolean) => void
  onOpen: (student: StudentListItem) => void
  onRole: (student: StudentListItem, role: string) => void
  onSelf: (student: StudentListItem) => void
  canAssign: boolean
  isManager: boolean
  intakeOverview: Record<string, { has_package?: boolean; has_cases?: boolean }>
  sortAscending: boolean
  onSort: () => void
  isLoading: boolean
  error?: string
  onRetry: () => void
  selfPending: boolean
  showCountries: boolean
  showForms: boolean
  notionStatuses: Map<string, string>
  notionStatusColors: Map<string, string>
  showSelection: boolean
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const all = groups.flatMap(([, students]) => students)
  const allSelected = all.length > 0 && all.every((s) => selectedIds.has(s.id))
  const columnCount = 5 + Number(showYear) + Number(showSelection) + Number(showCountries) + Number(showForms)
  return <div className="overflow-x-auto rounded-2xl border border-ds-line bg-ds-panel">
    <table className="w-full min-w-[1080px] border-collapse text-left text-sm tabular-nums text-ds-ink">
      <thead>
        <tr className="bg-ds-panel2 text-[10.5px] font-bold uppercase tracking-[.14em] text-ds-muted2">
          <th colSpan={1 + Number(showSelection) + Number(showCountries)} className="border-b border-ds-line px-3 py-2">Студент</th>
          <th colSpan={1 + Number(showYear)} className="border-b border-l border-ds-line px-3 py-2">Процесс</th>
          <th colSpan={2} className="border-b border-l border-ds-line px-3 py-2">Команда</th>
          <th colSpan={1 + Number(showForms)} className="border-b border-l border-ds-line px-3 py-2">Документы</th>
        </tr>
        <tr className="bg-ds-panel2 text-xs font-bold text-ds-muted">
          {showSelection && <th className="w-10 px-3 py-2"><input aria-label="Выбрать всех в текущем виде" type="checkbox" disabled={!canAssign} checked={allSelected} onChange={(event) => onSelectAll(all.map((s) => s.id), event.target.checked)} /></th>}
          <th className="min-w-48 px-3 py-2"><button type="button" onClick={onSort} className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent">Имя {sortAscending ? '↑' : '↓'}</button></th>
          {showCountries && <th className="min-w-36 px-3 py-2">Страны</th>}
          <th className="min-w-44 border-l border-ds-line px-3 py-2">Статус</th>
          {showYear && <th className="px-3 py-2">Набор</th>}
          <th className="min-w-32 border-l border-ds-line px-3 py-2">МЗК</th>
          <th className="min-w-64 px-3 py-2" title="Клик по роли открывает назначение">Команда</th>
          {showForms && <th className="border-l border-ds-line px-3 py-2">Анкеты</th>}
          <th className="px-3 py-2" />
        </tr>
      </thead>
      <tbody>
        {error && <tr><td colSpan={columnCount} className="py-12 text-center" role="alert">Не удалось загрузить список: {error} <Button type="button" variant="outline" size="sm" onClick={onRetry}>Повторить</Button></td></tr>}
        {!error && isLoading && <tr><td colSpan={columnCount} className="py-12 text-center text-ds-muted">Загрузка…</td></tr>}
        {!error && !isLoading && groups.length === 0 && <tr><td colSpan={columnCount} className="py-12 text-center text-ds-muted">В этом виде никого нет. Попробуйте снять фильтры.</td></tr>}
        {!error && !isLoading && groups.map(([label, students]) => <Fragment key={label}><tr className="bg-ds-panel2"><td colSpan={columnCount} className="border-t border-ds-line px-3 py-2.5"><div className="flex items-center gap-3">{showSelection && <input aria-label={`Выбрать группу ${label}`} type="checkbox" disabled={!canAssign} checked={students.length > 0 && students.every((s) => selectedIds.has(s.id))} onChange={(event) => onSelectAll(students.map((s) => s.id), event.target.checked)} />}<button type="button" aria-expanded={!collapsedGroups.has(label)} onClick={() => setCollapsedGroups((previous) => { const next = new Set(previous); if (next.has(label)) next.delete(label); else next.add(label); return next })} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left font-bold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent"><span aria-hidden="true" className="w-4 text-center text-ds-muted">{collapsedGroups.has(label) ? '▸' : '▾'}</span><span>{label}</span><span className="text-xs font-normal text-ds-muted2">· {students.length}</span></button></div></td></tr>{!collapsedGroups.has(label) && <FragmentGroup showYear={showYear} students={students} selectedIds={selectedIds} onToggle={onToggle} onOpen={onOpen} onRole={onRole} onSelf={onSelf} canAssign={canAssign} isManager={isManager} intakeOverview={intakeOverview} selfPending={selfPending} showCountries={showCountries} showForms={showForms} showSelection={showSelection} notionStatuses={notionStatuses} notionStatusColors={notionStatusColors} />}</Fragment>)}
      </tbody>
    </table>
  </div>
}

function FragmentGroup({ showYear, students, selectedIds, onToggle, onOpen, onRole, onSelf, canAssign, isManager, intakeOverview, selfPending, showCountries, showForms, showSelection }: {
  showYear: boolean;
  students: StudentListItem[]; selectedIds: Set<string>;
  onToggle: (studentId: string) => void; onOpen: (student: StudentListItem) => void; onRole: (student: StudentListItem, role: string) => void;
  onSelf: (student: StudentListItem) => void; canAssign: boolean; isManager: boolean;
  intakeOverview: Record<string, { has_package?: boolean; has_cases?: boolean }>;
  selfPending: boolean;
  showCountries: boolean; showForms: boolean;
  showSelection: boolean;
  notionStatuses: Map<string, string>;
  notionStatusColors: Map<string, string>;
}) {
  return <>
    {students.map((student) => {
      const responsibles = activeResponsibles(student)
      const assignedRoles = new Set(responsibles.map((r) => r.role))
      const managers = responsibles.filter(r => r.role === 'mzk')
      const intake = intakeOverview[student.id]
      return <tr key={student.id} className={`border-t border-ds-line transition-colors hover:bg-ds-panel2 ${selectedIds.has(student.id) ? 'bg-ds-accent/15' : ''}`}>
        {showSelection && <td className="px-3 py-2 align-top"><input type="checkbox" disabled={!canAssign} aria-label={`Выбрать ${student.full_name}`} checked={selectedIds.has(student.id)} onChange={() => onToggle(student.id)} /></td>}
        <td className="px-3 py-2 align-top"><button type="button" onClick={() => onOpen(student)} className="text-left font-bold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ds-accent">{student.full_name}</button><div className="mt-1 flex items-center gap-1.5 text-xs text-ds-muted2"><span className="rounded-md bg-ds-panel2 px-1.5 py-0.5 font-bold">{DEGREE_LEVEL_LABELS[student.degree_level]}</span>{student.city}</div>{(student.services_summary?.items.length ?? 0) > 0 && <p className="mt-1 max-w-56 truncate text-xs text-ds-muted" title={student.services_summary?.items.map((item) => `${SERVICE_TYPE_LABELS[item.service_type]} · ${item.status}`).join(', ')}>Услуги: {student.services_summary?.items.map((item) => SERVICE_TYPE_LABELS[item.service_type]).join(', ')}</p>}</td>
        {showCountries && <td className="px-3 py-2 align-top text-ds-muted">{student.countries?.map((c) => c.country).join(', ') || '—'}</td>}
        <td className="border-l border-ds-line px-3 py-2 align-top"><StudentWorkStatus student={student} /></td>
        {showYear && <td className="px-3 py-2 align-top">{student.intake_year || '—'}</td>}
        <td className="border-l border-ds-line px-3 py-2 align-top">{managers.map(person => person.name).join(', ') || student.mzk_manager_name || <span className="text-ds-muted2">Не назначен</span>}</td>
        <td className="px-3 py-2 align-top"><div className="flex max-w-80 flex-wrap gap-1.5">{ASSIGNABLE_MENTOR_ROLES.filter(role => role !== 'mzk' && assignedRoles.has(role)).map(role => <button key={role} type="button" disabled={!canAssign} onClick={() => onRole(student, role)} title={MENTOR_ROLE_LABELS[role]} className="rounded-lg border border-ds-line bg-ds-panel2 px-2 py-1 text-left text-xs"><b>{ROLE_SHORT[role]}: </b>{responsibles.filter(r => r.role === role).map(r => r.name).join(', ')}</button>)}</div>
          {!responsibles.length && <p className="text-xs text-ds-muted">Команда не назначена</p>}
          {(student.mentors?.length ?? 0) > 0 && <details className="mt-1 text-xs text-ds-muted"><summary className="cursor-pointer">Имена из Notion · {student.mentors?.length}</summary>{student.mentors?.join(', ')}<p>Сопоставление аккаунтов — в меню «Данные».</p></details>}
          {canAssign && <button type="button" onClick={() => onRole(student, 'lead')} className="mt-1 min-h-7 text-xs font-semibold underline">{responsibles.length ? 'Изменить команду' : 'Назначить'}</button>}
        </td>
        {showForms && <td className="border-l border-ds-line px-3 py-2 align-top">{isManager ? <div className="flex gap-1">{([{ key: 'has_package', label: 'П', title: 'Пакет сопровождения' }, { key: 'has_cases', label: 'К', title: 'Кейсы студентов' }] as const).map((item) => <span key={item.key} title={`${item.title}: ${intake?.[item.key] ? 'заполнена' : 'нет'}`} className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${intake?.[item.key] ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-ds-line text-ds-muted2'}`}>{item.label}</span>)}</div> : '—'}</td>}
        <td className="px-3 py-2 align-top"><div className="flex items-center justify-end gap-2"><button type="button" disabled={selfPending} onClick={() => onSelf(student)} className="whitespace-nowrap text-xs font-semibold text-ds-muted hover:text-ds-ink disabled:opacity-50">{student.is_mine ? '★ Мой' : '☆ Взять'}</button><Button type="button" variant="outline" size="sm" onClick={() => onOpen(student)}>Открыть</Button><Link className="sr-only focus:not-sr-only" to={`/students/${student.id}`}>Полный профиль</Link></div></td>
      </tr>
    })}
  </>
}
