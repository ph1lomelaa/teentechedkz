import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { UniversitiesCatalog } from '@/components/portal/UniversitiesCatalog'

export const PortalUniversitiesPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <UniversitiesCatalog eyebrow="Кабинет" />
  </PageShell>
)
