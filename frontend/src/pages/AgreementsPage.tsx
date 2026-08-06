import React from 'react'
import { AgreementsManager } from '@/components/admin/AgreementsManager'

/** CRM-версия раздела регламентов. Логика общая с воркспейсом, отличаются только токены. */
export const AgreementsPage: React.FC = () => <AgreementsManager colorPrefix="ds" />
