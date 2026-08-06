import React from 'react'
import { PageShell } from '@/components/shared/PageShell'
import { ShortlistSection } from '@/components/portal/ShortlistSection'

export const PortalShortlistPage: React.FC = () => (
  <PageShell maxWidth="lg">
    <div className="animate-fade-in">
      <div className="mb-6">
        <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
        <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Избранные вузы</h1>
        <p className="mt-2 max-w-[520px] text-sm text-p-muted">
          Список вузов, которые вы рассматриваете. Ментор видит его и может добавить свои варианты.
        </p>
      </div>
      <ShortlistSection mode="self" basePath="/portal/universities" />
    </div>
  </PageShell>
)
