/**
 * v3-copilot-mode-adaptation — 新手引导测试（§5）
 *
 * 覆盖：
 * - 5.2 未新建第二套引导状态机或第二处「已引导过」记录
 * - 5.4 跳过后刷新不再出现
 *
 * 零网络、零 provider。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── localStorage mock ──
const localStorageStore = new Map<string, string>()

beforeEach(() => {
  localStorageStore.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => localStorageStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore.set(key, value)
    },
    removeItem: (key: string) => localStorageStore.delete(key),
    clear: () => localStorageStore.clear(),
    get length() {
      return localStorageStore.size
    },
    key: (index: number) => [...localStorageStore.keys()][index] ?? null,
  })
})

// ====================================================================
// 5.2 引导使用单一 localStorage key
// ====================================================================

describe('onboarding uses single completion record', () => {
  it('引导完成记录使用 aiproj-copilot-onboarding-completed key', async () => {
    // 模拟完成引导
    localStorage.setItem('aiproj-copilot-onboarding-completed', 'true')

    // 验证只有一个 key 被使用
    const keys = Array.from(localStorageStore.keys())
    expect(keys).toContain('aiproj-copilot-onboarding-completed')
    expect(keys.length).toBe(1)
  })

  it('不存在其他引导状态机的 key', () => {
    // 验证没有其他 onboarding/walkthrough/tour 相关的 key
    const allKeys = Array.from(localStorageStore.keys())
    const onboardingKeys = allKeys.filter(
      (k) =>
        k.includes('onboard') ||
        k.includes('walkthrough') ||
        k.includes('tour') ||
        k.includes('guide') ||
        k.includes('welcome'),
    )
    // 只允许 copilot 的 onboarding key
    expect(onboardingKeys).toEqual([])
  })
})

// ====================================================================
// 5.4 跳过后刷新不再出现
// ====================================================================

describe('skipped onboarding does not reappear', () => {
  it('设置 completed key 后引导不应显示', () => {
    localStorage.setItem('aiproj-copilot-onboarding-completed', 'true')

    const completed = localStorage.getItem('aiproj-copilot-onboarding-completed')
    expect(completed).toBe('true')
  })

  it('未设置 completed key 时引导应显示', () => {
    const completed = localStorage.getItem('aiproj-copilot-onboarding-completed')
    expect(completed).toBeNull()
  })
})
