/** Общие заготовки формы активности: пустая запись, перевод в ввод, стандартные типы. */
import type { Activity, ActivityInput } from '@/api/activities'

export function activityInput(a: Activity): ActivityInput {
  return { title: a.title, direction: a.direction, kind: a.kind, organizer: a.organizer, country: a.country,
    description: a.description, eligibility: a.eligibility, assignment: a.assignment, source_url: a.source_url,
    publication: a.publication, conditions_checked_at: a.conditions_checked_at ?? null,
    // Угаданный по kind тип не фиксируем: иначе после правки kind он бы «застыл».
    experience_type: a.experience_explicit ? a.experience_type ?? null : null }
}
// Тип активности сводится к типу опыта портфолио по ключевым словам
// (backend app/services/experience.py). Подсказки — формулировки, которые точно распознаются.
export const STANDARD_KINDS = ['Конкурс / олимпиада', 'Исследовательский проект', 'Академия / программа', 'Летняя школа', 'Курс', 'Стажировка', 'Волонтёрство']

export const emptyActivity: ActivityInput = { title: '', direction: null, kind: null, organizer: null, country: null, description: null, eligibility: null, assignment: null, source_url: null, publication: 'draft', conditions_checked_at: null, experience_type: null }
