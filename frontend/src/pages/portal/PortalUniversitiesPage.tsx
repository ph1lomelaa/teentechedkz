import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { PageShell } from '@/components/shared/PageShell'
import { UniversitiesCatalog } from '@/components/portal/UniversitiesCatalog'

export const PortalUniversitiesPage: React.FC = () => {
  const { can } = useAuth()
  return (
  <PageShell maxWidth="lg">
    <UniversitiesCatalog eyebrow="Кабинет" canCreate={can('universities', 'create')} />
  </PageShell>
  )
}
