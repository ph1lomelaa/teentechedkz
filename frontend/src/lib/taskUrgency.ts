/**
 * Единый источник правды для срочности задач — зеркало backend/app/services/task_urgency.py.
 *
 * due_date приходит с бэка как календарная дата (YYYY-MM-DD), без времени. Просрочка
 * считается в целых днях с полуночи после дедлайна: due_date === today — это ещё не
 * просрочка. Три вида задач (StudentTask, RoadmapTask, workspaceApi) используют эту
 * же функцию — иначе цвета разъедутся по экранам (см. ОС 30/07, Блок B).
 *
 * Пороги (Прил. № 3, п. 3.4): жёлтый < 24ч · оранжевый 24–48ч · красный 48–72ч ·
 * critical > 72ч (существенное нарушение — основание расторгнуть договор).
 */

export type Urgency = 'none' | 'yellow' | 'orange' | 'red' | 'critical'

const DONE_STATUSES = new Set(['done'])

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

export function taskUrgency(dueDate: string | null | undefined, status: string, today: Date = new Date()): Urgency {
  if (!dueDate || DONE_STATUSES.has(status)) return 'none'

  const due = parseDateOnly(dueDate)
  const reference = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const msPerDay = 24 * 60 * 60 * 1000
  const overdueDays = Math.round((reference.getTime() - due.getTime()) / msPerDay)

  if (overdueDays <= 0) return 'none'
  if (overdueDays <= 1) return 'yellow'
  if (overdueDays <= 2) return 'orange'
  if (overdueDays <= 3) return 'red'
  return 'critical'
}
