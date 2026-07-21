import React from 'react'
import { NotificationsFeed } from '@/components/shared/NotificationsFeed'

// Как и остальные workspace-страницы: без собственного контейнера, ширину
// задаёт main в WorkspaceLayout (max-w-[1180px]) — все экраны одного размера.
export const WorkspaceNotificationsPage: React.FC = () => (
  <div className="animate-fade-in">
    <NotificationsFeed variant="workspace" />
  </div>
)
