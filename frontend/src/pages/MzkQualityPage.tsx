import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MzkQualityManager } from '@/components/admin/MzkQualityManager'

/** CRM-версия ОКК МЗК. Оценки ставит админ; МЗК-менеджер видит только свой балл. */
export const MzkQualityPage: React.FC = () => {
  const { can } = useAuth()
  return <MzkQualityManager colorPrefix="ds" canManage={can('mzk_quality', 'manage')} />
}
