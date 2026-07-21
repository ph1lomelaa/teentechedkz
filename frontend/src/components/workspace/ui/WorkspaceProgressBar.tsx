export function WorkspaceProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return (
    <div
      role="progressbar"
      aria-label="Прогресс roadmap"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safe}
      className="h-1.5 overflow-hidden rounded-full bg-w-panel2"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-w-accentDim to-w-accent transition-all"
        style={{ width: `${safe}%` }}
      />
    </div>
  )
}
