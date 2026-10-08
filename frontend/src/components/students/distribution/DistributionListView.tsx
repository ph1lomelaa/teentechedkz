import React from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AssignmentBoard } from '@/types'
import { Button } from '@/components/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { StudentPipelineStatusBadge } from '@/components/students/StudentPipelineStatusBadge'
import { DistributionGroup, DistributionRow, MAX_BULK_ASSIGN, selectableGroupIds } from './listModel'

interface Props {
  board: AssignmentBoard
  roleLabel: string
  canAssign: boolean
  selectionMode: boolean
  rows: DistributionRow[]
  groups: DistributionGroup[]
  openGroups: ReadonlySet<string>
  groupLimits: Record<string, number>
  selected: ReadonlySet<string>
  selectedVisible: string[]
  bulkTarget: string
  bulkPending: boolean
  staffFilter: string | null
  listScope: 'unassigned' | 'all'
  staffCounts: ReadonlyMap<string, number>
  unassignedCount: number
  searchActive: boolean
  onToggleGroup: (key: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onShowMore: (key: string, next: number) => void
  onToggleSelection: (ids: string[], checked: boolean) => void
  onClearSelection: () => void
  onTargetChange: (id: string) => void
  onBulkAssign: () => void
  onChooseScope: (scope: 'unassigned' | 'all', staff?: string | null) => void
  onSingleAssign: (studentId: string, studentName: string, from: string) => void
  onUnassign: (assignmentId: string, staffName: string) => void
}

export const DistributionListView: React.FC<Props> = ({
  board, roleLabel, canAssign, selectionMode, rows, groups, openGroups, groupLimits, selected, selectedVisible,
  bulkTarget, bulkPending, staffFilter, listScope, staffCounts, unassignedCount, searchActive,
  onToggleGroup, onExpandAll, onCollapseAll, onShowMore, onToggleSelection,
  onClearSelection, onTargetChange, onBulkAssign, onChooseScope, onSingleAssign, onUnassign,
}) => (
  <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
    <div className="min-w-0">
      {staffFilter && <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-p-line bg-p-panel px-4 py-3">
        <div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-p-accent-text">{roleLabel}</p><p className="text-xl font-extrabold text-p-text">{board.columns.find((column) => column.staff_id === staffFilter)?.name}</p><p className="text-sm text-p-muted">Ведёт студентов: {staffCounts.get(staffFilter) ?? 0}</p></div>
        <Button size="sm" variant="outline" onClick={() => onChooseScope('unassigned')}>Показать всех без «{roleLabel}»</Button>
      </div>}

      {canAssign && selectionMode && selectedVisible.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-p-line bg-p-panel px-4 py-3 text-sm text-p-text">
        <strong>Выбрано {selectedVisible.length}</strong><span className="mx-1 opacity-60">·</span><span>Роль: {roleLabel}</span>
        <Select value={bulkTarget} onValueChange={onTargetChange}>
          <SelectTrigger className="h-9 w-[220px] border-p-line bg-p-panel2 text-p-text"><SelectValue placeholder="Сотрудник…" /></SelectTrigger>
          <SelectContent>{board.columns.map((column) => <SelectItem key={column.staff_id} value={column.staff_id}>{column.name} · ведёт {staffCounts.get(column.staff_id) ?? 0}</SelectItem>)}</SelectContent>
        </Select>
        <Button className="bg-p-accent text-black" disabled={!bulkTarget || selectedVisible.length > MAX_BULK_ASSIGN || bulkPending} onClick={onBulkAssign}>{bulkPending ? 'Назначаем…' : 'Назначить'}</Button>
        <Button variant="ghost" className="text-p-muted hover:bg-p-panel2 hover:text-p-text" onClick={onClearSelection}>Снять выбор</Button>
        {selectedVisible.length > MAX_BULK_ASSIGN && <span>Максимум {MAX_BULK_ASSIGN} студентов за раз</span>}
      </div>}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-p-muted">
        <span>{rows.length} студентов · {groups.length} групп · развёрнуто {openGroups.size}{searchActive ? ' · поиск раскрыл группы' : ''}</span>
        <span className="flex gap-3"><button className="min-h-8 underline" type="button" onClick={onExpandAll}>Развернуть все</button><button className="min-h-8 underline" type="button" onClick={onCollapseAll}>Свернуть все</button></span>
      </div>

      <div className="min-w-0 overflow-x-auto rounded-panel border border-p-line bg-p-panel">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm tabular-nums">
          <thead className="bg-p-panel2 text-xs font-bold text-p-muted"><tr>
            {selectionMode && <th className="w-12 px-3 py-3" aria-label="Выбор студентов" />}
            <th className="min-w-[240px] px-3 py-3">Студент</th>
            <th className="min-w-[170px] px-3 py-3">Статус</th>
            <th className="min-w-[120px] px-3 py-3">Страна CRM</th>
            <th className="min-w-[200px] bg-p-chip px-3 py-3 text-p-chip-text">{roleLabel}</th>
            <th className="w-28 px-3 py-3" />
          </tr></thead>
          {groups.map((group) => {
            const isOpen = openGroups.has(group.key)
            const eligible = group.rows.filter((row) => row.assignments.length === 0)
            const selectableIds = selectableGroupIds(group)
            const limit = groupLimits[group.key] ?? 15
            return <tbody key={group.key}>
              <tr className="border-t border-p-line bg-p-panel2">
                {selectionMode && <td className="px-3 py-2">{canAssign && eligible.length > 0 && <input type="checkbox" aria-label={`Выбрать ${Math.min(eligible.length, MAX_BULK_ASSIGN)} студентов группы ${group.label}`} checked={selectableIds.every((id) => selected.has(id))} onChange={(event) => onToggleSelection(selectableIds, event.target.checked)} />}</td>}
                <td colSpan={5} className="px-3 py-2"><button type="button" aria-expanded={isOpen} onClick={() => onToggleGroup(group.key)} className="inline-flex min-h-8 items-center gap-2 font-bold text-p-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-p-accent">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{group.label}<span className="rounded-full bg-p-panel px-2 py-0.5 text-xs text-p-muted">{group.rows.length}</span><span className="text-xs font-semibold text-p-accent-text">{group.unassigned ? `${group.unassigned} без «${roleLabel}»` : 'все распределены'}</span>{selectionMode && eligible.length > MAX_BULK_ASSIGN && <span className="text-xs font-normal text-p-muted">· галочка выбирает первые {MAX_BULK_ASSIGN}</span>}</button></td>
              </tr>
              {isOpen && group.rows.slice(0, limit).map(({ student, assignments }) => {
                const first = assignments.find((assignment) => assignment.staffId === staffFilter) ?? assignments[0]
                return <tr key={student.id} className={`border-t border-p-line hover:bg-p-panel2 ${selected.has(student.id) ? 'bg-p-chip' : ''}`}>
                  {selectionMode && <td className="px-3 py-3">{canAssign && !assignments.length && <input type="checkbox" aria-label={`Выбрать ${student.full_name}`} checked={selected.has(student.id)} onChange={(event) => onToggleSelection([student.id], event.target.checked)} />}</td>}
                  <td className="px-3 py-3"><Link className="font-bold text-p-text underline-offset-2 hover:underline" to={`/students/${student.id}`}>{student.full_name}</Link><div className="text-xs text-p-muted2">{student.intake_year ?? 'Набор не указан'} · {student.country || 'страна не указана'}</div></td>
                  <td className="px-3 py-3"><span title={student.status_source === 'notion' ? 'Источник статуса: Notion' : 'Источник статуса: CRM'}><StudentPipelineStatusBadge status={student.status_source === 'notion' ? student.pipeline_status : student.crm_status ?? student.pipeline_status} /></span></td>
                  <td className="px-3 py-3 text-p-muted">{student.country || '—'}</td>
                  <td className="bg-p-chip px-3 py-3 font-semibold text-p-text">{assignments.length ? assignments.map((assignment) => assignment.staffName).join(', ') : <button type="button" disabled={!canAssign} aria-label={`Назначить ${roleLabel}: ${student.full_name}`} onClick={() => onSingleAssign(student.id, student.full_name, 'unassigned')} className="min-h-8 rounded-ctl border border-dashed border-p-accent-dim px-3 text-p-accent-text disabled:cursor-default">+ Назначить</button>}</td>
                  <td className="px-3 py-3">{canAssign && (first ? <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => onSingleAssign(student.id, student.full_name, first.staffId)}>Передать</Button>{first.assignmentId && <Button size="sm" variant="ghost" onClick={() => onUnassign(first.assignmentId!, first.staffName)}>Снять</Button>}</div> : <Button size="sm" variant="outline" onClick={() => onSingleAssign(student.id, student.full_name, 'unassigned')}>Назначить</Button>)}</td>
                </tr>
              })}
              {isOpen && group.rows.length > limit && <tr className="border-t border-p-line"><td colSpan={5 + Number(selectionMode)} className="px-3 py-3 text-center"><button type="button" className="min-h-8 font-semibold text-p-accent-text underline" onClick={() => onShowMore(group.key, limit + 15)}>Показать ещё 15</button><span className="ml-2 text-xs text-p-muted">показано {limit} из {group.rows.length}</span></td></tr>}
            </tbody>
          })}
        </table>
        {!groups.length && <p className="p-8 text-center text-sm text-p-muted">{listScope === 'unassigned' && !staffFilter ? `У всех студентов по этим фильтрам есть «${roleLabel}».` : 'В этом списке никого нет. Попробуйте снять фильтры.'}</p>}
      </div>
      <p className="mt-3 text-xs text-p-muted">{selectionMode ? 'Отметьте студентов без ответственного или всю группу, затем выберите сотрудника.' : 'Для массового назначения нажмите «Выбрать студентов».'} Назначенного студента можно передать кнопкой в строке.</p>
    </div>

