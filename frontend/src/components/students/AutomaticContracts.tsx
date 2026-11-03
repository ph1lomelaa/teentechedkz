import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { trustmeApi, type TrustMeCandidate } from '@/api/trustme'
import { AppButton } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { documentLink, neutralDisabled, recordNumber } from './contractPresentation'

export function AutomaticContracts({ studentId, onChanged, linkedShortUrls = [] }: { studentId: string; onChanged: () => void; linkedShortUrls?: string[] }) {
  const changed = useRef(onChanged)
  changed.current = onChanged
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const discovery = useQuery({ queryKey: ['contract-discovery', studentId], queryFn: () => trustmeApi.autoLink(studentId), staleTime: 3600000,
    retry: false, refetchOnWindowFocus: false, refetchInterval: query => query.state.data?.state === 'pending' ? 2000 : false })
  useEffect(() => { if (discovery.data?.linked_ids.length) changed.current() }, [discovery.data])
  const confirm = useMutation({ mutationFn: async (candidate: TrustMeCandidate) => {
    const link = await trustmeApi.link(studentId, candidate.short_url!)
    changed.current()
    // Реквизиты дочитываются фоном: скан с OCR занимает до минуты, привязка уже сделана.
    void Promise.resolve().then(() => trustmeApi.inspect(studentId, link.id)).catch(() => undefined).finally(() => changed.current())
    return candidate.short_url
  }, retry: false })
  const pdf = useMutation({ mutationFn: async (candidate: TrustMeCandidate) => { const blob = await trustmeApi.pdf(studentId, candidate.short_url!); setPreview(URL.createObjectURL(blob)) }, retry: false })
  const [confirmed, setConfirmed] = useState<string[]>([])
  useEffect(() => { if (confirm.data) setConfirmed(old => [...old, confirm.data!]) }, [confirm.data])
  const review = discovery.data?.review.filter(c => !confirmed.includes(c.short_url || '') && !linkedShortUrls.includes(c.short_url || '')) || []
  return <section aria-label="Автоматический подбор договоров" className="space-y-3 text-sm">
    {(discovery.isPending || discovery.data?.state === 'pending') && <p role="status" className="text-p-muted">Находим и проверяем договоры студента…</p>}
    {(discovery.error || discovery.data?.state === 'unavailable') && <p className="text-p-muted">Автопоиск временно недоступен. Уже привязанные договоры сохранены. <button className={documentLink} onClick={() => discovery.refetch()}>Повторить</button></p>}
    {!!discovery.data?.linked_ids.length && <p className="font-medium text-emerald-700">Договоры привязаны автоматически · {discovery.data.linked_ids.length}</p>}
    {discovery.data?.state === 'complete' && !discovery.data.linked_ids.length && !review.length && !linkedShortUrls.length && <p className="text-sm text-p-muted">В TrustMe не нашли договор с этим студентом по ФИО и телефону. Найдите его по номеру или ссылке либо загрузите PDF — «Добавить вручную».</p>}
    {!!review.length && <div className="divide-y divide-p-line"><p className="pb-2 font-medium">Нужно подтвердить · {review.length}</p>{review.map(candidate => <div key={candidate.short_url} className="space-y-2 py-3"><p className="break-words font-medium">{candidate.name} · {recordNumber(candidate.number)}</p><p className="text-xs text-p-muted">{candidate.blocked ? candidate.reason : `${candidate.reason}. Подтвердите, что услуги по договору предназначены этому студенту.`}</p><div className="flex flex-wrap items-center gap-4"><button className={documentLink} disabled={pdf.isPending} onClick={() => pdf.mutate(candidate)}>Открыть PDF</button>{!candidate.blocked && <AppButton colorPrefix="p" variant="subtle" size="sm" className={neutralDisabled} disabled={confirm.isPending} onClick={() => confirm.mutate(candidate)}>{confirm.isPending && confirm.variables?.short_url === candidate.short_url ? 'Привязываем…' : 'Подтвердить и привязать'}</AppButton>}</div>{confirm.error && confirm.variables?.short_url === candidate.short_url && <p role="alert" className="text-sm text-red-700">{getErrorMessage(confirm.error)}</p>}</div>)}</div>}
    {discovery.data?.partial && <p className="text-xs text-p-muted">Проверена часть результатов TrustMe. Остальные договоры могут потребовать дополнительной проверки.</p>}
    {pdf.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(pdf.error)}</p>}
    {preview && <div><button className={documentLink} onClick={() => setPreview(null)}>Закрыть PDF</button><iframe title="Проверка договора" src={preview} className="h-[65dvh] w-full border border-p-line" /></div>}
  </section>
}
