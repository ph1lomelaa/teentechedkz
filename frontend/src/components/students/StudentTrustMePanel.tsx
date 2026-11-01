import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trustmeApi, type TrustMeCandidate } from '@/api/trustme'
import { AppButton } from '@/components/ui'
import { getErrorCode, getErrorMessage } from '@/lib/errorMessage'

const statusName = (status: number) => ({ 0: 'Создан', 3: 'Подписан', 4: 'Отозван компанией' }[status] ?? `Статус ${status}`)

function CandidateDetails({ item }: { item: TrustMeCandidate }) {
  return <>
    <p className="font-semibold break-words">{item.name}</p>
    <p className="mt-1 text-xs text-p-muted">№ записи TrustMe: {item.number || '—'} · {statusName(item.status)} · {item.created_at ? item.created_at.slice(0, 10) : 'Дата не указана'}</p>
    <ul className="mt-2 text-sm text-p-muted">
      {item.signers.map((person, i) => <li key={i}>{person.is_company ? 'Компания' : 'Подписант'}: {person.name || 'Имя не указано'} · {person.signed ? 'подписал' : 'не подписал'}</li>)}
    </ul>
  </>
}

export function StudentTrustMePanel({ studentId, studentName, canManage, onChanged }: {
  studentId: string; studentName: string; canManage: boolean; onChanged?: () => void
}) {
  const cache = useQueryClient()
  const key = ['trustme-links', studentId]
  const [query, setQuery] = useState(studentName)
  const [aliases, setAliases] = useState('')
  const [selected, setSelected] = useState<TrustMeCandidate | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [unlinkId, setUnlinkId] = useState<string | null>(null)
  const links = useQuery({ queryKey: key, queryFn: () => trustmeApi.list(studentId), retry: false })
  const search = useMutation({
    mutationFn: () => trustmeApi.search(studentId, query.trim(), aliases.split('\n').map(x => x.trim()).filter(Boolean)),
    onMutate: () => { setSelected(null); setConfirmed(false) },
    retry: false,
  })
  const link = useMutation({
    mutationFn: (shortUrl: string) => trustmeApi.link(studentId, shortUrl),
    onSuccess: () => { cache.invalidateQueries({ queryKey: key }); cache.invalidateQueries({ queryKey: ['acts', studentId] }); cache.invalidateQueries({ queryKey: ['acts-registry'] }); setSelected(null); setConfirmed(false); onChanged?.() },
    retry: false,
  })
  const unlink = useMutation({
    mutationFn: (id: string) => trustmeApi.unlink(studentId, id),
    onSuccess: () => { cache.invalidateQueries({ queryKey: key }); cache.invalidateQueries({ queryKey: ['acts', studentId] }); cache.invalidateQueries({ queryKey: ['acts-registry'] }); setUnlinkId(null); onChanged?.() },
    retry: false,
  })
  const download = useMutation({
    mutationFn: async (shortUrl: string) => {
      const blob = await trustmeApi.pdf(studentId, shortUrl)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `TrustMe-${shortUrl}.pdf`
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    retry: false,
  })
  const error = search.error || link.error || download.error || unlink.error || links.error
  const challenge = error && getErrorCode(error) === 'TRUSTME_CHALLENGE_REQUIRED'
  const linkedUrls = new Set(links.data?.map(item => item.short_url))
  const busy = link.isPending || unlink.isPending || search.isPending

  return <div className="space-y-4 text-p-text">
    <p className="text-sm text-p-muted">Привяжите проверенный договор, чтобы сохранить его в карточке студента. ФИО в TrustMe может отличаться от имени на платформе.</p>
    {error && <div role="alert" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p>{getErrorMessage(error, 'Не удалось выполнить запрос TrustMe')}</p>
      {challenge && <div className="mt-2 space-y-2">
        <a className="font-semibold underline" href="https://trustme.kz/app/sign-in" target="_blank" rel="noopener noreferrer">Открыть кабинет TrustMe</a>
        <p>Пройдите проверку самостоятельно. Проверка в браузере может не восстановить доступ сервера. Если ошибка повторяется, обратитесь к администратору; договор можно добавить вручную в раздел «Документы».</p>
      </div>}
    </div>}
    <div className="space-y-2">
      <h4 className="font-semibold">Привязанные договоры</h4>
      {links.isPending && <p role="status" className="text-sm text-p-muted">Загружаем договоры…</p>}
      {!links.isPending && !links.error && links.data?.length === 0 && <p className="text-sm text-p-muted">Договоры TrustMe ещё не привязаны.</p>}
      {links.data?.map(item => <div key={item.id} className="rounded-card border border-p-line p-3">
        <CandidateDetails item={item} />
        <p className="mt-1 text-xs text-p-muted">Статус зафиксирован при привязке. Перед формированием акта договор нужно проверить повторно.</p>
        {canManage && <div className="mt-3 flex flex-wrap gap-2">
          <AppButton colorPrefix="p" disabled={download.isPending || !item.short_url} onClick={() => item.short_url && download.mutate(item.short_url)}>Скачать PDF</AppButton>
          {unlinkId === item.id ? <>
            <span className="self-center text-sm">Убрать привязку из карточки?</span>
            <AppButton colorPrefix="p" disabled={busy} onClick={() => unlink.mutate(item.id)}>Убрать</AppButton>
            <AppButton colorPrefix="p" disabled={busy} onClick={() => setUnlinkId(null)}>Отмена</AppButton>
          </> : <AppButton colorPrefix="p" disabled={busy} onClick={() => setUnlinkId(item.id)}>Убрать привязку</AppButton>}
        </div>}
      </div>)}
    </div>
    {canManage && <form onSubmit={e => { e.preventDefault(); if (!busy) search.mutate() }} className="space-y-3 border-t border-p-line pt-4">
      <label className="block text-sm font-medium">Имя для поиска
        <input aria-label="Имя для поиска в TrustMe" value={query} maxLength={500} onChange={e => setQuery(e.target.value)} className="mt-1 w-full rounded-ctl border border-p-line bg-p-panel px-3 py-2" />
      </label>
      <label className="block text-sm font-medium">Другие написания или ФИО родителя
        <textarea aria-label="Другие написания имени" value={aliases} onChange={e => setAliases(e.target.value)} placeholder="По одному варианту в строке, до 6 вариантов" rows={2} className="mt-1 w-full rounded-ctl border border-p-line bg-p-panel px-3 py-2" />
      </label>
      <AppButton colorPrefix="p" type="submit" disabled={busy || !query.trim()}>{search.isPending ? 'Ищем договоры…' : 'Найти в TrustMe'}</AppButton>
    </form>}
    {search.data && !search.isPending && <div className="space-y-3">
      <p className="text-xs text-p-muted">Проверены варианты: {search.data.queries.join('; ')}</p>
      {search.data.truncated && <p role="status" className="text-sm text-amber-800">Получена часть результатов. Уточните имя или добавьте другое написание.</p>}
      {search.data.candidates.length === 0 && <p className="text-sm">Совпадений нет. Попробуйте отдельную часть имени, другое написание или ФИО родителя.</p>}
      {search.data.candidates.map((item, index) => <div key={item.external_id || index} className="rounded-card border border-p-line p-3">
        <CandidateDetails item={item} />
        <div className="mt-3 flex flex-wrap gap-2">
          <AppButton colorPrefix="p" disabled={download.isPending || !item.short_url} onClick={() => item.short_url && download.mutate(item.short_url)}>Проверить PDF</AppButton>
          <AppButton colorPrefix="p" disabled={busy || !item.short_url || item.status !== 3 || linkedUrls.has(item.short_url)} onClick={() => { setSelected(item); setConfirmed(false); link.reset() }}>{linkedUrls.has(item.short_url) ? 'Уже привязан' : 'Выбрать договор'}</AppButton>
        </div>
      </div>)}
    </div>}
    {selected && <div className="space-y-3 rounded-card border border-p-line bg-p-bg p-4">
      <h4 className="font-semibold">Проверьте договор перед привязкой</h4>
      <CandidateDetails item={selected} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />Я проверил(а), что договор относится к студенту «{studentName}», включая случай подписания родителем.</label>
      <div className="flex gap-2"><AppButton colorPrefix="p" disabled={!confirmed || busy || !selected.short_url} onClick={() => selected.short_url && link.mutate(selected.short_url)}>{link.isPending ? 'Привязываем…' : 'Подтвердить привязку'}</AppButton><AppButton colorPrefix="p" disabled={busy} onClick={() => setSelected(null)}>Отмена</AppButton></div>
    </div>}
  </div>
}
