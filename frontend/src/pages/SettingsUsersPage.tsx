import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, UserX, UserCheck, LogOut, Users, Clock, Download, Link2, Trash2 } from 'lucide-react'
import { usersApi } from '@/api/index'
import { User, UserRole, ROLE_LABELS, ASSIGNABLE_MENTOR_ROLES, MENTOR_ROLE_LABELS } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Label } from '@/components/ui/primitives/label'
import { Checkbox } from '@/components/ui/primitives/checkbox'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import { toast } from '@/hooks/use-toast'
import { PageHeader, StatCard } from '@/components/ui'

const ROLE_FILTER_OPTIONS: Array<UserRole | 'all'> = ['all', 'student', 'mentor', 'mzk_manager', 'admin']
const ROLE_FILTER_LABELS: Record<UserRole | 'all', string> = {
  all: 'Все роли',
  ...ROLE_LABELS,
}
/**
 * «Активные» стоят первыми и включены по умолчанию: список сотрудников — это
 * рабочий справочник, а деактивированные и не завершившие регистрацию аккаунты
 * копятся годами и оттесняют действующих людей вниз. Неактивные никуда не
 * делись — они за отдельным пунктом фильтра и в карточке «Ожидают активации».
 */
const STATUS_FILTER_OPTIONS = ['active', 'inactive', 'all'] as const
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  active: 'Активные',
  inactive: 'Неактивные',
  all: 'Любой статус',
}

interface UserForm {
  name: string
  email: string
  role: UserRole
  phone: string
  telegram_username: string
  mentor_specialties: string[]
}

const STAFF_ROLE_OPTIONS: Array<Exclude<UserRole, 'student'>> = ['admin', 'mzk_manager', 'mentor']

/**
 * Специализации, которые проставляют сотруднику руками — весь список
 * назначаемых ролей, включая 'mzk'.
 *
 * Раньше 'mzk' отсюда выбрасывали, считая, что эту роль ведёт только менеджер
 * МЗК по учётной роли. На практике человек может работать МЗК с учётной ролью
 * «Ментор» — и тогда он не попадал в список «Назначить: МЗК» вообще, потому что
 * список фильтровался по учётной роли. Теперь список кандидатов собирает бэкенд
 * по специализации, и отметить её здесь — единственный способ это сказать.
 */
const MENTOR_SPECIALTY_OPTIONS = ASSIGNABLE_MENTOR_ROLES

/** Бейджи специализаций в строке таблицы и в карточке. */
function SpecialtyBadges({ values }: { values?: string[] }) {
  if (!values?.length) return <span className="text-xs text-p-muted2">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span
          key={value}
          className="text-[11px] px-2 py-0.5 bg-p-bg text-p-text border border-p-line rounded-pill"
        >
          {MENTOR_ROLE_LABELS[value] ?? value}
        </span>
      ))}
    </div>
  )
}
const USER_ROLE_ORDER: Record<UserRole, number> = {
  student: 0,
  mentor: 1,
  mzk_manager: 2,
  admin: 3,
}

function AgreementStatusBadge({ status }: { status?: User['agreement_status'] }) {
  const value = status?.status ?? 'not_applicable'
  if (value === 'not_applicable') {
    return <span className="text-xs text-p-muted2">—</span>
  }
  if (value === 'signed') {
    const date = status?.signed_at ? new Date(status.signed_at).toLocaleDateString('ru-RU') : null
    return (
      <span className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-pill font-medium uppercase tracking-wide">
        подписан{date ? ` ${date}` : ''}
      </span>
    )
  }
  return (
    <span className="text-[11px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-pill font-medium uppercase tracking-wide">
      ожидает
    </span>
  )
}