    <aside className="h-fit rounded-panel border border-p-line bg-p-panel p-4">
      <h2 className="mb-3 text-sm font-bold text-p-text">Кто ведёт · {roleLabel}</h2>
      <button type="button" onClick={() => onChooseScope('unassigned')} className={`flex min-h-10 w-full items-center justify-between rounded-ctl px-3 text-left text-sm font-semibold hover:bg-p-panel2 ${!staffFilter && listScope === 'unassigned' ? 'bg-p-chip text-p-chip-text' : 'text-p-text'}`}><span>Без ответственного</span><span>{unassignedCount}</span></button>
      {board.columns.map((column) => <button key={column.staff_id} type="button" onClick={() => onChooseScope('all', column.staff_id)} className={`flex min-h-10 w-full items-center justify-between rounded-ctl px-3 text-left text-sm hover:bg-p-panel2 ${staffFilter === column.staff_id ? 'bg-p-chip font-bold text-p-chip-text' : 'text-p-text'}`}><span>{column.name}</span><strong>{staffCounts.get(column.staff_id) ?? 0}</strong></button>)}
      <p className="mt-3 border-t border-p-line pt-3 text-xs text-p-muted">Нажмите на имя, чтобы открыть список студентов. Для ментора по стране студент может учитываться у нескольких сотрудников.</p>
    </aside>
  </div>
)
