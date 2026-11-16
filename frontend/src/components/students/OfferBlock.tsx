/**
 * Блок «Оффер» в карточке ученика (15.11.2026). Короткий путь к заявкам:
 * ментор отмечает оффер здесь, а не ищет вуз во вкладке «Вузы и заявки».
 * Хранится всё в заявках — отсюда и оттуда видно одно и то же; финансист
 * получает письмо, МЗК и академ-хед — колокольчик.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { applicationsApi, type StudentOffer } from '@/api'
import { credentialsApi, type PortalCredentialPayload } from '@/api/credentials'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { getErrorCode, getErrorMessage } from '@/lib/errorMessage'
import { invalidateStudent } from '@/lib/queryKeys'
import { formatDate } from '@/lib/utils'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { CredentialFormDialog, applicationTitle } from '@/components/portal/CredentialFormDialog'
import { credentialsQueryKey } from '@/components/portal/PortalCredentialsSection'
import type { Application, SubmissionStatus } from '@/types'

const OFFER_STATUSES: SubmissionStatus[] = ['offer_received', 'enrolled']
const OTHER = '__other__'
const CONTROL = 'h-10 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none focus:border-brand-dim'

export const offersQueryKey = (studentId: string) => ['student-offers', studentId] as const

const money = (value: string | null, currency: string) =>
  value == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value)))} ${currency}`

function where(o: { university: string | null; country: string | null }) {
  return [o.university, o.country].filter(Boolean).join(', ') || 'вуз не указан'
}

export function OfferBlock({ studentId }: { studentId: string }) {
  const { can } = useAuth()
  const canMark = can('applications', 'manage')
  const queryClient = useQueryClient()
  const offers = useQuery({ queryKey: offersQueryKey(studentId), queryFn: () => applicationsApi.offers(studentId) })
  const apps = useQuery({ queryKey: ['applications', studentId], queryFn: () => applicationsApi.listForStudent(studentId), enabled: canMark })
  const [open, setOpen] = useState(false)
  const [credentialsFor, setCredentialsFor] = useState<{ app: Application; status: SubmissionStatus } | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: offersQueryKey(studentId) })
    queryClient.invalidateQueries({ queryKey: ['applications', studentId] })
    invalidateStudent(queryClient, studentId)
  }

  const setStatus = async (app: Application, status: SubmissionStatus) => {
    try {
      await applicationsApi.update(app.id, { submission_status: status })
      refresh()
      setOpen(false)
      toast({ title: status === 'enrolled' ? 'Зачисление отмечено' : 'Оффер отмечен', description: `${applicationTitle(app)}. Финансист получит письмо.` })
    } catch (err) {
      if (getErrorCode(err) === 'PORTAL_CREDENTIALS_REQUIRED') {
        setOpen(false)
        window.setTimeout(() => setCredentialsFor({ app, status }), 250)
        toast({ title: 'Нужен доступ к порталу вуза', description: 'Внесите логин и пароль портала — оффер поставится сам.' })
        return
      }
      toast({ title: 'Не удалось отметить оффер', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  const mark = useMutation({
    mutationFn: async (v: { appId: string; university: string; country: string; status: SubmissionStatus }) => {
      if (v.appId !== OTHER) return { app: (apps.data ?? []).find(a => a.id === v.appId)!, status: v.status }
      // Вуза нет в заявках — заявка создаётся сразу «Подано», оффер ставится следом.
      const app = await applicationsApi.create({ student_id: studentId, university: v.university, country: v.country, submission_status: 'submitted' })
      return { app, status: v.status }
    },
    onSuccess: ({ app, status }) => setStatus(app, status),
    onError: (err) => toast({ title: 'Не удалось добавить вуз', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const credential = useMutation({
    mutationFn: async (values: PortalCredentialPayload) => {
      await credentialsApi.create({ ...values, student_id: studentId })
      return credentialsFor!
    },
    onSuccess: async (pending) => {
      queryClient.invalidateQueries({ queryKey: credentialsQueryKey('staff', studentId) })
      setCredentialsFor(null)
      await setStatus(pending.app, pending.status)
    },
    onError: (err) => toast({ title: 'Не удалось сохранить доступ', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const unmark = useMutation({
    mutationFn: (o: StudentOffer) => applicationsApi.update(o.application_id, { submission_status: 'submitted' }),
    onSuccess: (_, o) => { refresh(); toast({ title: 'Оффер снят', description: `${where(o)}: статус заявки «Подано». Финансист получит письмо об отмене.` }) },
    onError: (err) => toast({ title: 'Не удалось снять оффер', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const data = offers.data
  const items = data?.items ?? []
  const candidates = (apps.data ?? []).filter(a => !OFFER_STATUSES.includes(a.submission_status as SubmissionStatus))

  return <div className="rounded-panel border border-p-line bg-p-bg px-4 py-3">
    <div className="flex items-start justify-between gap-2">
      <p className="student-detail-summary-label text-2xs uppercase tracking-[0.18em] text-p-muted2">Оффер</p>
      {canMark && <button type="button" onClick={() => setOpen(true)} className="rounded-ctl bg-p-accent px-2.5 py-1 text-2xs font-bold text-black">
        {items.length ? '+ Ещё оффер' : 'Отметить оффер'}
      </button>}
    </div>
    {offers.isPending && <p className="mt-1 text-sm text-p-muted">Загрузка…</p>}
    {offers.isError && <p className="mt-1 text-sm text-p-muted">Не удалось загрузить офферы</p>}
    {data && !items.length && <p className="mt-1 text-sm font-semibold text-p-text">Оффера пока нет</p>}
    {data && !items.length && <p className="text-2xs text-p-muted">Получили оффер — отметьте здесь в тот же день: финансист узнает об остатке.</p>}
    {items.length > 0 && <ul className="mt-1 space-y-1.5">
      {items.map(o => <li key={o.application_id} className="text-sm">
        <span className="font-semibold text-emerald-700 dark:text-emerald-300">{o.status === 'enrolled' ? 'Зачислен' : 'Оффер'}: </span>
        <span className="font-semibold text-p-text">{where(o)}</span>
        <span className="block text-2xs text-p-muted">
          {o.marked_at ? formatDate(o.marked_at) : 'дата не записана'}{o.marked_by ? ` · ${o.marked_by}` : ''}
          {canMark && <button type="button" className="ml-2 underline hover:text-p-text" disabled={unmark.isPending}
            onClick={() => { if (window.confirm(`Снять оффер «${where(o)}»? Финансист получит письмо об отмене.`)) unmark.mutate(o) }}>Снять</button>}
        </span>
      </li>)}
    </ul>}
    {items.length > 0 && data?.remaining != null && Number(data.remaining) > 0 && <p className="mt-2 text-2xs text-p-muted">
      Остаток {money(data.remaining, data.currency)}{data.due_date ? ` к оплате до ${formatDate(data.due_date)}` : ''}
    </p>}

    <MarkDialog open={open} onOpenChange={setOpen} candidates={candidates} isPending={mark.isPending}
      onSubmit={v => mark.mutate(v)} />
    <CredentialFormDialog open={credentialsFor !== null} onOpenChange={o => { if (!o) setCredentialsFor(null) }}
      presetApplication={credentialsFor?.app ?? null} applications={apps.data ?? []}
      onSubmit={v => credential.mutate(v)} isPending={credential.isPending} />
  </div>
}

function MarkDialog({ open, onOpenChange, candidates, isPending, onSubmit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidates: Application[]
  isPending: boolean
  onSubmit: (v: { appId: string; university: string; country: string; status: SubmissionStatus }) => void
}) {
  const [appId, setAppId] = useState('')
  const [university, setUniversity] = useState('')
  const [country, setCountry] = useState('')
  const [status, setStatus] = useState<SubmissionStatus>('offer_received')
  const chosen = appId || (candidates[0]?.id ?? OTHER)
  const ready = chosen !== OTHER || university.trim().length > 1
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader><DialogTitle>Отметить оффер</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (ready) onSubmit({ appId: chosen, university: university.trim(), country: country.trim(), status }) }}>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-p-muted">Вуз</span>
          <select aria-label="Вуз" className={CONTROL} value={chosen} onChange={e => setAppId(e.target.value)}>
            {candidates.map(a => <option key={a.id} value={a.id}>{applicationTitle(a)}{a.country && a.university ? `, ${a.country}` : ''}</option>)}
            <option value={OTHER}>Другой вуз (нет в заявках)</option>
          </select>
        </label>
        {chosen === OTHER && <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-semibold text-p-muted">Название вуза</span>
            <input aria-label="Название вуза" className={CONTROL} value={university} onChange={e => setUniversity(e.target.value)} placeholder="TU Munich" /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-p-muted">Страна</span>
            <input aria-label="Страна" className={CONTROL} value={country} onChange={e => setCountry(e.target.value)} placeholder="Германия" /></label>
        </div>}
        <fieldset className="flex gap-4 text-sm">
          {(['offer_received', 'enrolled'] as const).map(s => <label key={s} className="flex items-center gap-2">
            <input type="radio" name="offer-status" checked={status === s} onChange={() => setStatus(s)} />{s === 'enrolled' ? 'Зачислен' : 'Оффер'}
          </label>)}
        </fieldset>
        <p className="text-xs text-p-muted">Если доступа к порталу вуза ещё нет, платформа попросит логин и пароль — так проверяем, что оффер настоящий.</p>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="h-10 rounded-ctl border border-p-line px-4 text-sm font-bold text-p-muted hover:text-p-text">Отмена</button>
          <button type="submit" disabled={!ready || isPending} className="h-10 rounded-ctl bg-p-accent px-4 text-sm font-black text-black disabled:opacity-50">{isPending ? 'Сохранение…' : 'Отметить'}</button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
