import { describe, expect, it } from 'vitest'
import type { AssignmentBoard, BoardStudent } from '@/types'
import { groupDistributionRows, selectableGroupIds, uniqueBoardRows } from './listModel'

const student = (id: string, name: string, year: number): BoardStudent => ({
  id, full_name: name, intake_year: year, country: 'Корея', pipeline_status: 'active_work',
  assignment_id: null, assignment_status: null,
})

const board: AssignmentBoard = {
  role: 'country',
  totals: { students: 2, assigned: 1, unassigned: 1 },
  unassigned: [student('2', 'Алия', 2027)],
  columns: [
    { staff_id: 'a', name: 'Амина', user_role: 'mentor', students: [{ ...student('1', 'Жан', 2026), assignment_id: 'one' }] },
    { staff_id: 'b', name: 'Бибинур', user_role: 'mentor', students: [{ ...student('1', 'Жан', 2026), assignment_id: 'two' }] },
  ],
}

describe('distribution list model', () => {
  const filters = {
    statuses: new Set(['active_work']), years: new Set<string>(),
    degrees: new Set<string>(), countries: new Set<string>(),
  }

  it('counts a student with two country mentors once and keeps both assignments', () => {
    const rows = uniqueBoardRows(board, filters)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.student.id === '1')?.assignments.map((assignment) => assignment.staffName)).toEqual(['Амина', 'Бибинур'])
    expect(rows.filter((row) => row.assignments.length === 0)).toHaveLength(1)
  })

  it('groups by year without rendering duplicate students', () => {
    const groups = groupDistributionRows(uniqueBoardRows(board, filters), 'year')
    expect(groups.map((group) => [group.label, group.rows.length, group.unassigned])).toEqual([
      ['Набор 2026', 1, 0], ['Набор 2027', 1, 1],
    ])
  })

  it('limits selecting an entire group to the existing 200-student bulk API maximum', () => {
    const large = {
      ...board,
      unassigned: Array.from({ length: 201 }, (_, index) => student(String(index), `Студент ${index}`, 2027)),
      columns: [],
    }
    const [group] = groupDistributionRows(uniqueBoardRows(large, filters), 'year')
    expect(group.rows).toHaveLength(201)
    expect(selectableGroupIds(group)).toHaveLength(200)
  })
})
