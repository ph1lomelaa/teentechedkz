import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MentorRewardsManager } from '@/components/admin/MentorRewardsManager'

/**
 * CRM-версия вознаграждений. Ссылка на «Финансы» передаётся только здесь:
 * в воркспейсе такого раздела нет, а рядом в CRM лежат реальные выплаты
 * менторам — две похожие таблицы с деньгами надо явно развести.
 *
 * canManage обязателен: у менеджера дефолт true, и без этой строки ментор
 * видел здесь «Добавить этап» и «Реестр штрафов», хотя действие даёт 403.
 */
export const MentorRewardsPage: React.FC = () => {
  const { can } = useAuth()
  const canManage = can('mentor_rewards', 'manage')
  return <MentorRewardsManager colorPrefix="ds" canManage={canManage} financesPath="/finances" />
}
