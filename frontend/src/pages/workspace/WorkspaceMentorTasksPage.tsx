import React from 'react'
import { MentorTasksBoard } from '@/components/admin/MentorTasksBoard'

/** Доска задач менторов в воркспейсе. Управление — МЗК и админ. */
export const WorkspaceMentorTasksPage: React.FC = () => (
  <MentorTasksBoard colorPrefix="w" studentHrefBase="/workspace/students" />
)
