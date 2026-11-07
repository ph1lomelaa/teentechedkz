import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, financeKeys } from '@/api/finance'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { FinAlert, FinButton } from './ui'
import { plural } from './format'

/** Notion balances are planned debt, never a record of money received. */
export function NotionScheduleNotice({ count, canManage }: { count: number; canManage: boolean }) {
  const client = useQueryClient()
  const transfer = useMutation({
    mutationFn: financeApi.notionImport,
    onSuccess: res => {
      client.invalidateQueries({ queryKey: financeKeys.all })
      toast({ title: `Создан график: ${plural(res.created, ['договор', 'договора', 'договоров'])}` })
    },
    onError: err => toast({ title: 'Не перенесено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  if (!count) return null
  return <FinAlert action={canManage && <FinButton size="sm" variant="primary" disabled={transfer.isPending} onClick={() => transfer.mutate()}>
    {transfer.isPending ? 'Создаём график…' : 'Создать ожидаемые платежи из Notion'}
  </FinButton>}>
    <p className="font-semibold">График ещё не заполнен по {plural(count, ['договору', 'договорам', 'договорам'])}</p>
    <p className="mt-1">В Notion есть остатки к оплате и даты. В списках «Сегодня» и «Платежи» эти суммы пока не видны: они показывают оплаты по графику.</p>
    <p className="mt-1">Перенос создаст по одному ожидаемому платежу на сумму остатка и дату из Notion. Он не отметит оплату полученной. Договоры с готовым графиком не изменятся. Суммы и даты можно поправить в договоре.</p>
    <Link to="/finance/contracts?schedule=none" className="mt-2 inline-block font-semibold underline">Проверить договоры без графика</Link>
  </FinAlert>
}
