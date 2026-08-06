import React from 'react'
import { CountriesCatalog } from '@/components/shared/CountriesCatalog'
import { useAuth } from '@/contexts/AuthContext'

export const WorkspaceCountriesPage: React.FC = () => {
  const { hasRole } = useAuth()
  return (
    <CountriesCatalog
      eyebrow="База знаний"
      basePath="/workspace/countries"
      canManage={hasRole('admin', 'mzk_manager')}
    />
  )
}
