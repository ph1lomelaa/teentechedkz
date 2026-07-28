export type RecordingHealthTone = 'good' | 'warning' | 'danger' | 'neutral'

export interface RecordingHealth {
  tone: RecordingHealthTone
  title: string
  description: string
}

export function formatRecordingDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ].map((value) => String(value).padStart(2, '0')).join(':')
}

export function humanizeRecordingError(error: string): string {
  if (error === '__SAFARI__') {
    return 'Safari не умеет захватывать звук встречи. Выберите микрофон или откройте страницу в Chrome.'
  }
  if (error === '__NO_AUDIO__') {
    return 'В выбранном источнике нет звука. При показе экрана включите «Поделиться аудио».'
  }
  if (error === '__MIC_BUSY__') {
    return 'Микрофон занят другим приложением. Закройте его там и попробуйте снова.'
  }
  return error
}

export function getRecordingHealth(input: {
  sourceStopped: boolean
  error: string
  pendingCount: number
  syncStatus: string
  isCapturing: boolean
  isConnected: boolean
  noRecentSound: boolean
}): RecordingHealth {
  if (input.sourceStopped) {
    return {
      tone: 'danger',
      title: 'Запись остановилась',
      description: 'Сохранённый текст не потерян. Возобновите источник звука.',
    }
  }
  if (input.error) {
    return {
      tone: 'danger',
      title: 'Нужно проверить запись',
      description: input.error,
    }
  }
  if (input.pendingCount > 0 || input.syncStatus) {
    return {
      tone: 'warning',
      title: 'Сохраняем на устройстве',
      description: 'Не закрывайте вкладку — отправим текст, когда соединение восстановится.',
    }
  }
  if (input.isCapturing && !input.isConnected) {
    return {
      tone: 'warning',
      title: 'Подключаем распознавание…',
      description: 'Звук уже записывается. Обычно это занимает несколько секунд.',
    }
  }
  if (input.noRecentSound) {
    return {
      tone: 'warning',
      title: 'Не слышно речи',
      description: 'Проверьте, выбран ли правильный источник и идёт ли звук встречи.',
    }
  }
  if (input.isCapturing && input.isConnected) {
    return {
      tone: 'good',
      title: 'Всё работает',
      description: 'Звук поступает, текст распознаётся и сохраняется.',
    }
  }
  return {
    tone: 'neutral',
    title: 'Готово к запуску',
    description: 'Запустите запись и разрешите браузеру передавать звук встречи.',
  }
}
