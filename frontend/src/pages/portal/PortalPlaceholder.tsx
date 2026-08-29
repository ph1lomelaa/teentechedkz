import React from 'react'
import { Clock } from 'lucide-react'
import { EmptyState } from '@/components/ui'

export const PortalPlaceholder: React.FC<{ title: string; note?: string }> = ({ title, note }) => (
  <div className="mx-auto max-w-3xl">
    <p className="text-[12px] tracking-[0.04em] text-p-muted mb-3">Кабинет</p>
    <h1 className="text-2xl md:text-3xl font-black text-p-text mb-8">{title}</h1>
    <EmptyState
      icon={<Clock className="w-6 h-6" />}
      title="Раздел разрабатывается"
      description={note || 'Мы готовим этот раздел кабинета. Загляните чуть позже.'}
      colorPrefix="p"
    />
  </div>
)