function UserModal({
  user,
  open,
  onClose,
}: {
  user?: User
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const isEdit = !!user
  const isSelf = isEdit && user?.id === currentUser?.id
  const [form, setForm] = useState<UserForm>({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? 'mentor',
    phone: user?.phone ?? '',
    telegram_username: user?.telegram_username ?? '',
    mentor_specialties: user?.mentor_specialties ?? [],
  })
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copiedPassword, setCopiedPassword] = useState(false)

  const resetMutation = useMutation({
    mutationFn: () => usersApi.resetPassword(user!.id),
    onSuccess: (res) => {
      setTempPassword(res.temp_password)
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось сбросить пароль',
        description: getErrorMessage(err, 'Попробуйте ещё раз'),
        variant: 'destructive',
      })
    },
  })

  const mutation = useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (isEdit && user) {
        const payload: Partial<User> = {
          name: form.name,
          email: form.email,
          role: form.role,
          phone: form.phone || undefined,
          telegram_username: form.telegram_username || undefined,
          mentor_specialties: form.mentor_specialties,
        }
        await usersApi.update(user.id, payload)
        return null
      }
      // Новый сотрудник: пароль задаёт сам по ссылке-приглашению (п.7).
      const created = await usersApi.createInvite({
        name: form.name,
        email: form.email,
        role: form.role,
        phone: form.phone || undefined,
        mentor_specialties: form.mentor_specialties,
      })
      return created.invite_url
    },
    onSuccess: (link) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (isEdit) {
        toast({ title: 'Пользователь обновлён' })
        onClose()
      } else {
        setInviteLink(link)
        toast({ title: 'Пользователь создан — отправьте ссылку для входа' })
      }
    },
    onError: (err) => {
      toast({ title: 'Ошибка', description: getErrorMessage(err, 'Не удалось сохранить пользователя'), variant: 'destructive' })
    },
  })

  const copyLink = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Не удалось скопировать ссылку', variant: 'destructive' })
    }
  }

  const copyPassword = async () => {
    if (!tempPassword) return
    try {
      await navigator.clipboard.writeText(tempPassword)
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    } catch {
      toast({ title: 'Не удалось скопировать пароль', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Редактировать пользователя' : inviteLink ? 'Ссылка для входа' : 'Новый пользователь'}
          </DialogTitle>
          {!isEdit && !inviteLink && (
            <DialogDescription>
              Пароль сотрудник задаёт сам по ссылке-приглашению — как ученик. Назначенная роль сохранится.
            </DialogDescription>
          )}
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-sm text-p-muted">
              Отправьте эту одноразовую ссылку сотруднику. По ней он задаст пароль и войдёт в систему. Ссылка действует 72 часа.
            </p>
            <div className="rounded-panel border border-p-line bg-p-bg p-3 text-sm break-all">
              {inviteLink}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={copyLink}>{copied ? 'Скопировано' : 'Скопировать ссылку'}</Button>
              <Button onClick={onClose}>Готово</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <Label>Имя</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Иванов Иван"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <Label>Роль</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as UserRole })}
                  disabled={isSelf}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAFF_ROLE_OPTIONS.map((val) => (
                      <SelectItem key={val} value={val}>{ROLE_LABELS[val]}</SelectItem>
                    ))}
                    {isEdit && user?.role === 'student' && (
                      <SelectItem value="student">{ROLE_LABELS.student}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {isSelf && (
                  <p className="text-xs text-p-muted mt-1">Нельзя изменить собственную роль — попросите другого администратора.</p>
                )}
              </div>
              {/* Специализация у любого сотрудника, а не только у ментора:
                  именно она говорит, кем человек работает, и именно по ней
                  собирается список «кого назначить». Ученику она не нужна —
                  он в назначениях не участвует. Список множественный: один
                  сотрудник реально ведёт и IELTS, и страну. */}
              {form.role !== 'student' && (
                <div>
                  <Label>Специализация</Label>
                  <div className="mt-1 space-y-2 rounded-panel border border-p-line p-3">
                    {MENTOR_SPECIALTY_OPTIONS.map((specialty) => {
                      const checked = form.mentor_specialties.includes(specialty)
                      return (
                        <label
                          key={specialty}
                          className="flex cursor-pointer items-center gap-2 text-sm text-p-text"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              setForm({
                                ...form,
                                mentor_specialties: value
                                  ? [...form.mentor_specialties, specialty]
                                  : form.mentor_specialties.filter((item) => item !== specialty),
                              })
                            }
                          />
                          {MENTOR_ROLE_LABELS[specialty]}
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-p-muted mt-1">
                    Определяет, в каком списке «кого назначить» сотрудник появится и в какой роли
                    встанет к студенту, когда возьмёт его в работу. На права доступа не влияет.
                  </p>
                </div>
              )}
              <div>
                <Label>Телефон</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+7 777 000 00 00"
                />
              </div>
              {isEdit && (
                <>
                  <div>
                    <Label>Telegram</Label>
                    <Input
                      value={form.telegram_username}
                      onChange={(e) => setForm({ ...form, telegram_username: e.target.value })}
                      placeholder="@username"
                    />
                  </div>
                  {/* Доступ отделён от полей профиля: это не «ещё одно поле»,
                      а действие, которое обрывает чужие сессии. Раньше здесь
                      админ вписывал пароль руками — он получался слабым,
                      повторялся между сотрудниками и навсегда оставался
                      известен админу. Теперь пароль генерируется, живёт до
                      первого входа и обязателен к смене. */}
                  <div className="rounded-panel border border-p-line p-3 space-y-2">
                    <Label>Доступ</Label>
                    {tempPassword ? (
                      <>
                        <p className="text-xs text-p-muted">
                          Передайте пароль лично. Он показан один раз — после закрытия окна
                          его нельзя посмотреть снова, только сбросить заново.
                        </p>
                        <div className="rounded-panel border border-p-line bg-p-bg p-3 font-mono text-sm break-all">
                          {tempPassword}
                        </div>
                        <Button variant="outline" size="sm" onClick={copyPassword}>
                          {copiedPassword ? 'Скопировано' : 'Скопировать пароль'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-p-muted">
                          {isSelf
                            ? 'Свой пароль меняется через «Сменить пароль» — там нужно знать текущий.'
                            : 'Сотрудник войдёт временным паролем и сразу задаст свой. Все его открытые сессии закроются.'}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSelf || resetMutation.isPending}
                          onClick={() => resetMutation.mutate()}
                        >
                          {resetMutation.isPending ? 'Сбрасываем…' : 'Сбросить пароль'}
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Отмена</Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={!form.name || !form.email || mutation.isPending}
              >
                {mutation.isPending ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать и получить ссылку'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Персональная ссылка входа для уже заведённого сотрудника.
 *
 * Зачем отдельной кнопкой
 * -----------------------
 * Ручка `/users/{id}/login-link` есть с самого начала, а кнопки не было:
 * единственным способом дать ссылку действующему ментору оставалась выгрузка
 * xlsx на всю роль. Дальше её переносили в общую таблицу руками — и строки
 * разъезжались, человек видел в своей графе чужой инвайт. Инвайт — это право
 * задать пароль, то есть чужая строка была чужим аккаунтом. Здесь ссылка
 * выдаётся по одному человеку и показывается рядом с его именем: переносить
 * нечего и перепутать нечего.
 */
function LoginLinkDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [issued, setIssued] = useState<{
    invite_url: string
    invite_code: string
    invite_expires_at: string
  } | null>(null)
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)

  const mutation = useMutation({
    mutationFn: () => usersApi.createLoginLink(user.id),
    onSuccess: (res) => setIssued(res),
    onError: (err) => {
      toast({
        title: 'Не удалось выдать ссылку',
        description: getErrorMessage(err, 'Попробуйте ещё раз'),
        variant: 'destructive',
      })
    },
  })

  const copy = async (value: string, what: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' })
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{issued ? 'Ссылка для входа' : 'Выдать ссылку для входа?'}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm">
              {/* Имя и почта видны и до выдачи, и рядом с готовой ссылкой:
                  сверить адресата глазами дешевле, чем разбирать потом, кто
                  кому задал пароль. */}
              <p>
                <span className="font-medium text-p-text">{user.name}</span> — {user.email}
              </p>
              {!issued && (
                <>
                  <p>Пароль он задаст сам, перейдя по ссылке. Ссылка действует 72 часа.</p>
                  <p className="text-amber-700">
                    Ранее выданная ссылка этого человека перестанет работать — у каждого живёт
                    только одна.
                  </p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <div className="rounded-panel border border-p-line bg-p-bg p-3 text-sm break-all">
              {issued.invite_url}
            </div>
            <p className="text-sm text-p-muted">
              Код для ручного ввода:{' '}
              <span className="font-mono font-medium text-p-text">{issued.invite_code}</span>
            </p>
            <p className="text-xs text-p-muted2">
              Отправьте ссылку лично — в общей таблице или чате по ней войдёт кто угодно.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => copy(issued.invite_code, 'code')}>
                {copied === 'code' ? 'Скопирован' : 'Скопировать код'}
              </Button>
              <Button variant="outline" onClick={() => copy(issued.invite_url, 'link')}>
                {copied === 'link' ? 'Скопировано' : 'Скопировать ссылку'}
              </Button>
              <Button onClick={onClose}>Готово</Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Выдаём...' : 'Выдать ссылку'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export const SettingsUsersPage: React.FC = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user: currentUser, logout, can } = useAuth()
  const [editUser, setEditUser] = useState<User | undefined>()
  const [addOpen, setAddOpen] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [linkTarget, setLinkTarget] = useState<User | null>(null)
  const [linksExportOpen, setLinksExportOpen] = useState(false)
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const { data: users = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => usersApi.list(),
  })

  const roleCounts = useMemo(() => {
    const counts: Record<UserRole, number> = { admin: 0, mzk_manager: 0, mentor: 0, student: 0 }
    users.forEach((u) => { counts[u.role] += 1 })
    return counts
  }, [users])
  const pendingCount = useMemo(() => users.filter((u) => !u.is_active).length, [users])

  const filteredUsers = useMemo(() => {
    return users
      .filter((user) => {
        if (roleFilter !== 'all' && user.role !== roleFilter) return false
        if (statusFilter === 'active' && !user.is_active) return false
        if (statusFilter === 'inactive' && user.is_active) return false
        return true
      })
      .sort((first, second) => {
        const roleOrder = USER_ROLE_ORDER[first.role] - USER_ROLE_ORDER[second.role]
        return roleOrder || first.name.localeCompare(second.name, 'ru')
      })
  }, [users, roleFilter, statusFilter])

  const toggleActiveMutation = useMutation({
    mutationFn: (user: User) =>
      usersApi.update(user.id, { is_active: !user.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeactivateTarget(null)
      toast({ title: 'Статус обновлён' })
    },
    onError: () => {
      toast({ title: 'Ошибка', variant: 'destructive' })
    },
  })

  // Что держит аккаунт — спрашиваем при открытии диалога, чтобы кнопка
  // «Удалить» была недоступна до подтверждения, а не отвечала отказом после.
  const deletionCheck = useQuery({
    queryKey: ['users', 'deletion-check', deleteTarget?.id],
    queryFn: () => usersApi.deletionCheck(deleteTarget!.id),
    enabled: Boolean(deleteTarget),
  })

  const deleteMutation = useMutation({
    mutationFn: (user: User) => usersApi.remove(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeleteTarget(null)
      toast({ title: 'Пользователь удалён' })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось удалить',
        description: getErrorMessage(err, 'Попробуйте ещё раз'),
        variant: 'destructive',
      })
    },
  })

  const exportLinksMutation = useMutation({
    mutationFn: () => usersApi.exportLoginLinks({ role: 'mentor' }),
    onSuccess: ({ issued, skipped }) => {
      setLinksExportOpen(false)
      toast({
        title: `Файл готов: ссылок ${issued}`,
        description: skipped
          ? `Пропущено ${skipped} — причины на листе «Пропущены».`
          : 'Ссылки действуют 14 дней.',
      })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось выгрузить ссылки',
        description: getErrorMessage(err),
        variant: 'destructive',
      })
    },
  })

  const activeMentorCount = useMemo(
    () => users.filter((u) => u.role === 'mentor' && u.is_active).length,
    [users],
  )

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div>
      <PageHeader
        eyebrow="Управление"
        title="Настройки"
        description="Аккаунт и пользователи"
        action={(
        <div className="flex flex-wrap gap-2">
          {can('users', 'manage') && (
            <Button variant="outline" onClick={() => setLinksExportOpen(true)}>
              <Download className="w-4 h-4 mr-2" />
              Ссылки на вход
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить
          </Button>
        </div>
        )}
      />

      {currentUser && (
        <div className="mb-8 border border-p-line rounded-card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="label-caps mb-2">Текущий аккаунт</p>
              <h2 className="text-lg font-semibold text-p-text">{currentUser.name}</h2>
              <p className="text-sm text-p-muted mt-1">{currentUser.email}</p>
              <span className="inline-flex mt-3 text-[11px] px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-pill font-medium uppercase tracking-wide">
                {ROLE_LABELS[currentUser.role]}
              </span>
            </div>
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Выйти из системы
            </Button>
          </div>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          colorPrefix="p"
          icon={<Users className="h-4 w-4" />}
          label="Всего"
          value={String(users.length)}
          onClick={() => { setRoleFilter('all'); setStatusFilter('all') }}
        />
        <StatCard
          colorPrefix="p"
          label={ROLE_LABELS.student}
          value={String(roleCounts.student)}
          onClick={() => setRoleFilter('student')}
        />
        <StatCard
          colorPrefix="p"
          label={ROLE_LABELS.mentor}
          value={String(roleCounts.mentor)}
          onClick={() => setRoleFilter('mentor')}
        />
        <StatCard
          colorPrefix="p"
          label={ROLE_LABELS.mzk_manager}
          value={String(roleCounts.mzk_manager)}
          onClick={() => setRoleFilter('mzk_manager')}
        />
        <StatCard
          colorPrefix="p"
          icon={<Clock className="h-4 w-4" />}
          label="Ожидают активации"
          value={String(pendingCount)}
          valueClassName={pendingCount > 0 ? 'text-amber-500' : undefined}
          sub={pendingCount > 0 ? 'новые заявки' : undefined}
          warn={pendingCount > 0}
          onClick={() => { setRoleFilter('all'); setStatusFilter('inactive') }}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="label-caps">Пользователи · {filteredUsers.length}</p>
          {/* Про спрятанных говорим вслух: список по умолчанию показывает не
              всех, и без этой строки неактивные выглядели бы как пропавшие. */}
          {statusFilter === 'active' && pendingCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('inactive')}
              className="text-xs text-p-muted underline underline-offset-4 hover:text-black"
            >
              скрыто неактивных: {pendingCount}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['student', 'mentor', 'mzk_manager'] as const).map((role) => (
            <Button
              key={role}
              variant={roleFilter === role ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRoleFilter(role)}
            >
              {ROLE_LABELS[role]}
            </Button>
          ))}
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | 'all')}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_FILTER_OPTIONS.map((val) => (
                <SelectItem key={val} value={val}>{ROLE_FILTER_LABELS[val]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((val) => (
                <SelectItem key={val} value={val}>{STATUS_FILTER_LABELS[val]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Специализация</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Регламент</TableHead>
              <TableHead>Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              /* Строкой, а не карточкой: карточка внутри tbody сломала бы таблицу. */
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center" role="alert">
                  <p className="text-sm font-bold text-p-text">Не удалось загрузить</p>
                  <p className="mt-1 text-sm text-p-muted">
                    {getErrorMessage(error, 'Данные не пришли. Проверьте связь и повторите.')}
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                    Повторить
                  </Button>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-p-muted">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-p-muted">
                  Нет пользователей по выбранным фильтрам
                  {statusFilter === 'active' && pendingCount > 0 && (
                    <>
                      {' — '}
                      <button
                        type="button"
                        onClick={() => setStatusFilter('inactive')}
                        className="underline underline-offset-4 hover:text-black"
                      >
                        посмотреть неактивных ({pendingCount})
                      </button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id} className="border-p-line hover:bg-p-bg">
                  <TableCell className="font-medium text-p-text">{user.name}</TableCell>
                  <TableCell className="text-p-muted">{user.email}</TableCell>
                  <TableCell>
                    <span className="text-[11px] px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-pill font-medium uppercase tracking-wide">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {user.role === 'mentor'
                      ? <SpecialtyBadges values={user.mentor_specialties} />
                      : <span className="text-xs text-p-muted2">—</span>}
                  </TableCell>
                  <TableCell className="text-p-muted text-sm">
                    {user.telegram_username ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-2 py-0.5 rounded-pill font-medium uppercase tracking-wide ${user.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                      {user.is_active ? 'Активен' : 'Неактивен'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <AgreementStatusBadge status={user.agreement_status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {can('users', 'manage') && user.role !== 'student' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLinkTarget(user)}
                          disabled={!user.is_active}
                          title={
                            user.is_active
                              ? 'Ссылка для входа'
                              : 'Сначала активируйте аккаунт — ссылка не заменяет одобрение заявки'
                          }
                        >
                          <Link2 className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditUser(user)}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => user.is_active ? setDeactivateTarget(user) : toggleActiveMutation.mutate(user)}
                        disabled={toggleActiveMutation.isPending || (user.is_active && user.id === currentUser?.id)}
                        title={
                          user.is_active && user.id === currentUser?.id
                            ? 'Нельзя деактивировать самого себя'
                            : user.is_active ? 'Деактивировать' : 'Активировать'
                        }
                      >
                        {user.is_active ? (
                          <UserX className="w-3 h-3 text-red-600" />
                        ) : (
                          <UserCheck className="w-3 h-3 text-emerald-700" />
                        )}
                      </Button>
                      {/* Удаление — только у уже деактивированного аккаунта.
                          Оно необратимо, и второй осознанный шаг тут дешевле
                          любого диалога: сначала человек теряет доступ, и уже
                          потом решается, нужен ли аккаунт вообще. */}
                      {!user.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(user)}
                          title="Удалить аккаунт насовсем"
                        >
                          <Trash2 className="w-3 h-3 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {addOpen && (
        <UserModal open={addOpen} onClose={() => setAddOpen(false)} />
      )}
      {editUser && (
        <UserModal
          user={editUser}
          open={!!editUser}
          onClose={() => setEditUser(undefined)}
        />
      )}
      {linkTarget && (
        <LoginLinkDialog user={linkTarget} onClose={() => setLinkTarget(null)} />
      )}

      {/* Подтверждение обязательно: выгрузка не читает данные, а выдаёт новые
          ссылки и тем самым гасит выданные раньше. Нажавший вслепую ломает
          доступ тем, кто ещё не успел перейти по старой ссылке. */}
      <Dialog open={linksExportOpen} onOpenChange={setLinksExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Выгрузить ссылки на вход?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  В файл попадут активные менторы — сейчас их {activeMentorCount}. У каждого будет
                  персональная ссылка: он перейдёт по ней и задаст пароль сам.
                </p>
                <p>Ссылки действуют 14 дней.</p>
                <p className="text-amber-700">
                  Ранее выданные ссылки этих людей перестанут работать — у каждого живёт только
                  одна.
                </p>
                <p className="text-p-muted">
                  Неактивные аккаунты пропускаются: ссылка не заменяет одобрение заявки. В файле
                  они останутся строкой с пустой ссылкой и причиной в примечании.
                </p>
                <p className="text-p-muted">
                  Одному человеку ссылку удобнее выдать кнопкой в его строке — не придётся
                  переносить её из файла.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinksExportOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => exportLinksMutation.mutate()}
              disabled={exportLinksMutation.isPending}
            >
              {exportLinksMutation.isPending ? 'Готовим файл...' : 'Выгрузить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Деактивировать пользователя?</DialogTitle>
            <DialogDescription>
              {deactivateTarget?.name} потеряет доступ к системе. Активировать обратно можно в любой момент.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => deactivateTarget && toggleActiveMutation.mutate(deactivateTarget)}
              disabled={toggleActiveMutation.isPending}
            >
              Деактивировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить пользователя?</DialogTitle>
            <DialogDescription>
              {deletionCheck.isLoading && 'Проверяем, что за сотрудником числится...'}
              {deletionCheck.data?.can_delete && (
                <>
                  {deleteTarget?.name} будет удалён насовсем. Это необратимо — в отличие от
                  деактивации, аккаунт восстановить будет нельзя.
                </>
              )}
              {deletionCheck.data && !deletionCheck.data.can_delete && (
                <>
                  Удалить нельзя: за сотрудником числится{' '}
                  {deletionCheck.data.blockers
                    .map((blocker) => `${blocker.count} ${blocker.entity}`)
                    .join(', ') || 'незавершённая работа'}
                  . Удаление унесло бы это с собой, поэтому такой аккаунт остаётся
                  деактивированным — доступа у него уже нет.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {deletionCheck.data && !deletionCheck.data.can_delete ? 'Понятно' : 'Отмена'}
            </Button>
            {deletionCheck.data?.can_delete && (
              <Button
                variant="destructive"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
                disabled={deleteMutation.isPending}
              >
                Удалить насовсем
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
