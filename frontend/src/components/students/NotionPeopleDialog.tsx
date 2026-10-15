import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import apiClient from '@/api/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'

interface Person { key: string; label: string; count: number; user_id: string | null; suggested_user_id: string | null }
interface Directory { items: Person[]; users: { id: string; name: string }[] }
function PersonRow({ person, users }: { person: Person; users: Directory['users'] }) {
  const [userId, setUserId] = useState(person.user_id ?? person.suggested_user_id ?? '')
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => apiClient.put('/students/people-links', { notion_key: person.key, user_id: userId || null }),
    onSuccess: () => {
      for (const key of ['notion-people-links', 'students']) qc.invalidateQueries({ queryKey: [key] })
      toast({ title: 'Соответствие сохранено', description: 'Поиск по аккаунту учитывает подтверждённое имя Notion. Назначения команды не изменены.' })
    },
    onError: error => toast({ title: 'Не удалось сохранить', description: getErrorMessage(error), variant: 'destructive' }),
  })
  return <tr className="border-t border-p-line"><td className="p-2 align-top"><b>{person.label}</b><p className="text-xs text-p-muted">{person.count} учеников · {person.user_id ? 'Сопоставлен' : 'Не сопоставлен'}</p></td><td className="p-2"><select aria-label={`Аккаунт: ${person.label}`} value={userId} onChange={event => setUserId(event.target.value)} className="w-full rounded-ctl border border-p-line bg-p-panel p-2 text-sm"><option value="">Не связан с аккаунтом</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>{!person.user_id && person.suggested_user_id && <p className="mt-1 text-xs text-p-muted">Совпадение имени — подтвердите связь.</p>}</td><td className="p-2"><button type="button" disabled={save.isPending || (userId || null) === person.user_id} onClick={() => save.mutate()} className="min-h-9 rounded-ctl border border-p-line px-3 text-xs font-semibold disabled:opacity-40">{save.isPending ? 'Сохраняем…' : 'Подтвердить'}</button></td></tr>
}
export function NotionPeopleDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notion-people-links'], queryFn: async () => (await apiClient.get<Directory>('/students/people-links')).data })
  const items = data?.items.filter(person => person.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Имена Notion и аккаунты сотрудников</DialogTitle><DialogDescription>Подтверждённые связи объединяют поиск. Они сохраняются после переименования аккаунта. Команда ученика и права доступа здесь не меняются.</DialogDescription></DialogHeader>
    <input aria-label="Найти имя Notion" placeholder="Найти имя…" value={search} onChange={event => setSearch(event.target.value)} className="h-9 rounded-ctl border border-p-line bg-p-panel px-3 text-sm" />
    {isLoading && <p>Загружаем имена…</p>}{error && <div role="alert">{getErrorMessage(error)} <button type="button" onClick={() => refetch()} className="underline">Повторить</button></div>}
    {data && <><p className="text-xs text-p-muted">Сопоставлено {data.items.filter(person => person.user_id).length} из {data.items.length} имён.</p><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Имя в Notion</th><th className="p-2">Аккаунт платформы</th><th /></tr></thead><tbody>{items.map(person => <PersonRow key={`${person.key}:${person.user_id}`} person={person} users={data.users} />)}</tbody></table>{!items.length && <p>Имена не найдены.</p>}</>}
  </DialogContent></Dialog>
}
