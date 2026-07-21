import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { NotificationsFeed } from '@/components/shared/NotificationsFeed'

export const PortalNotificationsPage: React.FC = () => (
  <PageShell maxWidth="md">
    <NotificationsFeed variant="portal" />
  </PageShell>
)
