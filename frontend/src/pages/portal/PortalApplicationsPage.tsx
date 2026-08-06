import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { ApplicationsSection } from '@/components/portal/ApplicationsSection'

/** До этой страницы студент не видел собственный процесс поступления вообще:
 *  заявки существовали только внутри CRM-карточки. */
export const PortalApplicationsPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <div className="animate-fade-in">
      <div className="mb-6">
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
        <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Мои заявки</h1>
        <p className="mt-2 max-w-[520px] text-sm text-p-muted">
          Вузы, в которые идёт подача, и стадия по каждому. Список ведёт ваш ментор.
        </p>
      </div>
      <ApplicationsSection mode="self" basePath="/portal/universities" />
    </div>
  </PageShell>
)
