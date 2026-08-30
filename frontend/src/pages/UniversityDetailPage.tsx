import React from 'react'
import { UniversityDetail } from '@/components/portal/UniversityDetail'
import { useAuth } from '@/contexts/AuthContext'

export const UniversityDetailPage: React.FC = () => {
  const { can } = useAuth()
  return <UniversityDetail basePath="/universities" canManage={can('universities', 'manage')} />
}
