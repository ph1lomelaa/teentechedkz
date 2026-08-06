import React from 'react'
import { UniversitiesCatalog } from '@/components/portal/UniversitiesCatalog'
import { useAuth } from '@/contexts/AuthContext'

// CRM catalog — the same rich component the portal and workspace render, plus
// the management affordances only the CRM exposes. Catalog writes are
// admin/mzk only (a mentor deleting a row removes it for every student).
export const UniversitiesPage: React.FC = () => {
  const { hasRole } = useAuth()
  return (
    <UniversitiesCatalog
      eyebrow="Справочник"
      basePath="/universities"
      canManage={hasRole('admin', 'mzk_manager')}
      canImport={hasRole('admin')}
    />
  )
}
