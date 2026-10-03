/**
 * Правила сроков роадмапа (решение по умолчанию, пока заказчик не ответил):
 *  - подзадача может быть позже основной задачи — это предупреждение, не запрет;
 *  - перенос срока задачи подзадачи не двигает;
 *  - выполненное не бывает просроченным;
 *  - просрочено, если срок < сегодня и не выполнено.
 *
 * «Сегодня» считает бэк по COMPANY_TIMEZONE и отдаёт готовое overdue_days;
 * локальный расчёт — только запасной путь для данных без этого поля.
 */

interface WithDeadline {
  due_date: string | null
  overdue_days?: number
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

/** «15 окт.» — короткая форма для карточки; год показываем, только если он не текущий. */
export function formatDeadline(value: string, today: Date = new Date()): string {
  const date = parseDateOnly(value)
  const sameYear = date.getFullYear() === today.getFullYear()
  return date.toLocaleDateString('ru-RU', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function overdueDaysOf(item: WithDeadline, done: boolean, today: Date = new Date()): number {
  if (done || !item.due_date) return 0
  if (typeof item.overdue_days === 'number') return item.overdue_days
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(Math.round((ref.getTime() - parseDateOnly(item.due_date).getTime()) / 86_400_000), 0)
}

/** Подзадача позже задачи: строгое сравнение ISO-дат; без любого из сроков предупреждать не о чем. */
export function isLaterThanTask(subDue: string | null, taskDue: string | null): boolean {
  return Boolean(subDue && taskDue && subDue > taskDue)
}

/** По сроку, без срока — в конец, при равенстве — по position. */
export function sortSubtasksByDeadline<T extends { due_date: string | null; position: number }>(subtasks: T[]): T[] {
  return [...subtasks].sort((a, b) => {
    if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
    return a.position - b.position
  })
}
