import { describe, expect, it } from 'vitest'
import { matchesOperationalFilter } from './StudentsListPage'
import type { StudentListItem } from '@/types'

/**
 * «Контроль работы» в общей базе.
 *
 * Ради чего тест: risk_category === 'renewal' («Контракт 500») уже считался
 * на бэке и был виден на «Рисках», но в этом фильтре его не было ни одного
 * значения — тот же самый список студентов, отобранный тем же сигналом,
 * приходилось искать в другом разделе. Остальные семь сигналов заодно
 * покрыты границами (0 не значит «есть», null не значит false), которых
 * не было вовсе — тернар в JSX такое не ловит.
 */
function student(overrides: Partial<StudentListItem> = {}): StudentListItem {
  return {
    id: 's1',
    full_name: 'Тестовый студент',
    phone: '+7',
    degree_level: 'undergraduate',
    intake_year: 2026,
    ...overrides,
  }
}

describe('matchesOperationalFilter', () => {
  it('all пропускает всех', () => {
    expect(matchesOperationalFilter(student(), 'all')).toBe(true)
  })

  it('renewal — контракт 500, тот же сигнал, что на «Рисках»', () => {
    expect(matchesOperationalFilter(student({ risk_category: 'renewal' }), 'renewal')).toBe(true)
    expect(matchesOperationalFilter(student({ risk_category: 'suspended' }), 'renewal')).toBe(false)
    expect(matchesOperationalFilter(student({ risk_category: null }), 'renewal')).toBe(false)
    expect(matchesOperationalFilter(student(), 'renewal')).toBe(false)
  })

  it('open_tasks: 0 не считается «есть задачи»', () => {
    expect(matchesOperationalFilter(student({ open_tasks_count: 0 }), 'open_tasks')).toBe(false)
    expect(matchesOperationalFilter(student({ open_tasks_count: 1 }), 'open_tasks')).toBe(true)
    expect(matchesOperationalFilter(student(), 'open_tasks')).toBe(false)
  })

  it('docs_review: 0 не считается «есть документы на проверке»', () => {
    expect(matchesOperationalFilter(student({ documents_unverified: 0 }), 'docs_review')).toBe(false)
    expect(matchesOperationalFilter(student({ documents_unverified: 2 }), 'docs_review')).toBe(true)
  })

  it('overdue_tasks и open_complaints читают булевы флаги бэка как есть', () => {
    expect(matchesOperationalFilter(student({ has_overdue_tasks: true }), 'overdue_tasks')).toBe(true)
    expect(matchesOperationalFilter(student({ has_overdue_tasks: false }), 'overdue_tasks')).toBe(false)
    expect(matchesOperationalFilter(student({ has_open_complaints: true }), 'open_complaints')).toBe(true)
    expect(matchesOperationalFilter(student(), 'open_complaints')).toBe(false)
  })

  it('no_roadmap и no_meeting — отсутствие связанной сущности', () => {
    expect(matchesOperationalFilter(student(), 'no_roadmap')).toBe(true)
    expect(matchesOperationalFilter(student({ roadmap: { id: 'r1', name: 'RM', progress: 0, tasks_total: 0, tasks_done: 0 } }), 'no_roadmap')).toBe(false)
    expect(matchesOperationalFilter(student(), 'no_meeting')).toBe(true)
  })

  it('telegram_unlinked — привязка read как s.telegram?.linked', () => {
    expect(matchesOperationalFilter(student(), 'telegram_unlinked')).toBe(true)
    expect(matchesOperationalFilter(student({ telegram: { linked: true, pending_signals: 0 } }), 'telegram_unlinked')).toBe(false)
    expect(matchesOperationalFilter(student({ telegram: { linked: false, pending_signals: 0 } }), 'telegram_unlinked')).toBe(true)
  })
})
