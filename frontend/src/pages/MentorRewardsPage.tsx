import React from 'react'
import { MentorRewardsManager } from '@/components/admin/MentorRewardsManager'

/**
 * CRM-версия вознаграждений. Ссылка на «Финансы» передаётся только здесь:
 * в воркспейсе такого раздела нет, а рядом в CRM лежат реальные выплаты
 * менторам — две похожие таблицы с деньгами надо явно развести.
 */
export const MentorRewardsPage: React.FC = () => (
  <MentorRewardsManager colorPrefix="ds" financesPath="/finances" />
)
