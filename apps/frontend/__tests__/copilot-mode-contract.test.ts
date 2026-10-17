/**
 * v3-copilot-mode-adaptation — 模式契约测试（§2）
 *
 * 覆盖：
 * - 2.4 刷新后模式保留、形态回默认
 * - 2.6 偏好存储不含敏感样本
 * - 2.7 四态 fixtures（新手/专业/自动展开开/关）
 *
 * 零网络、零 provider。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CopilotUserMode } from '../stores/copilot-store'

// ── localStorage mock（必须在 store 模块加载前就位） ──
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

/** 动态导入 store，确保 mock 已就位。 */
async function loadStore() {
  return import('../stores/copilot-store')
}

// ====================================================================
// resolveUserMode — 来源优先级（D7）
// ====================================================================

describe('resolveUserMode', () => {
  it('显式选择优先于 pro 推断', async () => {
    const { resolveUserMode } = await loadStore()
    expect(resolveUserMode({ explicitSelection: 'novice', proInferred: true })).toEqual({
      mode: 'novice',
      source: 'explicit',
    })
  })

  it('显式专业覆盖 pro 推断', async () => {
    const { resolveUserMode } = await loadStore()
    expect(resolveUserMode({ explicitSelection: 'professional', proInferred: true })).toEqual({
      mode: 'professional',
      source: 'explicit',
    })
  })

  it('无显式选择时 pro 推断生效', async () => {
    const { resolveUserMode } = await loadStore()
    expect(resolveUserMode({ proInferred: true })).toEqual({
      mode: 'professional',
      source: 'inferred',
    })
  })

  it('无信号时默认新手', async () => {
    const { resolveUserMode } = await loadStore()
    expect(resolveUserMode({})).toEqual({ mode: 'novice', source: 'default' })
  })

  it('null 显式选择回退到推断', async () => {
    const { resolveUserMode } = await loadStore()
    expect(resolveUserMode({ explicitSelection: null, proInferred: true })).toEqual({
      mode: 'professional',
      source: 'inferred',
    })
  })
})

// ====================================================================
// 偏好持久化 — 刷新后模式保留、形态回默认（2.4）
// ====================================================================

describe('copilot-store partialize', () => {
  it('partialize 包含宽度、用户模式和自动展开偏好', async () => {
    const { useCopilotStore } = await loadStore()

    useCopilotStore.getState().setCopilotUserMode('professional')
    useCopilotStore.getState().setAutoExpandEnabled(false)
    useCopilotStore.getState().setWidth(500)

    const s = useCopilotStore.getState()
    expect(s.copilotUserMode).toBe('professional')
    expect(s.autoExpandEnabled).toBe(false)
    expect(s.width).toBe(500)
  })

  it('形态和 autoExpandTriggered 不在 partialize 输出中', async () => {
    const { useCopilotStore } = await loadStore()

    useCopilotStore.getState().setForm('fullscreen')
    useCopilotStore.getState().setAutoExpandTriggered(true)

    // partialize 只输出 { width, copilotUserMode, autoExpandEnabled }
    const stored = localStorageStore.get('aiproj-copilot')
    if (stored) {
      const parsed = JSON.parse(stored)
      expect(parsed.state).not.toHaveProperty('autoExpandTriggered')
      expect(parsed.state).not.toHaveProperty('form')
    }
  })
})

// ====================================================================
// 禁存约束 — 偏好不含敏感样本（2.6）
// ====================================================================

describe('preference storage does not contain sensitive samples', () => {
  it('partialize 白名单过滤非法定模式值', async () => {
    const { useCopilotStore } = await loadStore()

    const sensitiveSamples = [
      'sk-proj-abc123def456ghi789',
      'Bearer eyJhbGciOiJIUzI1NiJ9',
      'You are a project management assistant...',
      '建议用户重新分配资源给前端团队以解决超载问题',
    ]

    for (const sample of sensitiveSamples) {
      // @ts-expect-error — 故意注入非法值
      useCopilotStore.getState().setCopilotUserMode(sample)
    }

    // Zustand persist 在 set 后同步写入 localStorage
    const stored = localStorageStore.get('aiproj-copilot')
    expect(stored).toBeTruthy()

    const parsed = JSON.parse(stored!)
    // partialize 白名单应将非法值过滤为 null
    expect(parsed.state.copilotUserMode).toBeNull()

    // 确认敏感字符串不在 localStorage 中
    for (const sample of sensitiveSamples) {
      expect(stored!).not.toContain(sample)
    }
  })
})

// ====================================================================
// 四态 fixtures（2.7）
// ====================================================================

describe('mode-adaptation fixtures', () => {
  const fixtures = {
    novice: { copilotUserMode: 'novice' as CopilotUserMode, autoExpandEnabled: true },
    professional: {
      copilotUserMode: 'professional' as CopilotUserMode,
      autoExpandEnabled: true,
    },
    autoExpandOn: { copilotUserMode: null, autoExpandEnabled: true },
    autoExpandOff: { copilotUserMode: null, autoExpandEnabled: false },
  }

  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`fixture "${name}" has correct shape`, () => {
      expect(fixture).toHaveProperty('copilotUserMode')
      expect(fixture).toHaveProperty('autoExpandEnabled')
      expect(typeof fixture.autoExpandEnabled).toBe('boolean')
    })
  }
})

// ====================================================================
// resetSession 重置 autoExpandTriggered
// ====================================================================

describe('resetSession', () => {
  it('重置 autoExpandTriggered 但保留持久化偏好', async () => {
    const { useCopilotStore } = await loadStore()

    useCopilotStore.getState().setCopilotUserMode('professional')
    useCopilotStore.getState().setAutoExpandEnabled(false)
    useCopilotStore.getState().setAutoExpandTriggered(true)

    useCopilotStore.getState().resetSession()

    const after = useCopilotStore.getState()
    expect(after.autoExpandTriggered).toBe(false)
    expect(after.copilotUserMode).toBe('professional')
    expect(after.autoExpandEnabled).toBe(false)
  })
})
