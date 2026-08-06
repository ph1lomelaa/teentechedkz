import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { CountriesCatalog } from '@/components/shared/CountriesCatalog'

export const PortalCountriesPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <CountriesCatalog eyebrow="Кабинет" basePath="/portal/countries" />
  </PageShell>
)
