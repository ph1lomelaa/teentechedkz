import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MzkQualityManager } from '@/components/admin/MzkQualityManager'

/**
 * Оценки ставит только админ. МЗК-менеджер попадает сюда же, но видит лишь
 * свой помесячный балл — раньше пункт меню ему показывался, а все четыре
 * запроса отдавали 403.
 */
export const WorkspaceMzkQualityPage: React.FC = () => {
  const { can } = useAuth()
  return <MzkQualityManager colorPrefix="w" canManage={can('mzk_quality', 'manage')} />
}
