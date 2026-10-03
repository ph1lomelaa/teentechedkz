import { describe, expect, it } from 'vitest'
import {
  formatRecordingDuration,
  getRecordingHealth,
  humanizeRecordingError,
  isRecordingBrowserSupported,
} from './noteSessionUi'

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
}

const base = {
  sourceStopped: false,
  error: '',
  pendingCount: 0,
  syncStatus: '',
  isCapturing: true,
  isConnected: true,
  noRecentSound: false,
}

describe('note session UI', () => {
  it('formats the meeting timer', () => {
    expect(formatRecordingDuration(3723)).toBe('01:02:03')
  })

  it('shows a single healthy state when capture, recognition and saving work', () => {
    expect(getRecordingHealth(base)).toMatchObject({ tone: 'good', title: 'Всё работает' })
  })

  it('prioritizes an interrupted source over lower-priority states', () => {
    expect(getRecordingHealth({
      ...base,
      sourceStopped: true,
      pendingCount: 2,
    })).toMatchObject({ tone: 'danger', title: 'Запись остановилась' })
  })

  it('explains local saving without provider terminology', () => {
    expect(getRecordingHealth({
      ...base,
      pendingCount: 2,
    })).toMatchObject({ tone: 'warning', title: 'Сохраняем на устройстве' })
  })

  it('warns when speech has not been heard recently', () => {
    expect(getRecordingHealth({
      ...base,
      noRecentSound: true,
    })).toMatchObject({ tone: 'warning', title: 'Не слышно речи' })
  })

  it('turns capture errors into actionable mentor messages', () => {
    expect(humanizeRecordingError('__NO_AUDIO__')).toContain('Поделиться аудио')
    expect(humanizeRecordingError('__MIC_BUSY__')).toContain('Микрофон занят')
  })

  it('escalates a recognition that never connects instead of waiting forever', () => {
    const stalled = { ...base, isConnected: false }
    expect(getRecordingHealth({ ...stalled, disconnectedSeconds: 3 })).toMatchObject({ title: 'Подключаем распознавание…' })
    expect(getRecordingHealth({ ...stalled, disconnectedSeconds: 12 })).toMatchObject({ tone: 'warning', title: 'Подключение затянулось' })
    expect(getRecordingHealth({ ...stalled, disconnectedSeconds: 31 })).toMatchObject({ tone: 'danger', title: 'Текст не распознаётся' })
  })

  it('separates a cancelled picker from an OS-level screen recording ban', () => {
    expect(humanizeRecordingError('__CAPTURE_CANCELLED__')).toContain('закрыли окно выбора')
    expect(humanizeRecordingError('__SCREEN_PERMISSION_SYSTEM__')).toContain('Запись экрана')
    expect(humanizeRecordingError('__SAFARI__')).toContain('Chrome')
  })

  it('allows recording only in desktop Chromium browsers', () => {
    expect(isRecordingBrowserSupported(UA.chromeMac)).toBe(true)
    expect(isRecordingBrowserSupported(UA.edgeWin)).toBe(true)
    expect(isRecordingBrowserSupported(UA.safariMac)).toBe(false)
    expect(isRecordingBrowserSupported(UA.firefoxMac)).toBe(false)
    expect(isRecordingBrowserSupported(UA.chromeAndroid)).toBe(false)
  })

  it('names the silent side of a call', () => {
    expect(getRecordingHealth({ ...base, silentChannel: 'meeting' })).toMatchObject({ tone: 'warning', title: 'Не слышно собеседника' })
    expect(getRecordingHealth({ ...base, silentChannel: 'mic' })).toMatchObject({ tone: 'warning', title: 'Не слышно вас' })
    expect(getRecordingHealth({ ...base, silentChannel: null })).toMatchObject({ tone: 'good' })
  })
})
