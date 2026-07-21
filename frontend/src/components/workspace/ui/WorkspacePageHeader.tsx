import React from 'react'

export function WorkspacePageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div>
        {eyebrow && (
          <div className="mb-2 font-display text-[11px] uppercase tracking-[0.24em] text-w-accentText">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-3xl font-black leading-[1.05] tracking-tight text-w-ink md:text-4xl">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-[520px] text-sm leading-6 text-w-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
