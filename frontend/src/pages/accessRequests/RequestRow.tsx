import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Clock, Link2, MoreHorizontal, UserPlus } from 'lucide-react'
import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'
import { Button } from '@/components/ui/primitives/button'
import { Avatar } from '@/components/ui'
import { cn, formatDate } from '@/lib/utils'
import { CompareTable } from './CompareTable'
import { reasonExplanation } from './compare'
import { GROUP_META, looksLikeSameAccount, phoneCandidates, type RequestGroup } from './groups'
import { isRecentLogin } from './texts'

export function GroupBadge({ group }: { group: RequestGroup }) {
  const meta = GROUP_META[group]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-semibold',
        meta.badgeClass,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dotClass)} aria-hidden="true" />
      {meta.badge}
    </span>
  )
}

/** Короткие метки причин под именем — только из данных, которые уже есть в ответе. */
function ReasonLine({ item, group }: { item: AccessRequestItem; group: RequestGroup }) {
  const candidates = item.candidates ?? []
  const byPhone = phoneCandidates(item)
  const owner = byPhone.find((c) => !c.is_free)?.portal_owner ?? null
  const recent = isRecentLogin(owner?.last_login_at)

  if (group === 'mentor') return <>Заявка на роль ментора</>
  if (group === 'create')
    return <>{item.phone?.trim() ? 'Совпадений в базе нет' : 'Телефон не указан, совпадений нет'}</>
  if (group === 'linked') return <>Аккаунт уже привязан к карточке</>
  if (group === 'attach') return <>Телефон совпал · карточка «{candidates[0]?.full_name}»</>
  if (group === 'check')
    return (
      <>
        {candidates.length === 1
          ? 'ФИО похоже'
          : candidates.length === 2
            ? 'Два кандидата'
            : `Кандидатов: ${candidates.length}`}
      </>
    )
  // busy
  return (
    <>
      Телефон совпал ·{' '}
      <span className={cn(recent && 'inline-flex items-center gap-1 font-semibold text-st-busy')}>
        {recent && <Clock className="h-3 w-3" aria-hidden="true" />}
        {owner
          ? `Кабинет: ${owner.email} · ${
              owner.last_login_at ? `входил ${formatDate(owner.last_login_at)}` : 'ни разу не входил'
            }`
          : 'у карточки уже есть кабинет'}
      </span>
    </>
  )
}

function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: React.ReactNode
  onSelect: () => void
  danger?: boolean
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center rounded-ctl px-3 py-2 outline-none',
        'data-[highlighted]:bg-ds-panel2 data-[highlighted]:ring-1 data-[highlighted]:ring-ds-accentText',
        danger && 'text-ds-danger',
      )}
    >
      {children}
    </DropdownMenu.Item>
  )
}

export interface RequestRowProps {
  item: AccessRequestItem
  group: RequestGroup
  canDecide: boolean
  showCheckbox: boolean
  checked: boolean
  busy: boolean
  /** Красная пометка после неудачного массового действия — до следующего обновления. */
  error?: string
  onToggle: () => void
  onLink: (studentId: string) => void
  onReplace: (candidate: StudentCandidate) => void
  onApproveMentor: () => void
  onCreateStudent: () => void
  onReject: () => void
  onCloseLinked: () => void
  onPickOther: () => void
}

