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

/** Через сколько секунд без связи с распознаванием показываем предупреждение и ошибку. */
export const RECOGNITION_WARN_AFTER_SECONDS = 10
export const RECOGNITION_FAIL_AFTER_SECONDS = 30

export const NOTE_SESSION_LANGUAGE_OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
  { value: 'en', label: 'English' },
] as const

export function humanizeRecordingError(error: string): string {
  if (error === '__SAFARI__') {
    return 'Safari не умеет захватывать звук встречи. Откройте эту страницу в Google Chrome или Microsoft Edge.'
  }
  if (error === '__CAPTURE_CANCELLED__') {
    return 'Вы закрыли окно выбора, не выбрав вкладку встречи. Нажмите «Записать встречу» ещё раз.'
  }
  if (error === '__SCREEN_PERMISSION_SYSTEM__') {
    return 'Компьютер запрещает браузеру запись экрана. На Mac: Системные настройки → Конфиденциальность и безопасность → Запись экрана и системного звука → включите Chrome и перезапустите его.'
  }
  if (error === '__DG_NOT_CONFIGURED__') {
    return 'Распознавание речи не настроено на сервере. Сообщите администратору — запись сейчас не сохранит текст.'
  }
  if (error === '__DG_FORBIDDEN__') {
    return 'У вашей учётной записи нет доступа к распознаванию речи. Сообщите администратору.'
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
  /** Сколько секунд звук пишется, а распознавание не подключено (0 — подключено). */
  disconnectedSeconds?: number
  /** Какой источник молчит дольше 20 секунд: собеседник (вкладка) или ментор (микрофон). */
  silentChannel?: 'meeting' | 'mic' | null
}): RecordingHealth {
  const disconnectedSeconds = input.disconnectedSeconds ?? 0
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
  if (input.isCapturing && !input.isConnected && disconnectedSeconds >= RECOGNITION_FAIL_AFTER_SECONDS) {
    return {
      tone: 'danger',
      title: 'Текст не распознаётся',
      description: 'Звук сохраняется в резервную запись, но распознавание не подключается. Нажмите «Повторить подключение»; если не помогло — сообщите администратору.',
    }
  }
  if (input.isCapturing && !input.isConnected && disconnectedSeconds >= RECOGNITION_WARN_AFTER_SECONDS) {
    return {
      tone: 'warning',
      title: 'Подключение затянулось',
      description: 'Звук записывается, но текст пока не распознаётся. Пробуем подключиться снова.',
    }
  }
  if (input.isCapturing && !input.isConnected) {
    return {
      tone: 'warning',
      title: 'Подключаем распознавание…',
      description: 'Звук уже записывается. Обычно это занимает несколько секунд.',
    }
  }
  if (input.silentChannel === 'meeting') {
    return {
      tone: 'warning',
      title: 'Не слышно собеседника',
      description: 'Проверьте, что выбрана вкладка встречи и включено «Поделиться звуком вкладки». Если нет — нажмите «Завершить» и запустите запись заново.',
    }
  }
  if (input.silentChannel === 'mic') {
    return {
      tone: 'warning',
      title: 'Не слышно вас',
      description: 'Микрофон молчит. Проверьте, что он не выключен в системе и что браузеру разрешён доступ к нему.',
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

/**
 * Умеет ли браузер записать звук встречи (getDisplayMedia со звуком вкладки).
 * Звук вкладки отдают только Chromium-браузеры на компьютере: Chrome, Edge,
 * Яндекс, Opera. Safari и Firefox возвращают поток без звука, мобильные
 * браузеры не умеют захват экрана вовсе.
 */
export function isRecordingBrowserSupported(userAgent: string): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return false
  if (/Firefox|FxiOS/i.test(userAgent)) return false
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent)
}
