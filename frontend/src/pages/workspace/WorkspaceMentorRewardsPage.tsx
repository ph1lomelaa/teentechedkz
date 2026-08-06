import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MentorRewardsManager } from '@/components/admin/MentorRewardsManager'

/**
 * Ведут раздел админ и МЗК. Ментор попадает сюда же — бэкенд отдаёт ему только
 * его строки, — и может подать возражение по санкции (п.6.8).
 */
export const WorkspaceMentorRewardsPage: React.FC = () => {
  const { hasRole } = useAuth()
  const canManage = hasRole('admin') || hasRole('mzk_manager')
  return <MentorRewardsManager colorPrefix="w" canManage={canManage} />
}
