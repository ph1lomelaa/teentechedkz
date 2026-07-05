import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, UserX, UserCheck, LogOut } from 'lucide-react'
import { usersApi } from '@/api/index'
import { User, UserRole, ROLE_LABELS } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/use-toast'

interface UserForm {
  name: string
  email: string
  role: UserRole
  phone: string
  telegram_username: string
  password: string
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
  const isEdit = !!user
  const [form, setForm] = useState<UserForm>({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? 'mentor',
    phone: user?.phone ?? '',
    telegram_username: user?.telegram_username ?? '',
    password: '',
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Partial<User> & { password?: string } = {
        name: form.name,
        email: form.email,
        role: form.role,
        phone: form.phone || undefined,
        telegram_username: form.telegram_username || undefined,
      }
      if (form.password) {
        payload.password = form.password
      }

      if (isEdit && user) {
        return usersApi.update(user.id, payload)
      }
      return usersApi.create(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: isEdit ? 'Пользователь обновлён' : 'Пользователь создан' })
      onClose()
    },
    onError: () => {
      toast({ title: 'Ошибка', variant: 'destructive' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Редактировать пользователя' : 'Новый пользователь'}
          </DialogTitle>
        </DialogHeader>
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
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Телефон</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+7 777 000 00 00"
            />
          </div>
          <div>
            <Label>Telegram</Label>
            <Input
              value={form.telegram_username}
              onChange={(e) => setForm({ ...form, telegram_username: e.target.value })}
              placeholder="@username"
            />
          </div>
          <div>
            <Label>{isEdit ? 'Новый пароль (оставьте пустым, если не меняете)' : 'Пароль'}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required={!isEdit}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.name || !form.email || (!isEdit && !form.password) || mutation.isPending}
          >
            {mutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogFooter>
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

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => usersApi.list(),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (user: User) =>
      usersApi.update(user.id, { is_active: !user.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
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
      <div className="flex items-end justify-between mb-6 pb-5 border-b border-gray-200">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Настройки</h1>
          <p className="label-caps mt-1.5">Аккаунт и пользователи</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Добавить
        </Button>
      </div>

      {currentUser && (
        <div className="mb-8 border border-gray-200 rounded-[2px] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="label-caps mb-2">Текущий аккаунт</p>
              <h2 className="text-lg font-semibold text-gray-900">{currentUser.name}</h2>
              <p className="text-sm text-gray-600 mt-1">{currentUser.email}</p>
              <span className="inline-flex mt-3 text-[11px] px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-[2px] font-medium uppercase tracking-wide">
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

      <div className="flex items-center justify-between mb-3">
        <p className="label-caps">Пользователи</p>
      </div>

      <div className="border-y border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
              <TableHead>Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  Нет пользователей
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} className="border-gray-100 hover:bg-gray-50">
                  <TableCell className="font-medium text-gray-900">{user.name}</TableCell>
                  <TableCell className="text-gray-600">{user.email}</TableCell>
                  <TableCell>
                    <span className="text-[11px] px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-[2px] font-medium uppercase tracking-wide">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </TableCell>
                  <TableCell className="text-gray-600 text-sm">
                    {user.telegram_username ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[11px] px-2 py-0.5 rounded-[2px] font-medium uppercase tracking-wide ${user.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                      {user.is_active ? 'Активен' : 'Неактивен'}
                    </span>
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
                        onClick={() => toggleActiveMutation.mutate(user)}
                        disabled={toggleActiveMutation.isPending}
                        title={user.is_active ? 'Деактивировать' : 'Активировать'}
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
    </div>
  )
}
