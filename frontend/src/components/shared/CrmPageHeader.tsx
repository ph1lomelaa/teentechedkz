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
    <header className="mb-6 flex flex-col items-stretch gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-5 sm:pb-6">
      <div className="min-w-0 flex-1">
        <div className="mb-2 font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">
          {eyebrow}
        </div>
        <h1 className="break-words font-display text-[1.75rem] font-black leading-[1.08] tracking-tight text-gray-900 sm:text-3xl md:text-4xl">
          {title}
        </h1>
        {description && (
          <div className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
            {description}
          </div>
        )}
      </div>
      {action && <div className="min-w-0 sm:shrink-0 [&>*]:max-w-full">{action}</div>}
    </header>
  )
}
