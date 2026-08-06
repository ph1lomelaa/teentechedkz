import React from 'react'
import { UniversityDetail } from '@/components/portal/UniversityDetail'
import { useAuth } from '@/contexts/AuthContext'

export const UniversityDetailPage: React.FC = () => {
  const { hasRole } = useAuth()
  return <UniversityDetail basePath="/universities" canManage={hasRole('admin', 'mzk_manager')} />
}
