import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { authApi, type MyEmails } from '@/api/auth'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { AppButton } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

const COLORS = {
  p: { card: 'border-p-line bg-p-panel text-p-text', muted: 'text-p-muted', row: 'border-p-line bg-p-bg', error: 'text-p-danger-text', good: 'text-p-good-text' },
  w: { card: 'border-w-line bg-w-panel text-w-ink', muted: 'text-w-muted', row: 'border-w-line bg-w-panel2', error: 'text-w-danger', good: 'text-w-good' },
}

/** The same Google confirmation and recovery controls for students and staff. */
export const AccountAccessCard: React.FC<{ colorPrefix?: 'p' | 'w'; className?: string }> = ({ colorPrefix = 'p', className }) => {
  const colors = COLORS[colorPrefix]
  const client = useQueryClient()
  const [googleError, setGoogleError] = useState('')
  const emails = useQuery({ queryKey: ['my-emails'], queryFn: authApi.myEmails })
  const recovery = useQuery({ queryKey: ['password-reset-config'], queryFn: authApi.passwordResetConfig })
  const updateEmails = (data: MyEmails) => {
    setGoogleError('')
    client.setQueryData(['my-emails'], data)
    void client.invalidateQueries({ queryKey: ['users'] })
  }
  const link = useMutation({ mutationFn: (credential: string) => authApi.linkGoogle(credential), onSuccess: updateEmails })
  const unlink = useMutation({ mutationFn: (id: string) => authApi.unlinkEmail(id), onSuccess: updateEmails })
  const reset = useMutation({ mutationFn: () => authApi.requestPasswordReset(emails.data!.primary) })
  const busy = link.isPending || unlink.isPending

  return (
    <section className={cn('rounded-panel border p-4', colors.card, className)} aria-label="Вход и восстановление доступа">
      <h2 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4" /> Вход через Google</h2>
      <p className={cn('mt-2 text-sm', colors.muted)}>
        Подтвердите свой Google-аккаунт, чтобы входить одной кнопкой, даже если забыли пароль.
      </p>
      {emails.isError ? (
        <div className="mt-3" role="alert">
          <p className={cn('text-sm', colors.error)}>{getErrorMessage(emails.error, 'Не удалось загрузить адреса входа')}</p>
          <AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" onClick={() => void emails.refetch()}>Повторить</AppButton>
        </div>
      ) : emails.isPending ? <p className={cn('mt-3 text-sm', colors.muted)}>Загружаем адреса…</p> : (
        <>
          <p className={cn('mt-3 text-sm font-semibold', emails.data.google_account?.linked ? colors.good : colors.muted)} role="status">
            {emails.data.google_account?.linked
              ? `Google подтверждён: ${emails.data.google_account.emails.join(', ')}`
              : 'Google ещё не подтверждён — нажмите кнопку ниже.'}
          </p>
          <p className={cn('mt-2 break-all text-xs', colors.muted)}>Основная почта: {emails.data.primary}</p>
          {(emails.data.extras ?? []).map((entry) => (
            <div key={entry.id} className={cn('mt-2 flex items-center justify-between gap-3 rounded-ctl border px-3 py-2', colors.row)}>
              <span className="break-all text-sm">{entry.email}</span>
              <AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" disabled={busy} onClick={() => unlink.mutate(entry.id)} aria-label={`Отвязать ${entry.email}`}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Отвязать
              </AppButton>
            </div>
          ))}
          <div className={cn('mt-3', busy && 'pointer-events-none opacity-50')} aria-busy={busy}>
            <GoogleSignInButton themed colorPrefix={colorPrefix} divider={false} text="continue_with"
              onCredential={(credential) => { if (!busy) { setGoogleError(''); link.mutate(credential) } }} onError={setGoogleError} />
          </div>
          {busy && <p className={cn('mt-2 text-xs', colors.muted)}>Сохраняем…</p>}
          {emails.data.extras.length >= emails.data.max_extras && (
            <p className={cn('mt-2 text-xs', colors.muted)}>Можно подтвердить основную или уже добавленную почту. Чтобы добавить другой адрес, сначала отвяжите дополнительный.</p>
          )}
        </>
      )}
      {(googleError || link.isError || unlink.isError) && <p role="alert" className={cn('mt-3 text-sm', colors.error)}>
        {googleError || getErrorMessage(link.error || unlink.error, 'Не удалось сохранить привязку Google')}
      </p>}

      <div className={cn('mt-5 border-t pt-4', colorPrefix === 'p' ? 'border-p-line' : 'border-w-line')}>
        <h3 className="text-sm font-bold">Восстановление пароля</h3>
        <p className={cn('mt-2 text-sm', colors.muted)}>Ссылка придёт на основную почту и подтверждённый дополнительный адрес.</p>
        {recovery.isPending ? <p className={cn('mt-2 text-xs', colors.muted)}>Проверяем отправку писем…</p>
          : recovery.isError ? <div className="mt-2" role="alert"><p className={cn('text-sm', colors.error)}>Не удалось проверить отправку писем.</p><AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" onClick={() => void recovery.refetch()}>Проверить снова</AppButton></div>
            : recovery.data.enabled ? <AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" className="mt-3" disabled={!emails.data || reset.isPending || reset.isSuccess} onClick={() => reset.mutate()}>
              {reset.isPending ? 'Отправляем…' : reset.isSuccess ? 'Ссылка запрошена' : 'Прислать ссылку для нового пароля'}
            </AppButton>
              : <p className={cn('mt-2 text-xs', colors.muted)}>Отправка писем пока не настроена. Войдите через подтверждённый Google или попросите куратора выдать ссылку для входа.</p>}
        {reset.isSuccess && <p role="status" className={cn('mt-2 text-sm', colors.good)}>Если аккаунт активен, письмо отправлено. Проверьте «Входящие» и «Спам».</p>}
        {reset.isError && <p role="alert" className={cn('mt-2 text-sm', colors.error)}>{getErrorMessage(reset.error, 'Не удалось запросить ссылку')}</p>}
      </div>
    </section>
  )
}
