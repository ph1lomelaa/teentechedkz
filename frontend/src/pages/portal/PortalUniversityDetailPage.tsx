import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { UniversityDetail } from '@/components/portal/UniversityDetail'

export const PortalUniversityDetailPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <UniversityDetail basePath="/portal/universities" />
  </PageShell>
)
