import { useMutation, useQuery } from '@tanstack/react-query'
import { actsApi, type PortalContract } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { ContractStatus, recordNumber } from '@/components/students/contractPresentation'
import { downloadBlob } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errorMessage'

const LABELS: [keyof PortalContract['fields'], string][] = [
  ['contract_date', 'Дата договора'], ['city', 'Город'], ['customer_name', 'Заказчик'],
  ['student_name', 'Абитуриент'], ['executor_name', 'Исполнитель'],
]

/** Договор ученика — только просмотр: реквизиты, услуги, сумма и PDF. */
export function PortalContracts() {
  const list = useQuery({ queryKey: ['portal-contracts'], queryFn: actsApi.portalContracts, retry: false })
  const download = useMutation({ mutationFn: async (c: PortalContract) => downloadBlob(await actsApi.portalContractPdf(c.id), 'Договор.pdf'), retry: false })
  return <section className="mb-6 space-y-3 rounded-card border border-p-line bg-p-panel p-5">
    <h2 className="text-lg font-semibold text-p-text">Мой договор</h2>
    {list.isPending && <p role="status" className="text-sm text-p-muted">Загружаем договор…</p>}
    {(list.error || download.error) && <p role="alert" className="text-sm text-red-700">{getErrorMessage(list.error || download.error, 'Не удалось загрузить договор')}</p>}
    {list.data?.length === 0 && <p className="text-sm text-p-muted">Договор появится здесь, когда команда его привяжет.</p>}
    {list.data?.map(c => <div key={c.id} className="space-y-3 border-t border-p-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Договор {recordNumber(c.fields.contract_number)}</p>
          <ContractStatus status={c.status} source={c.source} />
        </div>
        <AppButton colorPrefix="p" disabled={download.isPending} onClick={() => download.mutate(c)}>Скачать PDF</AppButton>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {LABELS.filter(([k]) => c.fields[k]).map(([k, label]) => <div key={k}><dt className="inline text-p-muted">{label}: </dt><dd className="inline">{c.fields[k]}</dd></div>)}
        {c.amount && <div><dt className="inline text-p-muted">Сумма: </dt><dd className="inline">{Number(c.amount).toLocaleString('ru-RU')} {c.currency === 'KZT' ? '₸' : c.currency}</dd></div>}
      </dl>
      {c.services.length > 0 && <div>
        <p className="text-sm text-p-muted">Услуги по договору</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{c.services.map((s, i) => <li key={i}>{s.name}</li>)}</ul>
      </div>}
    </div>)}
  </section>
}
