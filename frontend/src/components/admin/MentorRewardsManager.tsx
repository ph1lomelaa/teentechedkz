import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Banknote, CheckCircle2, Info, Plus } from 'lucide-react'
import { mentorRewardsApi, MentorStageKind, PenaltyColor } from '@/api/mentorRewards'
import { usersApi } from '@/api'
import { studentsApi } from '@/api/students'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AppButton, AppInput, EmptyState, PageHeader, SegmentedTabs } from '@/components/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { getErrorMessage } from '@/lib/errorMessage'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'
import { useRewardRules } from '@/hooks/useRewardRules'
import { useAuth } from '@/contexts/AuthContext'
import { RewardRulesConstructor } from './RewardRulesConstructor'

// Только названия: ставки приходят из конструктора (useRewardRules).
// Раньше проценты и суммы были захардкожены здесь и расходились с расчётом,
// как только регламент менялся.
const STAGE_TITLES: Record<MentorStageKind, string> = {
  pre_admission: 'Pre-Admission',
  admission: 'Admission',
  post_admission: 'Post-Admission',
}

const COLOR_TITLES: Record<PenaltyColor, string> = {
  yellow: 'Жёлтый',
  orange: 'Оранжевый',
  red: 'Красный',
}

const COLOR_STYLES: Record<PenaltyColor, string> = {
  yellow: 'border-amber-400/60 bg-amber-400/10 text-amber-500 dark:text-amber-300',
  orange: 'border-orange-400/60 bg-orange-400/10 text-orange-500 dark:text-orange-300',
  red: 'border-red-400/60 bg-red-400/10 text-red-500 dark:text-red-300',
}

const money = (n: number) => new Intl.NumberFormat('ru-RU').format(n)

interface Props {
  colorPrefix?: AdminColorPrefix
  /** false — режим ментора: только свои строки, без создания и приёмки, но с возражением. */
  canManage?: boolean
  /** Показывать ссылку на «Финансы» в баннере — только там, где этот раздел есть. */
  financesPath?: string
}

