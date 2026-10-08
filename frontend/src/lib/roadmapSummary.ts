import type { Roadmap } from '@/api/roadmap'
import { overdueDaysOf } from '@/lib/roadmapDeadline'

export interface RoadmapDeadlineSummary {
  overdue: number
  next7: number
  withoutDate: number
  nearest: string | null
}

/** Counts unfinished tasks and subtasks separately, using their own deadlines. */
export function roadmapDeadlineSummary(roadmap: Roadmap | null, today = new Date()): RoadmapDeadlineSummary {
  const summary: RoadmapDeadlineSummary = { overdue: 0, next7: 0, withoutDate: 0, nearest: null }
  if (!roadmap) return summary
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const nextWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)
  const nextWeekIso = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, '0')}-${String(nextWeek.getDate()).padStart(2, '0')}`
  const add = (item: { due_date: string | null; overdue_days?: number }, done: boolean) => {
    if (done) return
    if (!item.due_date) { summary.withoutDate++; return }
    if (overdueDaysOf(item, false, today) > 0) summary.overdue++
    else if (item.due_date >= todayIso && item.due_date <= nextWeekIso) summary.next7++
    if (item.due_date >= todayIso && (!summary.nearest || item.due_date < summary.nearest)) summary.nearest = item.due_date
  }
  roadmap.stages.forEach((stage) => stage.tasks.forEach((task) => {
    add(task, task.status === 'done')
    task.subtasks.forEach((subtask) => add(subtask, subtask.is_done))
  }))
  return summary
}
