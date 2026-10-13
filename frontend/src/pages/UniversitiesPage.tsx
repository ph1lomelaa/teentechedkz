import React from 'react'
import { UniversitiesCatalog } from '@/components/portal/UniversitiesCatalog'
import { useAuth } from '@/contexts/AuthContext'

// Staff can create catalog entries; editing and import use separate permissions.
export const UniversitiesPage: React.FC = () => {
  const { can } = useAuth()
  return (
    <UniversitiesCatalog
      eyebrow="Справочник"
      basePath="/universities"
      canManage={can('universities', 'manage')} canCreate={can('universities', 'create')}
      canImport={can('university_import', 'create')}
    />
  )
}
