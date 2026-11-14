import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import apiClient from '@/api/client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { MENTOR_ROLE_LABELS } from '@/types'
import { getErrorMessage } from '@/lib/errorMessage'

export type TeamCheckState = 'will_add' | 'added' | 'present' | 'removed' | 'unmatched' | 'ambiguous' | 'platform_only'

export interface TeamCheckRow {
  student_id: string
  student_name: string
  intake_year: number | null
  role: string | null
  notion_name: string
  state: TeamCheckState
  user_id: string | null
  user_name: string | null
  detail: string
}

interface TeamCheck {
  enabled: boolean
  min_intake_year?: number
  counts: Partial<Record<TeamCheckState, number>>
  items: TeamCheckRow[]
}

export const TEAM_CHECK_LABELS: Record<TeamCheckState, string> = {
  will_add: 'Добавится',
  added: 'Добавлен из Notion',
  present: 'Уже в команде',
  removed: 'Снят на платформе',
  unmatched: 'Аккаунт не найден',
  ambiguous: 'Роль не определить',
  platform_only: 'Есть только на платформе',
}

const HINTS: Record<TeamCheckState, string> = {
  will_add: 'Есть в Notion, на платформе нет — добавится при синхронизации.',
  added: 'Уже добавлен из Notion автоматически.',
  present: 'Совпадает: и в Notion, и в команде.',
  removed: 'В Notion остался, но на платформе его сняли — не возвращаем.',
  unmatched: 'Имя из Notion не связано с аккаунтом: свяжите в «Имена Notion ↔ сотрудники».',
  ambiguous: 'Аккаунт найден, но роль неясна — назначьте в команде вручную.',
  platform_only: 'В команде на платформе есть, в Notion нет. Ничего не меняем.',
}

const ORDER: TeamCheckState[] = ['will_add', 'unmatched', 'ambiguous', 'removed', 'platform_only', 'added', 'present']

/** Сверка команды ученика с Notion. Только чтение: показывает, что добавится и что спорно. */
export function NotionTeamCheckDialog({ onClose, onOpenPeople }: { onClose: () => void; onOpenPeople?: () => void }) {
  const [state, setState] = useState<TeamCheckState | 'all'>('all')
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['notion', 'assignments-check'],
    queryFn: async () => (await apiClient.get<TeamCheck>('/notion/assignments-check')).data,
  })
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (query.data?.items ?? []).filter((row) => (state === 'all' || row.state === state)
      && (!needle || [row.student_name, row.notion_name, row.user_name].some((v) => (v ?? '').toLowerCase().includes(needle))))
  }, [query.data, state, search])
  const counts = query.data?.counts ?? {}

  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Сверка команды с Notion</DialogTitle>
        <DialogDescription>
          Менторы из Notion (Lead-Mentor, Mentors, МЗК) только добавляются в команду ученика. Кого сняли или поменяли на платформе — не трогаем.
          {query.data?.min_intake_year && <> Наборы раньше {query.data.min_intake_year} не показываются — они уже поступили.</>}
          {query.data && !query.data.enabled && <b className="mt-1 block text-ds-ink">Автодобавление пока выключено — список «Добавится» показывает, что произойдёт после включения.</b>}
        </DialogDescription>
      </DialogHeader>
      {query.isLoading && <p className="text-sm text-ds-muted">Сверяем…</p>}
      {query.isError && <p className="text-sm text-red-600">{getErrorMessage(query.error, 'Не удалось загрузить сверку')}</p>}
      {query.data && <>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setState('all')} className={`rounded-full border px-3 py-1 text-xs font-bold ${state === 'all' ? 'border-ds-accent bg-ds-accent/15' : 'border-ds-line'}`}>Все · {query.data.items.length}</button>
          {ORDER.filter((key) => counts[key]).map((key) => <button key={key} type="button" onClick={() => setState(key)} title={HINTS[key]}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${state === key ? 'border-ds-accent bg-ds-accent/15' : 'border-ds-line'}`}>{TEAM_CHECK_LABELS[key]} · {counts[key]}</button>)}
          <input aria-label="Поиск по сверке" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ученик или сотрудник"
            className="ml-auto min-h-8 rounded-lg border border-ds-line bg-ds-panel px-3 text-sm" />
        </div>
        {state !== 'all' && <p className="text-xs text-ds-muted">{HINTS[state]}{state === 'unmatched' && onOpenPeople && <> <button type="button" className="font-bold underline" onClick={onOpenPeople}>Открыть «Имена Notion ↔ сотрудники»</button></>}</p>}
        <div className="overflow-x-auto rounded-xl border border-ds-line">
          <table className="w-full text-sm">
            <thead className="bg-ds-panel2 text-left text-xs text-ds-muted"><tr>
              <th className="px-3 py-2">Ученик</th><th className="px-3 py-2">Набор</th><th className="px-3 py-2">Роль</th><th className="px-3 py-2">В Notion</th><th className="px-3 py-2">Аккаунт</th><th className="px-3 py-2">Состояние</th>
            </tr></thead>
            <tbody>
              {rows.map((row, i) => <tr key={`${row.student_id}-${row.role}-${row.notion_name}-${row.user_id}-${i}`} className="border-t border-ds-line">
                <td className="px-3 py-2"><Link className="font-bold hover:underline" to={`/students/${row.student_id}`}>{row.student_name}</Link></td>
                <td className="px-3 py-2">{row.intake_year ?? '—'}</td>
                <td className="px-3 py-2">{row.role ? MENTOR_ROLE_LABELS[row.role] ?? row.role : '—'}</td>
                <td className="px-3 py-2">{row.notion_name || <span className="text-ds-muted2">нет</span>}</td>
                <td className="px-3 py-2">{row.user_name || <span className="text-ds-muted2">—</span>}</td>
                <td className="px-3 py-2"><b>{TEAM_CHECK_LABELS[row.state]}</b>{row.detail && row.detail.toLowerCase() !== TEAM_CHECK_LABELS[row.state].toLowerCase() && <span className="block text-xs text-ds-muted">{row.detail}</span>}</td>
              </tr>)}
              {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ds-muted">Ничего не найдено</td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </DialogContent>
  </Dialog>
}
