import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { notionApi } from '@/api/notion'
import { DEGREE_LEVEL_LABELS, PIPELINE_STATUS_LABELS } from '@/types'

// Флаг по названию страны (данные в базе преимущественно на русском,
// встречаются английские и составные значения — берём первый сегмент).
const COUNTRY_FLAGS: Record<string, string> = {
  'италия': '🇮🇹', 'italy': '🇮🇹',
  'корея': '🇰🇷', 'южная корея': '🇰🇷', 'korea': '🇰🇷', 'south korea': '🇰🇷',
  'китай': '🇨🇳', 'china': '🇨🇳',
  'гонконг': '🇭🇰', 'hong kong': '🇭🇰',
  'сша': '🇺🇸', 'usa': '🇺🇸', 'америка': '🇺🇸',
  'германия': '🇩🇪', 'germany': '🇩🇪',
  'венгрия': '🇭🇺', 'hungary': '🇭🇺',
  'малайзия': '🇲🇾', 'malaysia': '🇲🇾',
  'великобритания': '🇬🇧', 'англия': '🇬🇧', 'uk': '🇬🇧',
  'катар': '🇶🇦', 'qatar': '🇶🇦',
  'оаэ': '🇦🇪', 'uae': '🇦🇪', 'эмираты': '🇦🇪',
  'япония': '🇯🇵', 'japan': '🇯🇵',
  'канада': '🇨🇦', 'canada': '🇨🇦',
  'австрия': '🇦🇹', 'austria': '🇦🇹',
  'сингапур': '🇸🇬', 'singapore': '🇸🇬',
  'польша': '🇵🇱', 'poland': '🇵🇱',
  'чехия': '🇨🇿', 'czech': '🇨🇿',
  'нидерланды': '🇳🇱', 'голландия': '🇳🇱', 'netherlands': '🇳🇱',
  'франция': '🇫🇷', 'france': '🇫🇷',
  'испания': '🇪🇸', 'spain': '🇪🇸',
  'турция': '🇹🇷', 'turkey': '🇹🇷',
  'финляндия': '🇫🇮', 'finland': '🇫🇮',
}

export function countryFlag(country?: string | null): string {
  if (!country) return ''
  const first = country.split(/[,/]/)[0].trim().toLowerCase()
  return COUNTRY_FLAGS[first] ?? ''
}

const Property = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div className="grid grid-cols-[minmax(105px,.8fr)_1.2fr] gap-3 border-b border-p-line/70 py-2 last:border-0"><span className="text-xs text-p-muted">{label}</span><span className="text-right text-sm font-semibold text-p-text break-words">{value || '—'}</span></div>
)

/**
 * Правая панель быстрого просмотра студента.
 *
 * Общая для CRM-доски и Notion-вида Обзора: из обоих мест клик по ученику
 * открывает одно и то же окно с переходом в полный профиль, а не страницу
 * Notion — Notion здесь только справочная секция.
 */
