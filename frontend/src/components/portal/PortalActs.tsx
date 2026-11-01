import { useMutation, useQuery } from '@tanstack/react-query'
import { ACT_TEMPLATES, actsApi, type ActRecord } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { downloadBlob } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errorMessage'

export function PortalActs() {
  const list = useQuery({ queryKey: ['portal-acts'], queryFn: actsApi.portalList, retry: false })
  const download = useMutation({ mutationFn: async (act: ActRecord) => downloadBlob(await actsApi.portalPdf(act.id), act.file_name || 'Акт.pdf'), retry: false })
  return <section className="mb-6 space-y-3 rounded-card border border-p-line bg-p-panel p-5">
    <h2 className="text-lg font-semibold text-p-text">Акты оказанных услуг</h2>
    {list.isPending && <p role="status" className="text-sm text-p-muted">Загружаем акты…</p>}
    {(list.error || download.error) && <p role="alert" className="text-sm text-red-700">{getErrorMessage(list.error || download.error, 'Не удалось загрузить акты')}</p>}
    {list.data?.length === 0 && <p className="text-sm text-p-muted">Здесь появятся готовые акты, которые вам предоставит команда.</p>}
    {list.data?.map(act => <div key={act.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-p-line pt-3"><div><p className="text-sm font-medium">{act.file_name || ACT_TEMPLATES[act.template]}</p><p className="mt-1 text-xs text-p-muted">{act.act_date}</p></div><AppButton colorPrefix="p" disabled={download.isPending} onClick={() => download.mutate(act)}>Скачать PDF</AppButton></div>)}
  </section>
}
