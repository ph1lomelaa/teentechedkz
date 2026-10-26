import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { NoteSessionPage } from './NoteSessionPage'
vi.mock('@/api/notes', () => ({ notesApi: {
  getSession: async () => ({ id:'s1',title:'Тест импорта',student_id:'student1',student_name:'Тестовый студент',status:'draft',language:'ru',capture_mode:'browser',transcripts:[],source:'workspace',created_at:'2026-10-19',started_at:'2026-10-19' }),
  heartbeatSession: async () => undefined,
} }))
vi.mock('@/api/integrations', () => ({ integrationsApi: { zoomStatus: async () => ({ bot_enabled: true, available: false }) } }))
vi.mock('@/hooks/useDeepgramTranscription', () => ({ useDeepgramTranscription: () => ({ isConnected: false,isCapturing:false,start:vi.fn(),stop:vi.fn(),retryNow:vi.fn() }) }))
vi.mock('@/hooks/useAudioBackupRecorder', () => ({ useAudioBackupRecorder: () => ({ uploadedCount:0,segmentCount:0,start:vi.fn(),stop:vi.fn() }) }))
it.each(['/notes/session/s1', '/workspace/meetings/session/s1'])('makes both import methods reachable in %s', async url => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry:false } } })}><MemoryRouter initialEntries={[url]}><Routes><Route path="/notes/session/:id" element={<NoteSessionPage />} /><Route path="/workspace/meetings/session/:id" element={<NoteSessionPage />} /></Routes></MemoryRouter></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name:'Из Google Drive' }))
  const input=screen.getByLabelText('Ссылка на запись Google Drive')
  expect(input).toBeVisible()
  fireEvent.change(input,{target:{value:'https://drive.google.com/file/d/recording12345/view'}})
  fireEvent.click(screen.getByRole('button',{name:'Загрузить запись'}))
  expect(screen.getByRole('button',{name:'Загрузить и собрать конспект'})).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:'Из Google Drive'}))
  expect(screen.getByLabelText('Ссылка на запись Google Drive')).toHaveValue('https://drive.google.com/file/d/recording12345/view')
})
