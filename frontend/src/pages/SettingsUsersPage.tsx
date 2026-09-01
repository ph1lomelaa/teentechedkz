import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, UserX, UserCheck, LogOut, Users, Clock } from 'lucide-react'
import { usersApi } from '@/api/index'
import { User, UserRole, ROLE_LABELS } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/primitives/button'
import { Input } from '@/components/ui/primitives/input'
import { Label } from '@/components/ui/primitives/label'
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

const ROLE_FILTER_OPTIONS: Array<UserRole | 'all'> = ['all', 'admin', 'mzk_manager', 'mentor', 'student']
const ROLE_FILTER_LABELS: Record<UserRole | 'all', string> = {
  all: 'Все роли',
  ...ROLE_LABELS,
}
const STATUS_FILTER_OPTIONS = ['all', 'active', 'pending'] as const
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Любой статус',
  active: 'Активные',
  pending: 'Ожидают активации',
}

interface UserForm {
  name: string
  email: string
  role: UserRole
  phone: string
  telegram_username: string
  password: string
}

const STAFF_ROLE_OPTIONS: Array<Exclude<UserRole, 'student'>> = ['admin', 'mzk_manager', 'mentor']

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
    password: '',
  })
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const mutation = useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (isEdit && user) {
        const payload: Partial<User> & { password?: string } = {
          name: form.name,
          email: form.email,
          role: form.role,
          phone: form.phone || undefined,
          telegram_username: form.telegram_username || undefined,
        }
        if (form.password) payload.password = form.password
        await usersApi.update(user.id, payload)
        return null
      }
      // Новый сотрудник: пароль задаёт сам по ссылке-приглашению (п.7).
      const created = await usersApi.createInvite({
        name: form.name,
        email: form.email,
        role: form.role,
        phone: form.phone || undefined,
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
                  <div>
                    <Label>Новый пароль (оставьте пустым, если не меняете)</Label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••"
                    />
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

export const SettingsUsersPage: React.FC = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user: currentUser, logout } = useAuth()
  const [editUser, setEditUser] = useState<User | undefined>()
  const [addOpen, setAddOpen] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null)
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

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
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter === 'active' && !u.is_active) return false
      if (statusFilter === 'pending' && u.is_active) return false
      return true
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
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Добавить
        </Button>
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
          onClick={() => { setRoleFilter('all'); setStatusFilter('pending') }}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="label-caps">Пользователи</p>
        <div className="flex flex-wrap items-center gap-2">
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
                <TableCell colSpan={7} className="py-8 text-center" role="alert">
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
                <TableCell colSpan={7} className="text-center py-8 text-p-muted">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-p-muted">
                  Нет пользователей по выбранным фильтрам
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
    </div>
  )
}
