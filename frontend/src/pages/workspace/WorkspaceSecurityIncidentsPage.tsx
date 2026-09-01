import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldAlert } from 'lucide-react'
import { securityIncidentsApi, SecurityIncident, SecurityIncidentKind, SecurityIncidentStatus } from '@/api/securityIncidents'
import { AppButton, EmptyState, SegmentedTabs } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { toast } from '@/hooks/use-toast'
import { QueryError } from '@/components/shared/QueryState'

const KIND_LABELS: Record<SecurityIncidentKind, string> = {
  wrong_document: 'Ошибочная отправка документа', data_leak: 'Утечка данных', compromised_password: 'Компрометация пароля',
  lost_device: 'Потеря устройства', wrong_access: 'Неправильный доступ', unknown_chat_member: 'Посторонний участник чата',
}
const STATUS_LABELS: Record<SecurityIncidentStatus, string> = { open: 'Открыт', investigating: 'Расследуется', resolved: 'Устранён', closed: 'Закрыт' }

export const WorkspaceSecurityIncidentsPage: React.FC = () => {
  const [status, setStatus] = useState<SecurityIncidentStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<SecurityIncident | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['security-incidents', status], queryFn: () => securityIncidentsApi.list(status === 'all' ? undefined : status) })
  const items = data?.items ?? []
  return <div className="animate-fade-in">
    <div className="mb-6 flex items-start justify-between gap-4"><div><p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-w-accentText">Безопасность</p><h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-w-ink">Инциденты</h1><p className="mt-2 max-w-[560px] text-sm text-w-muted">Доказательства, меры устранения и подтверждение закрытия критичных событий.</p></div><AppButton colorPrefix="w" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Новый инцидент</AppButton></div>
    <div className="mb-5"><SegmentedTabs colorPrefix="w" value={status} onChange={(value) => setStatus(value as SecurityIncidentStatus | 'all')} tabs={[{ value: 'all', label: 'Все' }, { value: 'open', label: 'Открытые' }, { value: 'investigating', label: 'Расследуются' }, { value: 'resolved', label: 'Устранены' }, { value: 'closed', label: 'Закрыты' }]} /></div>
    {isError ? <QueryError colorPrefix="w" error={error} onRetry={refetch} /> : isLoading ? <div className="rounded-card border border-w-line bg-w-panel p-5 text-sm text-w-muted">Загрузка...</div> : items.length === 0 ? <EmptyState colorPrefix="w" icon={<ShieldAlert className="h-5 w-5" />} title="Инцидентов нет" /> : <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="rounded-card border border-w-line bg-w-panel p-4 text-left hover:border-w-accentDim"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-w-ink">{item.title}</h3><p className="mt-1 text-xs text-w-muted">{KIND_LABELS[item.kind]}</p></div><span className="rounded-pill bg-w-line px-2 py-1 text-2xs font-bold text-w-muted">{STATUS_LABELS[item.status]}</span></div><p className="mt-2 line-clamp-2 text-sm text-w-muted">{item.description}</p></button>)}</div>}
    {createOpen && <CreateIncidentDialog onClose={() => setCreateOpen(false)} />}
    {selected && <IncidentDialog incident={selected} onClose={() => setSelected(null)} />}
  </div>
}

const CreateIncidentDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const queryClient = useQueryClient(); const [kind, setKind] = useState<SecurityIncidentKind>('wrong_access'); const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [evidence, setEvidence] = useState('')
  const mutation = useMutation({ mutationFn: () => securityIncidentsApi.create({ kind, title, description, evidence: evidence || undefined }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['security-incidents'] }); onClose(); toast({ title: 'Инцидент зарегистрирован' }) }, onError: () => toast({ title: 'Не удалось зарегистрировать инцидент', variant: 'destructive' }) })
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="portal max-w-lg border-w-line bg-w-panel text-w-ink"><DialogHeader><DialogTitle>Новый инцидент</DialogTitle></DialogHeader><div className="space-y-3"><select value={kind} onChange={(e) => setKind(e.target.value as SecurityIncidentKind)} className="h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm">{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Краткий заголовок" className="h-10 w-full rounded-ctl border border-w-line bg-w-panel2 px-3 text-sm" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Что произошло" rows={4} className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm" /><textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Ссылки и доказательства" rows={3} className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm" /><AppButton colorPrefix="w" className="w-full" disabled={!title.trim() || !description.trim() || mutation.isPending} onClick={() => mutation.mutate()}>Зарегистрировать</AppButton></div></DialogContent></Dialog>
}

const IncidentDialog: React.FC<{ incident: SecurityIncident; onClose: () => void }> = ({ incident, onClose }) => {
  const queryClient = useQueryClient(); const [remediation, setRemediation] = useState(incident.remediation ?? '')
  const mutation = useMutation({ mutationFn: (status: SecurityIncidentStatus) => securityIncidentsApi.update(incident.id, { status, remediation }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['security-incidents'] }); onClose() }, onError: (error: unknown) => toast({ title: 'Не удалось изменить статус', description: (error as { response?: { data?: { detail?: string } } }).response?.data?.detail, variant: 'destructive' }) })
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="portal max-w-lg border-w-line bg-w-panel text-w-ink"><DialogHeader><DialogTitle>{incident.title}</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm text-w-ink">{incident.description}</p><p className="text-xs text-w-muted">{incident.evidence || 'Доказательства не добавлены'}</p><textarea value={remediation} onChange={(e) => setRemediation(e.target.value)} placeholder="Меры устранения" rows={4} className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2 text-sm" /><div className="flex flex-wrap gap-2">{(['investigating', 'resolved', 'closed'] as const).map((next) => <AppButton key={next} colorPrefix="w" disabled={mutation.isPending || (next !== 'investigating' && !remediation.trim())} onClick={() => mutation.mutate(next)}>{STATUS_LABELS[next]}</AppButton>)}</div></div></DialogContent></Dialog>
}
