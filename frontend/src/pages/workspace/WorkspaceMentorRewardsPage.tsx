import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MentorRewardsManager } from '@/components/admin/MentorRewardsManager'

/**
 * Ведут раздел админ и МЗК. Ментор попадает сюда же — бэкенд отдаёт ему только
 * его строки, — и может подать возражение по санкции (п.6.8).
 */
export const WorkspaceMentorRewardsPage: React.FC = () => {
  const { can } = useAuth()
  const canManage = can('mentor_rewards', 'manage')
  return <MentorRewardsManager colorPrefix="w" canManage={canManage} />
}
