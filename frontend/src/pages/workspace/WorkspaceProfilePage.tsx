import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { authApi } from '@/api/auth'
import { useAuth } from '@/contexts/AuthContext'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { Button } from '@/components/ui/primitives/button'
import { getErrorMessage } from '@/lib/errorMessage'
import { toast } from '@/hooks/use-toast'

/**
 * Свой аккаунт: чем в него можно войти.
 *
 * Зачем страница
 * --------------
 * Почты в системе нет — ни SMTP, ни сервиса, — поэтому обычного «забыли
 * пароль?» со ссылкой на почту здесь быть не может. Роль самообслуживания
 * играет Google: привязав его один раз, ментор входит кнопкой и больше не
 * зависит ни от того, помнит ли он пароль, ни от того, свободен ли админ.
 *
 * До этого экрана у ментора не было вообще никакого места, где видно, какими
 * способами он может войти, — и забытый пароль означал поход к администратору.
 */
export const WorkspaceProfilePage: React.FC = () => {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: emails, isLoading } = useQuery({
    queryKey: ['my-emails'],
    queryFn: authApi.myEmails,
  })

  const linkMutation = useMutation({
    mutationFn: (credential: string) => authApi.linkGoogle(credential),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-emails'] })
      toast({ title: 'Google привязан — теперь можно входить кнопкой' })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось привязать Google',
        description: getErrorMessage(err, 'Попробуйте ещё раз'),
        variant: 'destructive',
      })
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: (id: string) => authApi.unlinkEmail(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-emails'] })
      toast({ title: 'Адрес отвязан' })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось отвязать адрес',
        description: getErrorMessage(err, 'Попробуйте ещё раз'),
        variant: 'destructive',
      })
    },
  })

  const extras = emails?.extras ?? []
  const canLinkMore = extras.length < (emails?.max_extras ?? 1)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
      <header>
        <h1 className="text-xl font-black text-w-ink">Профиль и вход</h1>
        <p className="mt-1 text-sm text-w-muted">
          Здесь видно, какими способами вы можете войти в систему.
        </p>
      </header>

      <section className="rounded-panel border border-w-line bg-w-panel p-4">
        <h2 className="text-sm font-bold text-w-ink">Аккаунт</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-w-muted">Имя</dt>
            <dd className="text-w-ink">{user?.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-w-muted">Основная почта</dt>
            <dd className="break-all text-w-ink">{emails?.primary ?? user?.email}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-panel border border-w-line bg-w-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-w-ink">
          <ShieldCheck className="h-4 w-4" />
          Вход через Google
        </h2>
        <p className="mt-1 text-sm text-w-muted">
          Привяжите Google, чтобы входить одной кнопкой. Это и есть восстановление
          доступа: даже забыв пароль, вы войдёте сами, без обращения к куратору.
        </p>

        {isLoading ? (
          <p className="mt-3 text-sm text-w-muted">Загружаем…</p>
        ) : extras.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {extras.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-panel border border-w-line bg-w-panel2 px-3 py-2"
              >
                <span className="break-all text-sm text-w-ink">{entry.email}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unlinkMutation.isPending}
                  onClick={() => unlinkMutation.mutate(entry.id)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Отвязать
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {canLinkMore ? (
          <div className="mt-3">
            {/* Разделитель «или» здесь ни к чему: рядом нет второго способа —
                это привязка, а не выбор между входом паролем и Google. */}
            <GoogleSignInButton
              divider={false}
              text="continue_with"
              onCredential={(credential) => linkMutation.mutate(credential)}
              onError={(message) =>
                toast({ title: 'Google недоступен', description: message, variant: 'destructive' })
              }
            />
            <p className="mt-2 text-xs text-w-muted">
              Выберите тот Google-аккаунт, которым вам удобно пользоваться постоянно.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-w-muted">
            Привязан один дополнительный адрес — больше добавить нельзя. Чтобы заменить,
            сначала отвяжите текущий.
          </p>
        )}
      </section>

      <section className="rounded-panel border border-w-line bg-w-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-w-ink">
          <KeyRound className="h-4 w-4" />
          Пароль
        </h2>
        <p className="mt-1 text-sm text-w-muted">
          Если вы входите паролем, его можно сменить в любой момент. Забыли пароль и
          Google не привязан — попросите куратора выдать временный.
        </p>
        <Link
          to="/change-password"
          className="mt-3 inline-flex items-center rounded-ctl border border-w-line px-3 py-2 text-sm font-semibold text-w-ink transition hover:border-w-accentDim"
        >
          Сменить пароль
        </Link>
      </section>
    </div>
  )
}
