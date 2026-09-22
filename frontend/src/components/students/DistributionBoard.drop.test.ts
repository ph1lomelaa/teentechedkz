import { describe, expect, it } from 'vitest'
import { resolveDrop, UNASSIGNED_COLUMN } from './DistributionBoard'
import { AssignmentBoard } from '@/types'

/**
 * Куда уехала карточка при перетаскивании.
 *
 * Ради чего тест: это единственное место доски, где ошибка не видна глазом —
 * она молча назначит студента не тому сотруднику, и обнаружится это уже как
 * жалоба «мне отдали чужого ученика». Само перетаскивание в jsdom честно не
 * воспроизвести (dnd-kit слушает pointer-события с порогом активации), поэтому
 * решение вынесено в чистую функцию и проверяется здесь.
 */
const board: AssignmentBoard = {
  role: 'mzk',
  totals: { students: 3, assigned: 2, unassigned: 1 },
  columns: [
    {
      staff_id: 'zira',
      name: 'Зира',
      user_role: 'mzk_manager',
      students: [
        { id: 's1', full_name: 'Мерей', assignment_id: 'a1', assignment_status: 'active' },
      ],
    },
    {
      staff_id: 'alia',
      name: 'Алия',
      user_role: 'mzk_manager',
      students: [
        { id: 's2', full_name: 'Аружан', assignment_id: 'a2', assignment_status: 'active' },
      ],
    },
  ],
  unassigned: [{ id: 's3', full_name: 'Дана', assignment_id: null, assignment_status: null }],
}

describe('resolveDrop', () => {
  it('переносит студента в колонку, на которую его бросили', () => {
    expect(resolveDrop(board, 's1', 'alia')).toEqual({ studentId: 's1', from: 'zira', to: 'alia' })
  })

  it('засчитывает бросок на чужую карточку как бросок в её колонку', () => {
    // Попасть точно в пустое место колонки трудно, и чаще карточку роняют на
    // соседнюю. Без этого половина перетаскиваний молча ничего не делала бы.
    expect(resolveDrop(board, 's1', 's2')).toEqual({ studentId: 's1', from: 'zira', to: 'alia' })
  })

  it('назначает студента из «без ответственного»', () => {
    expect(resolveDrop(board, 's3', 'zira')).toEqual({
      studentId: 's3',
      from: UNASSIGNED_COLUMN,
      to: 'zira',
    })
  })

  it('не считает перетаскиванием возврат в ту же колонку', () => {
    // Промах мышью не должен уходить запросом на замену — она пишется в
    // историю назначений и требует причины.
    expect(resolveDrop(board, 's1', 'zira')).toBeNull()
    expect(resolveDrop(board, 's1', 's1')).toBeNull()
  })

  it('бросок в «без ответственного» — это снятие', () => {
    // Раньше бросок игнорировался, а снять ответственного было негде вовсе.
    // Случайный промах не страшен: страница спросит причину, и отмена
    // оставит всё как было.
    expect(resolveDrop(board, 's1', UNASSIGNED_COLUMN)).toEqual({
      studentId: 's1',
      from: 'zira',
      to: UNASSIGNED_COLUMN,
    })
  })

  it('игнорирует бросок мимо колонок', () => {
    expect(resolveDrop(board, 's1', null)).toBeNull()
  })
})