export function RequestRow({
  item,
  group,
  canDecide,
  showCheckbox,
  checked,
  busy,
  error,
  onToggle,
  onLink,
  onReplace,
  onApproveMentor,
  onCreateStudent,
  onReject,
  onCloseLinked,
  onPickOther,
}: RequestRowProps) {
  const [open, setOpen] = useState(false)
  const candidates = item.candidates ?? []
  const byPhone = phoneCandidates(item)
  const isStudent = item.requested_role === 'student'
  // Бэкенд без portal_owner.user_id: по email только предупреждаем и прячем замену.
  const maybeSame = group === 'busy' && looksLikeSameAccount(item)
  // Совпал телефон — это тот же человек, и новая карточка стала бы дублем.
  const canCreateNew = isStudent && byPhone.length === 0
  const canCompare = isStudent && candidates.length > 0

  let main: { label: string; icon: React.ReactNode; onClick: () => void } | null = null
  if (group === 'attach' && byPhone[0])
    main = { label: 'Прикрепить', icon: <Link2 className="mr-1.5 h-4 w-4" />, onClick: () => onLink(byPhone[0].id) }
  else if (group === 'busy' && !maybeSame && byPhone[0])
    main = { label: 'Заменить кабинет…', icon: <Link2 className="mr-1.5 h-4 w-4" />, onClick: () => onReplace(byPhone[0]) }
  else if (group === 'linked')
    main = { label: 'Закрыть заявку', icon: <Check className="mr-1.5 h-4 w-4" />, onClick: onCloseLinked }
  else if (group === 'check')
    main = { label: open ? 'Свернуть' : 'Проверить', icon: <ChevronDown className={cn('mr-1.5 h-4 w-4 transition-transform', open && 'rotate-180')} />, onClick: () => setOpen((v) => !v) }
  else if (group === 'create')
    main = { label: 'Создать карточку', icon: <UserPlus className="mr-1.5 h-4 w-4" />, onClick: onCreateStudent }
  else if (group === 'mentor')
    main = { label: 'Одобрить как ментора', icon: <Check className="mr-1.5 h-4 w-4" />, onClick: onApproveMentor }

  const details = [item.user.email, item.phone, [item.city, item.direction].filter(Boolean).join(' · ')].filter(Boolean)
  const panelId = `compare-${item.id}`

  return (
    <li className={cn('relative rounded-card border bg-ds-panel p-3 sm:p-4', error ? 'border-ds-danger' : 'border-ds-line')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {showCheckbox && (
          <input
            type="checkbox"
            className="hidden h-4 w-4 shrink-0 accent-ds-accentText sm:block"
            checked={checked}
            onChange={onToggle}
            aria-label={`Выбрать заявку: ${item.full_name}`}
          />
        )}
        <div className="flex min-w-0 flex-1 items-start gap-3 pr-10 sm:pr-0">
          {showCheckbox && (
            <input
              type="checkbox"
              className="mt-2 h-4 w-4 shrink-0 accent-ds-accentText sm:hidden"
              checked={checked}
              onChange={onToggle}
              aria-label={`Выбрать заявку: ${item.full_name}`}
            />
          )}
          <Avatar name={item.full_name} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 max-w-full truncate font-semibold text-ds-ink" title={item.full_name}>
                {item.full_name}
              </span>
              <GroupBadge group={group} />
            </div>
            <p className="truncate text-sm text-ds-muted" title={details.join(' · ')}>
              {details.join(' · ')}
            </p>
            <p className="mt-0.5 text-xs text-ds-muted">
              <ReasonLine item={item} group={group} />
              {maybeSame && (
                <span className="ml-2 font-semibold text-st-busy">Возможно, тот же аккаунт</span>
              )}
            </p>
            {error && (
              <p role="alert" className="mt-1 text-xs font-semibold text-ds-danger">
                Не прикреплено: {error}
              </p>
            )}
            {canCompare && (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 rounded-ctl text-xs font-medium text-ds-accentText underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accentText"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                {open ? 'Скрыть сравнение' : 'Показать сравнение'}
              </button>
            )}
          </div>
        </div>

        <div className="contents sm:flex sm:shrink-0 sm:items-center sm:gap-2">
          {!canDecide ? (
            <span className="text-xs text-ds-muted sm:text-right">Только просмотр</span>
          ) : (
            <>
              {main ? (
                <Button size="sm" className="w-full sm:w-auto" disabled={busy} onClick={main.onClick}>
                  {main.icon}
                  {main.label}
                </Button>
              ) : maybeSame ? (
                <span className="text-xs text-ds-muted sm:max-w-[14rem] sm:text-right">
                  Замена скрыта: нельзя отключить собственный аккаунт
                </span>
              ) : null}
              <div className="absolute right-2 top-2 sm:static">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 px-0"
                      aria-label={`Другие действия: ${item.full_name}`}
                      disabled={busy}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 min-w-[12rem] rounded-ctl border border-ds-line bg-ds-panel p-1 text-sm text-ds-ink shadow-lg"
                    >
                      {isStudent && <MenuItem onSelect={onPickOther}>Найти другую карточку</MenuItem>}
                      {canCreateNew && group !== 'create' && (
                        <MenuItem onSelect={onCreateStudent}>Создать новую карточку</MenuItem>
                      )}
                      <MenuItem onSelect={onReject} danger>
                        Отклонить
                      </MenuItem>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </>
          )}
        </div>
      </div>

      {open && canCompare && (
        <div id={panelId} className="mt-3 space-y-4 rounded-ctl border border-ds-line bg-ds-panel2 p-3">
          {candidates.map((candidate) => (
            <section key={candidate.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ds-ink" title={candidate.full_name}>
                    {candidate.full_name}
                  </p>
                  <p className="text-xs text-ds-muted">
                    {reasonExplanation(candidate, byPhone.length)}
                    {!candidate.is_free && ' · у карточки уже есть кабинет'}
                  </p>
                </div>
                {group === 'check' && canDecide && (
                  <Button
                    size="sm"
                    variant={candidate.is_free ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => (candidate.is_free ? onLink(candidate.id) : onReplace(candidate))}
                  >
                    <Link2 className="mr-1.5 h-4 w-4" />
                    Прикрепить к этой карточке
                  </Button>
                )}
              </div>
              <CompareTable item={item} card={candidate} />
            </section>
          ))}
        </div>
      )}
    </li>
  )
}
