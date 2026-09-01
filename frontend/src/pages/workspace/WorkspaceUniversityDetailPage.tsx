import React from 'react'
import { UniversityDetail } from '@/components/portal/UniversityDetail'
import { useAuth } from '@/contexts/AuthContext'

// Same detail view as the student portal, rendered inside the workspace shell.
// StudentRoute and WorkspaceRoute are mutually exclusive, so the page needs a
// wrapper on each side rather than one shared route.
// canManage передаём как и в CRM-версии: дефолт компонента — false, поэтому
// без этой строки сотрудник с правом universities:manage не видел бы правку.
export const WorkspaceUniversityDetailPage: React.FC = () => {
  const { can } = useAuth()
  return <UniversityDetail basePath="/workspace/universities" canManage={can('universities', 'manage')} />
}
