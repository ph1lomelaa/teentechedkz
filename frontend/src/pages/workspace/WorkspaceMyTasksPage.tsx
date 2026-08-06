import React from 'react'
import { MyTasksList } from '@/components/admin/MyTasksList'

/** Свои задачи в воркспейсе. */
export const WorkspaceMyTasksPage: React.FC = () => (
  <MyTasksList colorPrefix="w" studentHrefBase="/workspace/students" />
)
