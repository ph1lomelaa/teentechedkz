import React, { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { countriesApi } from '@/api'
import { universitiesApi } from '@/api/universities'
import { Application, SUBMISSION_STATUS_LABELS, SubmissionStatus } from '@/types'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'

export interface ApplicationFormValues {
  country: string
  university_id: string | null
  university: string | null
  program: string | null
  deadline: string | null
  submission_status: SubmissionStatus
  scholarship_target: boolean
  is_primary: boolean
}

/** Создание и правка заявки на поступление.
 *
 * Вуз выбирается из справочника, но не обязателен: свободный текст остаётся
 * ведущим — вуза может ещё не быть в каталоге, и заставлять ментора ждать
 * импорта нельзя (та же логика, что в модели на бэкенде).
 */
export const ApplicationFormDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Заявка для редактирования; без неё диалог создаёт новую. */
  initial?: Application | null
  onSubmit: (values: ApplicationFormValues) => void
  isPending?: boolean
}> = ({ open, onOpenChange, initial = null, onSubmit, isPending = false }) => {
  const [values, setValues] = useState<ApplicationFormValues>(() => toFormValues(initial))

  // Диалог переиспользуется для разных заявок, поэтому состояние сбрасываем
  // на каждое открытие — иначе в форме остаются поля предыдущей.
  useEffect(() => {
    if (open) setValues(toFormValues(initial))
  }, [open, initial])

  const { data: countries = [] } = useQuery({
    queryKey: ['countries'],
    queryFn: countriesApi.list,
    enabled: open,
  })
  const { data: catalog = [] } = useQuery({
    queryKey: ['universities'],
    queryFn: universitiesApi.list,
    enabled: open,
  })

  // Вузы сужаем до выбранной страны: полный список в 200+ строк в select'е
  // неудобен, а заявка всегда привязана к стране.
  const universitiesForCountry = useMemo(
    () =>
      catalog
        .filter((u) => !values.country || u.country_name === values.country)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [catalog, values.country]
  )

  // Ориентир, пока своя дата не проставлена. Берём из страны: у вуза дедлайн
  // есть только в детальном ответе, а тянуть его сюда ради подсказки — лишний
  // запрос (список вузов намеренно оставлен «лёгким», без deadline_note).
  const referenceDeadline =
    countries.find((c) => c.country_name === values.country)?.submission_deadline_notes || null

  const canSubmit = values.country.trim().length > 0 && !isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Изменить заявку' : 'Новая заявка в вуз'}</DialogTitle>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) onSubmit(values)
          }}
        >
          <Field label="Страна">
            <select
              autoFocus
              value={values.country}
              onChange={(e) =>
                // Вуз из прежней страны после смены становится бессмысленным.
                setValues((v) => ({ ...v, country: e.target.value, university_id: null }))
              }
              className={CONTROL}
            >
              <option value="">Выберите страну</option>
              {countries.map((c) => (
                <option key={c.id} value={c.country_name}>
                  {c.flag_emoji ? `${c.flag_emoji} ` : ''}{c.country_name}
                </option>
              ))}
            </select>
          </Field>

          {/* Пустой список — норма: часть стран в справочнике ещё без вузов.
              Пишем это прямо, иначе «Не выбран» без вариантов читается как
              поломка, а не как «здесь пока пусто, впишите текстом». */}
          <Field
            label="Вуз из справочника"
            hint={
              !values.country
                ? 'Сначала выберите страну'
                : universitiesForCountry.length === 0
                  ? 'Для этой страны вузов пока нет'
                  : `Найдено: ${universitiesForCountry.length}`
            }
          >
            <select
              value={values.university_id ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, university_id: e.target.value || null }))}
              className={CONTROL}
              disabled={!values.country || universitiesForCountry.length === 0}
            >
              <option value="">
                {universitiesForCountry.length === 0 ? 'Нет вузов в справочнике' : 'Не выбран'}
              </option>
              {universitiesForCountry.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>

          {!values.university_id && (
            <Field
              label="Вуз текстом"
              hint={
                values.country && universitiesForCountry.length === 0
                  ? 'Впишите название вручную'
                  : 'Если его ещё нет в справочнике'
              }
            >
              <input
                value={values.university ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, university: e.target.value || null }))}
                placeholder="Например, Bogaziçi Üniversitesi"
                className={CONTROL}
              />
            </Field>
          )}

          <Field label="Программа" hint="Необязательно">
            <input
              value={values.program ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, program: e.target.value || null }))}
              placeholder="Computer Science"
              className={CONTROL}
            />
          </Field>

          <Field
            label="Дедлайн подачи"
            hint={referenceDeadline ? `Справочно: ${referenceDeadline}` : 'Необязательно'}
          >
            <input
              type="date"
              value={values.deadline ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, deadline: e.target.value || null }))}
              className={CONTROL}
            />
          </Field>

          <Field label="Статус">
            <select
              value={values.submission_status}
              onChange={(e) =>
                setValues((v) => ({ ...v, submission_status: e.target.value as SubmissionStatus }))
              }
              className={CONTROL}
            >
              {Object.entries(SUBMISSION_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>

          <label className="flex items-center gap-2 text-sm text-p-text">
            <input
              type="checkbox"
              checked={values.scholarship_target}
              onChange={(e) => setValues((v) => ({ ...v, scholarship_target: e.target.checked }))}
              className="h-4 w-4 accent-p-accent"
            />
            Цель — грант
          </label>

          <label className="flex items-center gap-2 text-sm text-p-text">
            <input
              type="checkbox"
              checked={values.is_primary}
              onChange={(e) => setValues((v) => ({ ...v, is_primary: e.target.checked }))}
              className="h-4 w-4 accent-p-accent"
            />
            Основная заявка
          </label>

          <DialogFooter className="mt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-ctl border border-p-line px-4 text-sm font-bold text-p-muted transition-colors hover:text-p-text"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-10 rounded-ctl bg-p-accent px-4 text-sm font-black text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Сохранение…' : initial ? 'Сохранить' : 'Добавить'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const CONTROL =
  'h-10 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none transition-colors focus:border-brand-dim disabled:opacity-50'

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <label className="block">
    <span className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-p-muted2">{label}</span>
      {hint && <span className="text-[11px] text-p-muted2">{hint}</span>}
    </span>
    {children}
  </label>
)

function toFormValues(app: Application | null): ApplicationFormValues {
  return {
    country: app?.country ?? '',
    university_id: app?.university_id ?? null,
    university: app?.university ?? null,
    program: app?.program ?? null,
    deadline: app?.deadline ?? null,
    submission_status: app?.submission_status ?? 'not_started',
    scholarship_target: app?.scholarship_target ?? false,
    is_primary: app?.is_primary ?? false,
  }
}
