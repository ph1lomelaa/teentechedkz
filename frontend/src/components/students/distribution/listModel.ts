import { AssignmentBoard, BoardStudent, PIPELINE_STATUS_LABELS } from '@/types'
import { BoardFilters, boardStatusKey, matchesBoardFilters } from '@/components/students/DistributionBoard'

export interface DistributionRow {
  student: BoardStudent
  /** A country mentor can appear in several columns for one student. */
  assignments: Array<{ staffId: string; staffName: string; assignmentId: string | null }>
}

export type DistributionGroupBy = 'year' | 'country' | 'status'

export interface DistributionGroup {
  key: string
  label: string
  rows: DistributionRow[]
  unassigned: number
}

export const MAX_BULK_ASSIGN = 200

/** The existing bulk endpoint accepts at most 200 student IDs per request. */
export function selectableGroupIds(group: DistributionGroup): string[] {
  return group.rows.filter((row) => row.assignments.length === 0)
    .slice(0, MAX_BULK_ASSIGN).map((row) => row.student.id)
}

export function uniqueBoardRows(board: AssignmentBoard, filters: BoardFilters, search = ''): DistributionRow[] {
  const byId = new Map<string, DistributionRow>()
  const term = search.trim().toLocaleLowerCase()
  const accepts = (student: BoardStudent) => matchesBoardFilters(student, filters)
    && student.full_name.toLocaleLowerCase().includes(term)

  for (const student of board.unassigned) {
    if (accepts(student)) byId.set(student.id, { student, assignments: [] })
  }
  for (const column of board.columns) {
    for (const student of column.students) {
      if (!accepts(student)) continue
      const row = byId.get(student.id) ?? { student, assignments: [] }
      if (!row.assignments.some((assignment) => assignment.assignmentId === student.assignment_id && assignment.staffId === column.staff_id)) {
        row.assignments.push({ staffId: column.staff_id, staffName: column.name, assignmentId: student.assignment_id })
      }
      byId.set(student.id, row)
    }
  }
  return [...byId.values()].sort((a, b) => a.student.full_name.localeCompare(b.student.full_name, 'ru'))
}

export function groupDistributionRows(rows: DistributionRow[], by: DistributionGroupBy): DistributionGroup[] {
  const groups = new Map<string, DistributionGroup>()
  for (const row of rows) {
    const student = row.student
    const key = by === 'year' ? String(student.intake_year ?? '')
      : by === 'country' ? student.country || ''
      : boardStatusKey(student) || ''
    const label = by === 'year' ? (key ? `Набор ${key}` : 'Набор не указан')
      : by === 'country' ? (key || 'Страна не указана')
      : key ? (PIPELINE_STATUS_LABELS[key as keyof typeof PIPELINE_STATUS_LABELS] || key) : 'Нет статуса Notion'
    const group = groups.get(key) ?? { key, label, rows: [], unassigned: 0 }
    group.rows.push(row)
    if (!row.assignments.length) group.unassigned++
    groups.set(key, group)
  }
  const result = [...groups.values()]
  if (by === 'year') result.sort((a, b) => a.key.localeCompare(b.key, 'ru', { numeric: true }))
  else result.sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label, 'ru'))
  return result
}
