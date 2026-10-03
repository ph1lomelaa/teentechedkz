import { Link2 } from 'lucide-react'
import type { StudentCandidate } from '@/api/accessRequests'
import { Button } from '@/components/ui/primitives/button'
import { formatDate } from '@/lib/utils'

/** Похожая карточка: кто, почему попала в список и можно ли к ней привязать. */
export function CandidateLine({
  candidate,
  canLink,
  busy,
  onLink,
  onReplace,
}: {
  candidate: StudentCandidate
  canLink: boolean
  busy: boolean
  onLink: () => void
  /** Карточка уже с кабинетом — перепривязать через подтверждение. */
  onReplace: () => void
}) {
  const owner = candidate.portal_owner
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="font-medium text-ds-ink">{candidate.full_name}</span>
        <span className="text-ds-muted">
          {[candidate.phone, candidate.intake_year].filter(Boolean).map((v) => `, ${v}`).join('')}
        </span>
        <div className="mt-0.5 text-xs text-ds-muted">
          {candidate.reason_label}
          {!candidate.is_free && (
            // Занятую карточку не прячем: скорее всего человек завёл второй
            // аккаунт. Показываем, чей кабинет, — админ решает, заменять ли.
            <span className="ml-2 font-medium text-st-busy">
              {owner
                ? `кабинет: ${owner.email} · ${
                    owner.last_login_at ? `входил ${formatDate(owner.last_login_at)}` : 'ни разу не входил'
                  }`
                : 'у этой карточки уже есть кабинет'}
            </span>
          )}
        </div>
      </div>
      {canLink &&
        (candidate.is_free ? (
          <Button size="sm" disabled={busy} onClick={onLink}>
            <Link2 className="mr-1.5 h-4 w-4" />
            Прикрепить
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={onReplace}>
            <Link2 className="mr-1.5 h-4 w-4" />
            Прикрепить
          </Button>
        ))}
    </li>
  )
}
