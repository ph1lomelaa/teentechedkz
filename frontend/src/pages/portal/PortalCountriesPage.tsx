import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { PortalCountriesCatalog } from '@/components/portal/PortalCountriesCatalog'

export const PortalCountriesPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <PortalCountriesCatalog />
  </PageShell>
)
