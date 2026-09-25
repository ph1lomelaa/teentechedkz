import { describe, expect, it } from 'vitest'
import { boardCardKey, resolveDrop, UNASSIGNED_COLUMN } from './DistributionBoard'
import { AssignmentBoard } from '@/types'

/**
 * Куда уехала карточка при перетаскивании.
 *
 * Ради чего тест: это единственное место доски, где ошибка не видна глазом —
 * она молча назначит студента не тому сотруднику, и обнаружится это уже как
 * жалоба «мне отдали чужого ученика». Само перетаскивание в jsdom честно не
 * воспроизвести (dnd-kit слушает pointer-события с порогом активации), поэтому
 * решение вынесено в чистую функцию и проверяется здесь.
 *
 * Карточка опознаётся по назначению, а не по ученику: в мультироли (ментор по
 * стране) у одного ученика две карточки в разных колонках, и по `student.id`
 * функция находила бы колонку первой попавшейся.
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

/** Доска мультироли: один ученик у двух менторов по стране. */
const countryBoard: AssignmentBoard = {
  role: 'country',
  totals: { students: 1, assigned: 1, unassigned: 0 },
  columns: [
    {
      staff_id: 'ayana',
      name: 'Айана',
      user_role: 'mentor',
      students: [
        { id: 's1', full_name: 'Мерей', assignment_id: 'a1', assignment_status: 'active', country: 'США' },
      ],
    },
    {
      staff_id: 'kyz',
      name: 'Кызжибек',
      user_role: 'mentor',
      students: [
        { id: 's1', full_name: 'Мерей', assignment_id: 'a2', assignment_status: 'active', country: 'Канада' },
      ],
    },
  ],
  unassigned: [],
}

describe('resolveDrop', () => {
  it('переносит студента в колонку, на которую его бросили', () => {
    expect(resolveDrop(board, 'a1', 'alia')).toEqual({
      studentId: 's1',
      assignmentId: 'a1',
      from: 'zira',
      to: 'alia',
    })
  })

  it('засчитывает бросок на чужую карточку как бросок в её колонку', () => {
    // Попасть точно в пустое место колонки трудно, и чаще карточку роняют на
    // соседнюю. Без этого половина перетаскиваний молча ничего не делала бы.
    expect(resolveDrop(board, 'a1', 'a2')).toEqual({
      studentId: 's1',
      assignmentId: 'a1',
      from: 'zira',
      to: 'alia',
    })
  })

  it('назначает студента из «без ответственного»', () => {
    expect(resolveDrop(board, boardCardKey(board.unassigned[0]), 'zira')).toEqual({
      studentId: 's3',
      assignmentId: null,
      from: UNASSIGNED_COLUMN,
      to: 'zira',
    })
  })

  it('не считает перетаскиванием возврат в ту же колонку', () => {
    // Промах мышью не должен уходить запросом на замену — она пишется в
    // историю назначений и требует причины.
    expect(resolveDrop(board, 'a1', 'zira')).toBeNull()
    expect(resolveDrop(board, 'a1', 'a1')).toBeNull()
  })

  it('бросок в «без ответственного» — это снятие', () => {
    // Раньше бросок игнорировался, а снять ответственного было негде вовсе.
    // Случайный промах не страшен: страница спросит причину, и отмена
    // оставит всё как было.
    expect(resolveDrop(board, 'a1', UNASSIGNED_COLUMN)).toEqual({
      studentId: 's1',
      assignmentId: 'a1',
      from: 'zira',
      to: UNASSIGNED_COLUMN,
    })
  })

  it('игнорирует бросок мимо колонок', () => {
    expect(resolveDrop(board, 'a1', null)).toBeNull()
  })

  it('в мультироли различает две карточки одного ученика', () => {
    // Главное свойство: тащим карточку из колонки Айаны — переносится её
    // назначение, а карточка Кызжибек остаётся на месте. По `student.id`
    // функция нашла бы первую колонку и сняла бы не того.
    expect(resolveDrop(countryBoard, 'a2', 'ayana')).toEqual({
      studentId: 's1',
      assignmentId: 'a2',
      from: 'kyz',
      to: 'ayana',
    })
  })

  it('в мультироли возврат в свою колонку по-прежнему промах', () => {
    expect(resolveDrop(countryBoard, 'a2', 'kyz')).toBeNull()
  })
})
