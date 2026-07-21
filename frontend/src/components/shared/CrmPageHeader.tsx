import React from 'react'

export function CrmPageHeader({
  eyebrow = 'TeenTechEd CRM',
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-5 border-b border-gray-200 pb-6">
      <div className="min-w-0">
        <div className="mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em] text-yellow-500">
          {eyebrow}
        </div>
        <h1 className="font-display text-3xl font-black leading-[1.05] tracking-tight text-gray-900 md:text-4xl">
          {title}
        </h1>
        {description && (
          <div className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
            {description}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}
