import React from 'react'
import { CountriesCatalog } from '@/components/shared/CountriesCatalog'
import { useAuth } from '@/contexts/AuthContext'

/** Справочник стран в CRM.
 *
 * Раньше здесь была отдельная простая таблица — третья реализация одного и
 * того же экрана. Теперь тот же каталог, что в воркспейсе и портале.
 */
export const CountriesPage: React.FC = () => {
  const { hasRole } = useAuth()
  return (
    <CountriesCatalog
      eyebrow="Справочник"
      basePath="/countries"
      canManage={hasRole('admin', 'mzk_manager')}
    />
  )
}
