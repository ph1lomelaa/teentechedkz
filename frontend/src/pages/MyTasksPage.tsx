import React from 'react'
import { MyTasksList } from '@/components/admin/MyTasksList'

/** CRM-версия «мои задачи». */
export const MyTasksPage: React.FC = () => (
  <MyTasksList colorPrefix="ds" studentHrefBase="/students" />
)
