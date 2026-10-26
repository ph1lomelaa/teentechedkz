import { describe, expect, it } from 'vitest'
import { givenName } from './personName'

describe('givenName', () => {
  it('Фамилия Имя Отчество → Имя', () => expect(givenName('Жаксылыков Данияр Асханович')).toBe('Данияр'))
  it('Фамилия Имя → Имя', () => expect(givenName('Касымова Томирис')).toBe('Томирис'))
  it('одно слово — оно и есть', () => expect(givenName('Данияр')).toBe('Данияр'))
  it('подпись после « · » и знаки без букв не считаются именем', () => {
    expect(givenName('Алина · ученица')).toBe('Алина')
    expect(givenName('·', '')).toBe('')
  })
  it('лишние пробелы не мешают', () => expect(givenName('  Алимов   Бекзат  ')).toBe('Бекзат'))
  it('пусто — запасной вариант', () => {
    expect(givenName('')).toBe('студент')
    expect(givenName(undefined)).toBe('студент')
    expect(givenName(null, 'друг')).toBe('друг')
  })
})
