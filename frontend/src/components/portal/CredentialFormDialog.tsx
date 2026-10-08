import React, { useEffect, useState } from 'react'
import { PortalCredential, PortalCredentialPayload } from '@/api/credentials'
import { Application } from '@/types'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'

/** Название подачи для подписи: сохранённый текст → справочник → страна. */
export function applicationTitle(app: Application): string {
  return app.university || app.university_ref?.name || app.country
}

interface FormValues {
  application_id: string
  portal_name: string
  portal_url: string
  login: string
  password: string
  notes: string
}

function toFormValues(initial: PortalCredential | null, presetApp: Application | null): FormValues {
  return {
    application_id: initial?.application_id ?? presetApp?.id ?? '',
    portal_name: initial?.portal_name ?? (presetApp ? applicationTitle(presetApp) : ''),
    portal_url: initial?.portal_url ?? '',
    login: initial?.login ?? '',
    password: '',
    notes: initial?.notes ?? '',
  }
}

/** Добавление и правка доступа к порталу вуза.
 *
 * Формат задан регламентом admission: ссылка для входа, логин, пароль.
 * Пароль при правке не показываем и не требуем: пустое поле — оставить прежний.
 */
export const CredentialFormDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: PortalCredential | null
  /** Подача, для которой открыли форму (например, после отказа сменить статус). */
  presetApplication?: Application | null
  applications: Application[]
  onSubmit: (values: PortalCredentialPayload) => void
  isPending?: boolean
}> = ({ open, onOpenChange, initial = null, presetApplication = null, applications, onSubmit, isPending = false }) => {
  const [values, setValues] = useState<FormValues>(() => toFormValues(initial, presetApplication))

  useEffect(() => {
    if (open) setValues(toFormValues(initial, presetApplication))
  }, [open, initial, presetApplication])

  const set = (patch: Partial<FormValues>) => setValues((v) => ({ ...v, ...patch }))

  const canSubmit =
    values.portal_name.trim().length > 0 &&
    values.login.trim().length > 0 &&
    (Boolean(initial) || values.password.length > 0) &&
    !isPending

  const submit = () => {
    const payload: PortalCredentialPayload = {
      application_id: values.application_id || null,
      portal_name: values.portal_name.trim(),
      portal_url: values.portal_url.trim(),
      login: values.login.trim(),
      notes: values.notes,
    }
    if (values.password) payload.password = values.password
    onSubmit(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Изменить доступ к порталу' : 'Доступ к порталу вуза'}</DialogTitle>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) submit()
          }}
        >
          <Field label="Заявка" hint="Без доступа оффер по ней не отметить">
            <select
              value={values.application_id}
              onChange={(e) => {
                const app = applications.find((a) => a.id === e.target.value)
                set({
                  application_id: e.target.value,
                  // Название подставляем, только пока его не вписали руками.
                  ...(app && !values.portal_name.trim() ? { portal_name: applicationTitle(app) } : {}),
                })
              }}
              className={CONTROL}
            >
              <option value="">Не привязан к заявке</option>
              {applications.map((a) => (
                <option key={a.id} value={a.id}>{applicationTitle(a)}</option>
              ))}
            </select>
          </Field>

          <Field label="Портал">
            <input
              autoFocus
              value={values.portal_name}
              onChange={(e) => set({ portal_name: e.target.value })}
              placeholder="Например, TU Munich — TUMonline"
              className={CONTROL}
            />
          </Field>

          <Field label="Ссылка для входа">
            <input
              type="url"
              value={values.portal_url}
              onChange={(e) => set({ portal_url: e.target.value })}
              placeholder="https://…"
              className={CONTROL}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Логин">
              <input
                value={values.login}
                onChange={(e) => set({ login: e.target.value })}
                autoComplete="off"
                className={CONTROL}
              />
            </Field>
            <Field label="Пароль" hint={initial ? 'Пусто — оставить прежний' : undefined}>
              <input
                type="password"
                value={values.password}
                onChange={(e) => set({ password: e.target.value })}
                autoComplete="new-password"
                className={CONTROL}
              />
            </Field>
          </div>

          <Field label="Заметка">
            <input
              value={values.notes}
              onChange={(e) => set({ notes: e.target.value })}
              className={CONTROL}
            />
          </Field>

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
