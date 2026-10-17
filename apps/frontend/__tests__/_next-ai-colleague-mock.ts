/**
 * AI 同事 Store 测试替身（v3-ui-next-ai-colleague W2 测试辅助）。
 *
 * - 供 input / messages / panel 三个测试文件以 `vi.mock('@/stores/next-ai-colleague-store')`
 *   注入：工厂内 `await import('./_next-ai-colleague-mock')` 取同一单例，测试侧同样经
 *   `getColleagueStoreMock()` 拿到同一实例，保证「组件消费的 store」与「测试驱动的 store」
 *   完全同源；
 * - 状态与 action 签名严格对齐 design D2 §3 的 `NextAiColleagueState` 契约（含 W1 增补的
 *   `redrillPendingAction`）；开关类 action 同时记录调用并真实翻转 `isOpen`（与真实 Store
 *   语义一致，令受控 Dialog 的卸载路径在测试中可被断言）；
 * - `submitUserMessage` 等执行类 action 为纯 spy（零网络），由各测试直接断言调用载荷；
 * - 每个用例前调用 `reset()`：状态回初始值 + 清空全部 action 调用记录。
 */
import { create } from 'zustand'
import { vi } from 'vitest'
import type { ColleagueExecutionState, ColleagueMessage } from '@/stores/next-ai-colleague-store'

export interface MockColleaguePendingAction {
  toolName: string
  previewToken: string | null
  parameters: Record<string, unknown>
  diff: unknown
}

export interface MockColleagueStoreState {
  isOpen: boolean
  executionState: ColleagueExecutionState
  messages: ColleagueMessage[]
  pendingAction: MockColleaguePendingAction | null
  openPanel: () => void
  closePanel: () => void
  toggleOpen: () => void
  submitUserMessage: (text: string, context: unknown) => Promise<void>
  confirmPendingAction: (expectedPreviewToken?: string) => Promise<boolean>
  cancelPendingAction: () => void
  redrillPendingAction: () => Promise<void>
  clearMessages: () => void
  // 对话 / 模型 / 网页搜索（2026-09-26）
  conversations: Array<{
    id: string
    title: string
    updatedAt: number
    messages: ColleagueMessage[]
  }>
  conversationId: string
  openTabIds: string[]
  closeConversationTab: (id: string) => void
  modelPreference: { connectionId: number; modelId: number; label: string } | null
  webSearchEnabled: boolean
  newConversation: () => void
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  setModelPreference: (p: MockColleagueStoreState['modelPreference']) => void
  setWebSearchEnabled: (enabled: boolean) => void
}

/** zustand hook 的测试侧最小投影（仅测试使用的成员）。 */
export interface ColleagueStoreMockHandle {
  hook: {
    <U>(selector: (state: MockColleagueStoreState) => U): U
    getState: () => MockColleagueStoreState
    setState: (partial: Partial<MockColleagueStoreState>) => void
  }
  /** 状态回初始值 + 清空 action 调用记录（每个用例 beforeEach）。 */
  reset: () => void
}

let singleton: ColleagueStoreMockHandle | null = null

export function getColleagueStoreMock(): ColleagueStoreMockHandle {
  if (singleton) return singleton

  const hook = create<MockColleagueStoreState>()((set) => ({
    isOpen: false,
    executionState: 'idle',
    messages: [],
    pendingAction: null,

    openPanel: vi.fn(() => set({ isOpen: true })),
    closePanel: vi.fn(() => set({ isOpen: false })),
    toggleOpen: vi.fn(() => set((state) => ({ isOpen: !state.isOpen }))),
    // 执行/确认类 action 为纯 spy：零网络、零内部编排，由测试断言调用载荷。
    submitUserMessage: vi.fn(async (_text: string, _context: unknown) => {}),
    confirmPendingAction: vi.fn(async (_expectedPreviewToken?: string) => true),
    cancelPendingAction: vi.fn(() => {}),
    redrillPendingAction: vi.fn(async () => {}),
    clearMessages: vi.fn(() => set({ messages: [], executionState: 'idle', pendingAction: null })),
    conversations: [],
    conversationId: 'conv-test',
    openTabIds: ['conv-test'],
    closeConversationTab: vi.fn(() => {}),
    modelPreference: null,
    webSearchEnabled: false,
    newConversation: vi.fn(() => set({ messages: [] })),
    switchConversation: vi.fn(() => {}),
    deleteConversation: vi.fn(() => {}),
    setModelPreference: vi.fn((modelPreference) => set({ modelPreference })),
    setWebSearchEnabled: vi.fn((webSearchEnabled) => set({ webSearchEnabled })),
  }))

  singleton = {
    hook,
    reset: () => {
      hook.setState({ isOpen: false, executionState: 'idle', messages: [], pendingAction: null })
      const actions = hook.getState()
      for (const key of [
        'openPanel',
        'closePanel',
        'toggleOpen',
        'submitUserMessage',
        'confirmPendingAction',
        'cancelPendingAction',
        'redrillPendingAction',
        'clearMessages',
      ] as const) {
        ;(actions[key] as unknown as ReturnType<typeof vi.fn>).mockClear()
      }
    },
  }
  return singleton
}
