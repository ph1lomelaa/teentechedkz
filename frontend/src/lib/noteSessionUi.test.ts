import { describe, expect, it } from 'vitest'
import {
  formatRecordingDuration,
  getRecordingHealth,
  humanizeRecordingError,
} from './noteSessionUi'

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
})
