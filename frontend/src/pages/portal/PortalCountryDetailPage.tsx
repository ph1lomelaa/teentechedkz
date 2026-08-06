import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { CountryDetail } from '@/components/shared/CountryDetail'

export const PortalCountryDetailPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <CountryDetail basePath="/portal/countries" universitiesPath="/portal/universities" />
  </PageShell>
)
