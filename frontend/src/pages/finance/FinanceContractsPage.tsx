import { FinPageHeader } from '@/components/finance/ui'
import { ContractsTable } from '@/components/finance/ContractsTable'

/** «Договоры» финансиста: таблица в стиле «Договоров и актов» — фильтры, группы, поля. */
export function FinanceContractsPage() {
  return (
    <div>
      <FinPageHeader
        title="Договоры"
        description="Сумма договора, оплаты, следующий платёж и сам договор. Имя — карточка договора, номер — сам договор (PDF)."
      />
      <ContractsTable />
    </div>
  )
}
