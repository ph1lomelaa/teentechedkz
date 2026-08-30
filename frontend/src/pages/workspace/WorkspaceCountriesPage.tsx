import React from 'react'
import { CountriesCatalog } from '@/components/shared/CountriesCatalog'
import { useAuth } from '@/contexts/AuthContext'

export const WorkspaceCountriesPage: React.FC = () => {
  const { can } = useAuth()
  return (
    <CountriesCatalog
      eyebrow="База знаний"
      basePath="/workspace/countries"
      canManage={can('countries', 'edit')}
    />
  )
}
