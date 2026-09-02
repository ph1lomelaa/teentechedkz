import { describe, expect, it } from 'vitest'
import { isRecoverableAppError, isRecoverableBrowserStateError, isStaleBuildError } from '@/App'

/**
 * Распознавание «вкладка старше выката».
 *
 * Ради чего: после каждого деплоя имена чанков меняются, и открытая вкладка при
 * переходе в раздел просит файл, которого больше нет. Пока это считалось
 * обычной ошибкой, человек видел «Экран не открылся» и звонил в поддержку —
 * хотя чинить было нечего, помогала перезагрузка.
 *
 * Формулировка у браузеров разная, поэтому проверяются все четыре вида, какие
 * реально встречаются. Ошибиться здесь можно в обе стороны, и обе плохи: не
 * узнать устаревшую сборку — оставить человека перед тупиком; принять за неё
 * настоящую поломку — устроить перезагрузку по кругу, где ошибка не видна.
 */
describe('isStaleBuildError', () => {
  it('узнаёт Safari: подменённый MIME-тип', () => {
    // Именно это видел пользователь: nginx отдавал index.html вместо чанка.
    expect(
      isStaleBuildError(new Error("'text/html' is not a valid JavaScript MIME type.")),
    ).toBe(true)
  })

  it('узнаёт Chrome и Firefox', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://teenteched.kz/assets/x-a1b2.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ]) {
      expect(isStaleBuildError(new Error(message))).toBe(true)
    }
  })

  it('узнаёт ChunkLoadError по имени, а не только по тексту', () => {
    const error = new Error('Loading chunk 42 failed')
    error.name = 'ChunkLoadError'
    expect(isStaleBuildError(error)).toBe(true)
  })

  it('не принимает обычную поломку за устаревшую сборку', () => {
    // Перезагрузка тут не поможет, а зациклит: настоящая ошибка должна
    // доехать до экрана и быть видимой.
    for (const message of [
      "Cannot read properties of undefined (reading 'map')",
      'Network Error',
      'students.filter is not a function',
    ]) {
      expect(isStaleBuildError(new Error(message))).toBe(false)
    }
  })
})

describe('isRecoverableBrowserStateError', () => {
  it('узнаёт NotFoundError Firefox, возникающий в устаревшей вкладке', () => {
    const error = new DOMException('The object can not be found here.', 'NotFoundError')
    expect(isRecoverableBrowserStateError(error)).toBe(true)
  })

  it('не перезагружает вкладку из-за произвольного NotFoundError', () => {
    expect(isRecoverableBrowserStateError(new DOMException('Устройство не найдено', 'NotFoundError'))).toBe(false)
  })

  it('узнаёт варианты DOM-мутаций React', () => {
    for (const message of [
      "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      "Failed to execute 'insertBefore' on 'Node': The node to be inserted is not a child of this node.",
    ]) {
      expect(isRecoverableBrowserStateError(new DOMException(message, 'NotFoundError'))).toBe(true)
    }
  })

  it('объединяет ошибки устаревшей сборки и DOM в единый путь восстановления', () => {
    expect(isRecoverableAppError(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isRecoverableAppError(new DOMException('The object can not be found here.', 'NotFoundError'))).toBe(true)
  })
})
