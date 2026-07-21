import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { NotificationsFeed } from '@/components/shared/NotificationsFeed'

export const WorkspaceNotificationsPage: React.FC = () => (
  <PageShell maxWidth="md">
    <NotificationsFeed variant="workspace" />
  </PageShell>
)
