import { FinPageHeader } from '@/components/finance/ui'
import { ContractsTable } from '@/components/finance/ContractsTable'

/** «Договоры» финансиста: таблица в стиле «Договоров и актов» — фильтры, группы, поля. */
export function FinanceContractsPage() {
  return (
    <div>
      <FinPageHeader
        title="Договоры"
        description="Сумма договора, оплаты, следующий платёж и сам договор. Нажмите на имя — откроется карточка договора."
      />
      <ContractsTable />
    </div>
  )
}