export const MentorRewardsManager: React.FC<Props> = ({
  colorPrefix = 'w',
  canManage = true,
  financesPath,
}) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const [tab, setTab] = useState<'rewards' | 'penalties' | 'rules'>('rewards')
  const [createRewardOpen, setCreateRewardOpen] = useState(false)
  const [createPenaltyOpen, setCreatePenaltyOpen] = useState(false)
  const [contesting, setContesting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()
  // Ставки — это деньги и регламент: править может только админ.
  const { hasRole } = useAuth()
  const isAdmin = hasRole('admin')
  // Подпись собираем из действующих ставок: раньше проценты были вписаны в
  // текст руками и оставались старыми после правки регламента.
  const { stagePct } = useRewardRules()
  const stageSummary = (['pre_admission', 'admission', 'post_admission'] as const)
    .map((s) => `${STAGE_TITLES[s]} ${stagePct(s) ?? '—'}%`)
    .join(' / ')

  // Бэкенд сам скоупит ментора на его строки — отдельный mentor_id не нужен.
  const { data: rewardsData, isLoading: rewardsLoading } = useQuery({
    queryKey: ['mentor-stage-rewards'],
    queryFn: () => mentorRewardsApi.listStageRewards(),
    enabled: tab === 'rewards',
  })
  const rewards = rewardsData?.items ?? []
  const isPilot = rewardsData?.pilot ?? true

  const { data: penaltiesData, isLoading: penaltiesLoading } = useQuery({
    queryKey: ['mentor-task-penalties'],
    queryFn: () => mentorRewardsApi.listTaskPenalties(),
    enabled: tab === 'penalties',
  })
  const penalties = penaltiesData?.items ?? []

  const acceptMutation = useMutation({
    mutationFn: (id: string) => mentorRewardsApi.acceptStageReward(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mentor-stage-rewards'] }),
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось принять этап'), variant: 'destructive' }),
  })

  const contestMutation = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => mentorRewardsApi.contestTaskPenalty(id, why),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mentor-task-penalties'] })
      setContesting(null)
      setNote('')
      toast({ title: 'Возражение отправлено' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось отправить возражение'), variant: 'destructive' }),
  })

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          colorPrefix={colorPrefix}
          eyebrow="Пилот"
          title={canManage ? 'Вознаграждение менторов по этапам' : 'Моё вознаграждение'}
          description={`Расчёт по регламенту: ${stageSummary}, постоплата после приёмки.`}
        />
        {canManage && tab !== 'rules' && (
          <AppButton
            colorPrefix={colorPrefix}
            onClick={() => (tab === 'rewards' ? setCreateRewardOpen(true) : setCreatePenaltyOpen(true))}
          >
            <Plus className="h-4 w-4" /> {tab === 'rewards' ? 'Добавить этап' : 'Зафиксировать нарушение'}
          </AppButton>
        )}
      </div>

      {/* Рядом в CRM живут «Финансы» с реальными выплатами менторам — без явной
          пометки две похожие таблицы с деньгами легко перепутать. */}
      {isPilot && (
        <div className={cn('mb-5 flex items-start gap-2 p-3 text-xs', t.card, t.muted)}>
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Это расчёт по регламенту, а не выплата: суммы не связаны с бухгалтерией.
            {financesPath && (
              <> Фактические выплаты — в разделе <Link to={financesPath} className={cn('font-bold underline', t.ink)}>Финансы</Link>.</>
            )}
          </span>
        </div>
      )}

      <div className="mb-5">
        <SegmentedTabs
          colorPrefix={colorPrefix}
          value={tab}
          onChange={(v) => setTab(v as 'rewards' | 'penalties' | 'rules')}
          tabs={[
            { value: 'rewards', label: canManage ? 'Вознаграждение по этапам' : 'Мои этапы' },
            { value: 'penalties', label: canManage ? 'Реестр штрафов' : 'Мои штрафы' },
            // Конструктор рядом с начислениями не случайно: поменял ставку —
            // сразу видно, как будут выглядеть следующие карточки.
            ...(isAdmin ? [{ value: 'rules', label: 'Конструктор вознаграждений' }] : []),
          ]}
        />
      </div>

      {tab === 'rules' ? (
        <RewardRulesConstructor colorPrefix={colorPrefix} />
      ) : tab === 'rewards' ? (
        rewardsLoading ? (
          <div className={cn('p-5 text-sm', t.card, t.muted)}>Загрузка...</div>
        ) : rewards.length === 0 ? (
          <EmptyState colorPrefix={colorPrefix} icon={<Banknote className="h-5 w-5" />} title="Расчётов ещё нет" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rewards.map((r) => (
              <div key={r.id} className={cn('p-4', t.card)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className={cn('truncate font-bold', t.ink)}>{r.mentor_name ?? 'Ментор'}</h3>
                    {/* Процент из самой строки: он объясняет сумму ниже. Взять
                        действующую ставку значило бы показать «30%» над суммой,
                        посчитанной по 40%. */}
                    <p className={cn('mt-0.5 text-xs', t.muted)}>
                      {STAGE_TITLES[r.stage]} · {r.stage_pct}%
                    </p>
                  </div>
                  {r.accepted ? (
                    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-bold', t.line, t.good)}>
                      <CheckCircle2 className="h-3 w-3" /> Принят
                    </span>
                  ) : canManage ? (
                    <button
                      type="button"
                      onClick={() => acceptMutation.mutate(r.id)}
                      disabled={acceptMutation.isPending}
                      className={cn('shrink-0 rounded-pill border px-2 py-0.5 text-2xs font-bold', t.borderLine, t.muted, 'hover:opacity-80')}
                    >
                      Принять этап
                    </button>
                  ) : (
                    <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-2xs font-bold', t.line, t.muted)}>
                      Ожидает приёмки
                    </span>
                  )}
                </div>
                <p className={cn('mt-2 text-xl font-black', t.ink)}>{money(r.computed_amount)} ₸</p>
                <p className={cn('text-2xs', t.muted2)}>из {money(r.total_contract_amount)} ₸ за полный цикл</p>
              </div>
            ))}
          </div>
        )
      ) : penaltiesLoading ? (
        <div className={cn('p-5 text-sm', t.card, t.muted)}>Загрузка...</div>
      ) : penalties.length === 0 ? (
        <EmptyState colorPrefix={colorPrefix} icon={<AlertTriangle className="h-5 w-5" />} title="Нарушений не зафиксировано" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {penalties.map((p) => (
            <div key={p.id} className={cn('p-4', t.card)}>
              <div className="flex items-start justify-between gap-3">
                <h3 className={cn('truncate font-bold', t.ink)}>{p.mentor_name ?? 'Ментор'}</h3>
                <span className={cn('inline-flex shrink-0 items-center rounded-pill border px-2 py-0.5 text-2xs font-bold', COLOR_STYLES[p.color])}>
                  {COLOR_TITLES[p.color]} · {money(p.amount)} ₸
                </span>
              </div>
              <p className={cn('mt-2 text-2xs', t.muted2)}>
                {new Date(p.recorded_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
              {p.contested ? (
                <p className={cn('mt-2 text-2xs', t.muted)}>
                  Оспорено{p.contest_note ? `: ${p.contest_note}` : ''}
                </p>
              ) : (
                // п.6.8 даёт ментору право возразить в течение 2 рабочих дней,
                // но до сих пор кнопки не было нигде — право существовало только в API.
                <button
                  type="button"
                  onClick={() => { setContesting(p.id); setNote('') }}
                  className={cn('mt-2 text-2xs font-bold', t.muted, t.dangerHover)}
                >
                  Не согласен
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {createRewardOpen && <CreateStageRewardDialog colorPrefix={colorPrefix} onClose={() => setCreateRewardOpen(false)} />}
      {createPenaltyOpen && <CreateTaskPenaltyDialog colorPrefix={colorPrefix} onClose={() => setCreatePenaltyOpen(false)} />}

      <Dialog open={Boolean(contesting)} onOpenChange={(open) => { if (!open) setContesting(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Возражение по санкции</DialogTitle></DialogHeader>
          <p className={cn('text-sm', t.muted)}>
            п.6.8 регламента: возражение подаётся в течение двух рабочих дней. Текст увидит администрация.
          </p>
          <AppInput
            colorPrefix={colorPrefix}
            label="Что не так"
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: задача была передана другому ментору"
          />
          <DialogFooter>
            <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={() => setContesting(null)}>Отмена</AppButton>
            <AppButton
              colorPrefix={colorPrefix}
              disabled={!note.trim() || contestMutation.isPending}
              onClick={() => contesting && contestMutation.mutate({ id: contesting, why: note.trim() })}
            >
              Отправить
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const CreateStageRewardDialog: React.FC<{ colorPrefix: AdminColorPrefix; onClose: () => void }> = ({ colorPrefix, onClose }) => {
  const queryClient = useQueryClient()
  const [mentorId, setMentorId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [stage, setStage] = useState<MentorStageKind>('pre_admission')
  const [amount, setAmount] = useState('')
  // Действующая ставка: именно она применится к этому начислению.
  const { stageLabel } = useRewardRules()

  const { data: mentors = [] } = useQuery({ queryKey: ['users', 'mentor'], queryFn: () => usersApi.list({ role: 'mentor' }) })
  const { data: students = [] } = useQuery({ queryKey: ['students', 'all'], queryFn: () => studentsApi.getAll() })

  const mutation = useMutation({
    mutationFn: () => mentorRewardsApi.createStageReward({
      mentor_id: mentorId,
      student_id: studentId,
      stage,
      total_contract_amount: Number(amount),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mentor-stage-rewards'] })
      toast({ title: 'Этап добавлен' })
      onClose()
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось добавить этап'), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Добавить этап вознаграждения</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={mentorId} onValueChange={setMentorId}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Ментор" /></SelectTrigger>
            <SelectContent>{mentors.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Студент" /></SelectTrigger>
            <SelectContent>{students.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={stage} onValueChange={(v) => setStage(v as MentorStageKind)}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['pre_admission', 'admission', 'post_admission'] as const).map((s) => (
                <SelectItem key={s} value={s}>{stageLabel(s, STAGE_TITLES[s])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AppInput
            colorPrefix={colorPrefix}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма за полный цикл, ₸"
          />
          <AppButton
            colorPrefix={colorPrefix}
            className="w-full"
            disabled={!mentorId || !studentId || !amount || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Добавить
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const CreateTaskPenaltyDialog: React.FC<{ colorPrefix: AdminColorPrefix; onClose: () => void }> = ({ colorPrefix, onClose }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const [mentorId, setMentorId] = useState('')
  const [color, setColor] = useState<PenaltyColor>('yellow')

  const { data: mentors = [] } = useQuery({ queryKey: ['users', 'mentor'], queryFn: () => usersApi.list({ role: 'mentor' }) })
  const { penaltyLabel } = useRewardRules()

  const mutation = useMutation({
    mutationFn: () => mentorRewardsApi.createTaskPenalty({ mentor_id: mentorId, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mentor-task-penalties'] })
      toast({ title: 'Нарушение зафиксировано' })
      onClose()
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось зафиксировать нарушение'), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Зафиксировать нарушение</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={mentorId} onValueChange={setMentorId}>
            <SelectTrigger className="h-11"><SelectValue placeholder="Ментор" /></SelectTrigger>
            <SelectContent>{mentors.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex flex-wrap gap-2">
            {(['yellow', 'orange', 'red'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'rounded-full border px-3 py-1 text-2xs font-bold transition',
                  color === c ? COLOR_STYLES[c] : cn(t.borderLine, t.muted, 'hover:opacity-80'),
                )}
              >
                {penaltyLabel(c, COLOR_TITLES[c])}
              </button>
            ))}
          </div>
          <AppButton colorPrefix={colorPrefix} className="w-full" disabled={!mentorId || mutation.isPending} onClick={() => mutation.mutate()}>
            Зафиксировать
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
