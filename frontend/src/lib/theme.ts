let switchSequence = 0

/** Apply a theme state update without letting per-component color transitions cascade. */
export function applyThemeInstantly(update: () => void) {
  const root = document.documentElement
  const sequence = ++switchSequence

  root.classList.add('theme-switching')
  update()

  const finish = () => {
    if (sequence === switchSequence) root.classList.remove('theme-switching')
  }

  requestAnimationFrame(() => requestAnimationFrame(finish))
  window.setTimeout(finish, 180)
}