export function StudentPeekPanel({ studentId, fallbackName, onClose }: {
  studentId: string
  fallbackName?: string
  onClose: () => void
}) {
  const { data: full, isLoading } = useQuery({ queryKey: ['student', studentId, 'peek'], queryFn: () => studentsApi.get(studentId) })
  const { data: notion, isLoading: notionLoading } = useQuery({ queryKey: ['notion', 'student', studentId], queryFn: () => notionApi.studentNotion(studentId) })
  const contract = full?.contracts?.[0]
  const notionRows = notion?.comparison ?? []
  const mentors = (full?.mentor_assignments ?? [])
    .filter((assignment) => assignment.is_active !== false)
    .map((assignment) => assignment.mentor_name || assignment.role)
  return (
    <>
      <button type="button" aria-label="Закрыть быстрый просмотр" onClick={onClose} className="fixed inset-0 z-40 bg-black/35" />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-p-line bg-p-bg shadow-2xl" aria-label="Быстрый просмотр студента">
        <header className="flex items-start justify-between gap-3 border-b border-p-line px-5 py-5"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-p-muted2">Быстрый просмотр</p><h2 className="mt-2 font-display text-xl font-black text-p-text">{full?.full_name ?? fallbackName ?? 'Студент'}</h2>{full && <p className="mt-1 text-xs text-p-muted">{DEGREE_LEVEL_LABELS[full.degree_level]} · {full.intake_year || 'Год не указан'}</p>}</div><button type="button" onClick={onClose} className="text-2xl text-p-muted" aria-label="Закрыть">×</button></header>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {isLoading && <p className="text-sm text-p-muted">Загрузка полного профиля…</p>}
          <section className="rounded-panel border border-p-line bg-p-panel p-4"><h3 className="text-xs font-black uppercase tracking-wider text-p-muted2">Работа команды</h3><Property label="Ответственные" value={mentors.join(', ') || 'Не назначены'} /><Property label="МЗК" value={full?.mzk_manager_name} /><Property label="Roadmap" value={full?.roadmap?.name ? `${full.roadmap.name} · ${full.roadmap.progress ?? 0}%` : 'Не назначен'} /><Property label="Конспекты" value={full?.notes?.length ?? 0} /><Property label="Личный кабинет" value={full ? (full.user_id ? 'Доступ открыт' : 'Доступ не открыт') : undefined} /></section>
          <section className="rounded-panel border border-p-line bg-p-panel p-4"><h3 className="text-xs font-black uppercase tracking-wider text-p-muted2">Основные данные</h3><Property label="Этап" value={full ? PIPELINE_STATUS_LABELS[full.pipeline_status ?? 'no_status'] : undefined} /><Property label="Страна" value={full?.country ? `${countryFlag(full.country)} ${full.country}` : undefined} /><Property label="Город" value={full?.city} /><Property label="Телефон" value={full?.phone} /><Property label="Специальность" value={full?.specialty} /><Property label="GPA" value={full?.gpa} /></section>
          <section className="rounded-panel border border-p-line bg-p-panel p-4"><h3 className="text-xs font-black uppercase tracking-wider text-p-muted2">Услуги и документы</h3><Property label="Услуги" value={full?.services?.length ?? 0} /><Property label="Документы" value={full?.documents?.length ?? 0} /><Property label="Заявки" value={full?.applications?.length ?? 0} /><Property label="Платежей" value={contract?.payments?.length ?? 0} /></section>
          <section className="rounded-panel border border-p-line bg-p-panel p-4"><h3 className="text-xs font-black uppercase tracking-wider text-p-muted2">Договор и финансы</h3><Property label="Дата договора" value={contract?.signed_date} /><Property label="Client fee" value={contract?.amount ? `${contract.amount} ${contract.currency}` : undefined} /><Property label="Остаток клиента" value={contract?.client_remaining_amount ? `${contract.client_remaining_amount} ${contract.currency}` : undefined} /><Property label="Сумма англ." value={contract?.english_sum} /><Property label="Ментору итого" value={contract?.mentor_total_owed} /></section>
          <section className="rounded-panel border border-p-line bg-p-panel p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-black uppercase tracking-wider text-p-muted2">Notion</h3>{notion?.snapshot?.notion_url && <a href={notion.snapshot.notion_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-p-muted hover:underline">Страница в Notion ↗</a>}</div>{notionLoading ? <p className="mt-3 text-sm text-p-muted">Загрузка данных…</p> : notion?.snapshot ? <><div className="mt-2 space-y-1 text-xs text-p-muted"><p>Синхронизировано: {notion.snapshot.synced_at ? new Date(notion.snapshot.synced_at).toLocaleString('ru-RU') : '—'}</p><p>Изменено в Notion: {notion.snapshot.notion_last_edited_at ? new Date(notion.snapshot.notion_last_edited_at).toLocaleDateString('ru-RU') : '—'}</p></div><div className="mt-3 rounded-panel border border-p-line bg-p-bg px-3">{notionRows.map((row) => <Property key={row.field} label={row.label} value={row.notion ?? '—'} />)}</div></> : <p className="mt-3 text-sm text-p-muted">Студент не привязан к записи Notion</p>}</section>
        </div>
        <footer className="border-t border-p-line p-5"><Link to={`/students/${studentId}`} onClick={onClose} className="flex h-11 w-full items-center justify-center rounded-ctl bg-brand text-sm font-black text-black">Открыть полный профиль</Link></footer>
      </aside>
    </>
  )
}
