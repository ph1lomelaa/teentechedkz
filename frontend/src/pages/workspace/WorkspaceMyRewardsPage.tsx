import React from 'react'
import { MentorRewardsManager } from '@/components/admin/MentorRewardsManager'

/**
 * Ментор смотрит свои этапы и штрафы и может подать возражение (п.6.8).
 * Раньше право возражать существовало только в API: ментор не видел даже
 * самих санкций, хотя они выражены в деньгах.
 *
 * Отдельные списки не нужны — оба GET на бэкенде сами скоупятся на ментора.
 */
export const WorkspaceMyRewardsPage: React.FC = () => (
  <MentorRewardsManager colorPrefix="w" canManage={false} />
)
