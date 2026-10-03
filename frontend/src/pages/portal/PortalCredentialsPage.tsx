import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { PortalCredentialsSection } from '@/components/portal/PortalCredentialsSection'

/** Доступы к порталам вузов, которые внёс ментор. Студент их только смотрит:
 *  по регламенту admission данные ведёт компания. */
export const PortalCredentialsPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <div className="animate-fade-in">
      <div className="mb-6">
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
        <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Admission-доступы</h1>
        <p className="mt-2 max-w-[520px] text-sm text-p-muted">
          Ссылки, логины и пароли от порталов вузов, куда идёт подача. Их добавляет ваш ментор.
        </p>
      </div>
      <PortalCredentialsSection mode="self" />
    </div>
  </PageShell>
)
