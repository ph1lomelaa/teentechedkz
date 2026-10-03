/**
 * Строка срока в кабинете ученика — одна на все страницы.
 *
 * Раньше главная, «Задачи» и roadmap писали срок каждая по-своему («26 сент.»,
 * «26.09.2026», «01 нояб.»), а просрочку на «Задачах» показывали служебным
 * бейджем «КРИТИЧНО · > 72Ч» — это шкала штрафов для менторов, ученику она
 * не адресована. Теперь везде: «дедлайн 26 сент.» и, если опоздал, ещё
 * «просрочено на N дн.».
 */
import { formatDeadline, overdueDaysOf } from './roadmapDeadline'

interface DueSource {
  due_date: string | null
  overdue_days?: number
}

/** Дней просрочки у невыполненной задачи; 0 — в срок, без срока или выполнена. */
export function studentOverdueDays(task: DueSource, done: boolean): number {
  return overdueDaysOf(task, done)
}

export function studentDueText(task: DueSource, done: boolean): string {
  if (!task.due_date) return 'без дедлайна'
  const late = studentOverdueDays(task, done)
  const base = `дедлайн ${formatDeadline(task.due_date)}`
  return late > 0 ? `${base} · просрочено на ${late} дн.` : base
}
