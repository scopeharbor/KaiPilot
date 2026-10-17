import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VARIANT_LABELS,
  getServerVariant,
  getVariant,
  setVariant,
  subscribeVariant,
} from '@/lib/locale/variant-store'

const STORAGE_KEY = 'aiproj-text-variant'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.textVariant
  document.documentElement.lang = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('variant-store', () => {
  it('未设置时 getVariant 返回 cn', () => {
    expect(getVariant()).toBe('cn')
  })

  it('getServerVariant 恒为 cn（SSR 快照）', () => {
    expect(getServerVariant()).toBe('cn')
  })

  it('setVariant(tw)：写 localStorage、同步 html lang/属性并通知订阅者', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeVariant(fn)

    setVariant('tw')

    expect(localStorage.getItem(STORAGE_KEY)).toBe('tw')
    expect(document.documentElement.lang).toBe('zh-TW')
    expect(document.documentElement.dataset.textVariant).toBe('tw')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(getVariant()).toBe('tw')
    unsubscribe()
  })

  it('setVariant(hk)：lang=zh-HK、属性=hk', () => {
    setVariant('hk')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('hk')
    expect(document.documentElement.lang).toBe('zh-HK')
    expect(document.documentElement.dataset.textVariant).toBe('hk')
  })

  it('setVariant(cn)：lang=zh-CN、属性=cn', () => {
    setVariant('cn')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cn')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.documentElement.dataset.textVariant).toBe('cn')
  })

  it('退订后不再收到通知', () => {
    const fn = vi.fn()
    const unsubscribe = subscribeVariant(fn)
    unsubscribe()
    setVariant('tw')
    setVariant('cn')
    expect(fn).not.toHaveBeenCalled()
  })

  it('localStorage 中非法值回退 cn', () => {
    localStorage.setItem(STORAGE_KEY, 'jp')
    expect(getVariant()).toBe('cn')
    localStorage.setItem(STORAGE_KEY, '')
    expect(getVariant()).toBe('cn')
  })

  it('localStorage 抛错时 setVariant 仍同步属性并通知', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const fn = vi.fn()
    subscribeVariant(fn)
    setVariant('tw')
    expect(document.documentElement.lang).toBe('zh-TW')
    expect(document.documentElement.dataset.textVariant).toBe('tw')
    expect(fn).toHaveBeenCalled()
  })

  it('localStorage 抛错时 getVariant 回退 cn', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(getVariant()).toBe('cn')
  })

  it('VARIANT_LABELS 覆盖三个变体', () => {
    expect(VARIANT_LABELS.cn).toBe('简体中文')
    expect(VARIANT_LABELS.tw).toBe('繁體中文（台灣）')
    expect(VARIANT_LABELS.hk).toBe('繁體中文（香港）')
  })
})
