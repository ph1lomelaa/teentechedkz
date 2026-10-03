import { describe, expect, it } from 'vitest'
import {
  botBarLabel,
  botNeedsAttention,
  botStatusView,
  botStepIndex,
  detectMeetingPlatform,
  isBotActive,
} from './meetingBotUi'

describe('meeting bot UI', () => {
  it('recognises the platforms the bot can join', () => {
    expect(detectMeetingPlatform('https://us02web.zoom.us/j/8123456789?pwd=x')).toBe('zoom')
    expect(detectMeetingPlatform('meet.google.com/abc-defg-hij')).toBe('google_meet')
    expect(detectMeetingPlatform('https://teams.microsoft.com/l/meetup-join/19%3a')).toBe('teams')
  })

  it('rejects links the bot cannot open', () => {
    for (const url of ['https://t.me/+abc', 'https://telemost.yandex.ru/j/1', 'https://zoom.us/pricing', 'https://meet.google.com/', 'javascript:alert(1)', '']) {
      expect(detectMeetingPlatform(url)).toBeNull()
    }
  })

  it('walks the steps in order', () => {
    expect(botStepIndex('joining')).toBe(1)
    expect(botStepIndex('waiting_room')).toBe(1)
    expect(botStepIndex('recording')).toBe(2)
    expect(botStepIndex('processing')).toBe(3)
    expect(botStepIndex('done')).toBe(4)
    expect(botStepIndex('failed', false)).toBe(1)
    expect(botStepIndex('failed', true)).toBe(2)
  })

  it('asks the mentor to act when the bot is stuck at the door', () => {
    expect(botNeedsAttention('waiting_room')).toBe(true)
    expect(botNeedsAttention('recording')).toBe(false)
    expect(botStatusView({ status: 'waiting_room', platform: 'google_meet' })).toMatchObject({ tone: 'attention', title: 'Впустите бота в звонок' })
  })

  it('reminds Zoom hosts not to leave early', () => {
    expect(botStatusView({ status: 'recording', platform: 'zoom' }).description).toContain('Не выходите из Zoom')
    expect(botStatusView({ status: 'recording', platform: 'google_meet' }).description).not.toContain('Zoom')
  })

  it('shows the server reason when recording failed', () => {
    const view = botStatusView({ status: 'failed', platform: 'zoom', reasonMessage: 'Бота не впустили в звонок.' })
    expect(view).toMatchObject({ tone: 'danger', title: 'Запись не идёт', description: 'Бота не впустили в звонок.' })
  })

  it('treats only unfinished bots as active', () => {
    expect(isBotActive('processing')).toBe(true)
    expect(isBotActive('done')).toBe(false)
    expect(isBotActive('failed')).toBe(false)
    expect(isBotActive(null)).toBe(false)
    expect(botBarLabel('waiting_room')).toBe('Впустите бота в звонок')
  })
})

describe('recording file upload', () => {
  it('accepts phone and messenger recordings', async () => {
    const { isAcceptedRecordingFile } = await import('./meetingBotUi')
    expect(isAcceptedRecordingFile({ name: 'call.m4a', type: '', size: 5_000_000 })).toBe(true)
    expect(isAcceptedRecordingFile({ name: 'voice', type: 'audio/ogg', size: 10_000 })).toBe(true)
    expect(isAcceptedRecordingFile({ name: 'IMG_1.MOV', type: 'video/quicktime', size: 50_000_000 })).toBe(true)
  })

  it('rejects documents, empty and oversized files', async () => {
    const { isAcceptedRecordingFile, MAX_RECORDING_FILE_BYTES } = await import('./meetingBotUi')
    expect(isAcceptedRecordingFile({ name: 'notes.pdf', type: 'application/pdf', size: 1000 })).toBe(false)
    expect(isAcceptedRecordingFile({ name: 'a.mp3', type: 'audio/mpeg', size: 0 })).toBe(false)
    expect(isAcceptedRecordingFile({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_RECORDING_FILE_BYTES + 1 })).toBe(false)
  })

  it('formats sizes for mentors', async () => {
    const { formatFileSize } = await import('./meetingBotUi')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 МБ')
    expect(formatFileSize(300)).toBe('1 КБ')
  })
})
