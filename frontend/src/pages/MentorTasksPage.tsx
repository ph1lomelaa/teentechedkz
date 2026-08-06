import React from 'react'
import { MentorTasksBoard } from '@/components/admin/MentorTasksBoard'

/** CRM-версия доски задач менторов. */
export const MentorTasksPage: React.FC = () => (
  <MentorTasksBoard colorPrefix="ds" studentHrefBase="/students" />
)
