import React from 'react'
import { Clock } from 'lucide-react'

export const PortalPlaceholder: React.FC<{ title: string; note?: string }> = ({ title, note }) => (
  <div className="mx-auto max-w-3xl">
    <p className="text-[12px] tracking-[0.04em] text-p-muted mb-3">Кабинет</p>
    <h1 className="text-2xl md:text-3xl font-black text-p-text mb-8">{title}</h1>
    <div className="rounded-[16px] border border-p-line bg-p-panel p-8 md:p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-brand/20 grid place-items-center mx-auto">
        <Clock className="w-6 h-6 text-brand" />
      </div>
      <h2 className="mt-6 text-lg md:text-xl font-bold text-p-text">Раздел разрабатывается</h2>
      <p className="mt-3 text-sm text-p-muted max-w-md mx-auto leading-relaxed">
        {note || 'Мы готовим этот раздел кабинета. Загляните чуть позже.'}
      </p>
    </div>
  </div>
)
