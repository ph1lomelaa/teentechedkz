import React from 'react'
import { UniversitiesCatalog } from '@/components/portal/UniversitiesCatalog'
import { useAuth } from '@/contexts/AuthContext'

// Staff/mentor universities catalog — same donor-style catalog as the student
// portal, rendered inside the workspace shell (p-* tokens resolve there too).
export const WorkspaceUniversitiesPage: React.FC = () => {
  const { hasRole } = useAuth()
  return <UniversitiesCatalog eyebrow="Кабинет ментора" basePath="/workspace/universities" canManage={hasRole('admin', 'mzk_manager')} canImport={hasRole('admin')} />
}
