import { beforeEach, describe, expect, test } from 'vitest'
import { useCopilotStore } from '@/stores/copilot-store'
import type { CopilotMessage } from '@aiproj/types'

/**
 * 消息列表按 `messageId` 唯一——这是渲染层（React key）与业务层共同依赖的不变量。
 *
 * 背景：服务端 assistant 消息落库带 `idempotencyKey`，同一回合被重放时会如实返回
 * **同一条** assistant 消息。客户端若无条件追加，列表里就会出现两条相同 messageId，
 * React 报 "Encountered two children with the same key" 且气泡重影。
 * 幂等的服务端必须配幂等的客户端写入。
 */
function message(overrides: Partial<CopilotMessage> = {}): CopilotMessage {
  return {
    messageId: 'cpm_test_1',
    sessionId: 'cps_test',
    role: 'assistant',
    messageSummary: '第一次',
    sourceRefs: [],
    createdAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  } as CopilotMessage
}

describe('Copilot 消息列表按 messageId 去重', () => {
  beforeEach(() => {
    useCopilotStore.setState({ messages: [] })
  })

  test('同一 messageId 重复追加不会产生两条', () => {
    const store = useCopilotStore.getState()
    store.appendMessage(message())
    store.appendMessage(message())

    const { messages } = useCopilotStore.getState()
    expect(messages).toHaveLength(1)
    expect(new Set(messages.map((m) => m.messageId)).size).toBe(1)
  })

  test('重放以最新内容原地替换，且不改变原有顺序', () => {
    const store = useCopilotStore.getState()
    store.appendMessage(message({ messageId: 'cpm_a', messageSummary: 'A' }))
    store.appendMessage(message({ messageId: 'cpm_b', messageSummary: 'B' }))
    // 重放第一条（服务端幂等返回同一 messageId，内容可能已补全）
    store.appendMessage(message({ messageId: 'cpm_a', messageSummary: 'A（补全）' }))

    const { messages } = useCopilotStore.getState()
    expect(messages.map((m) => m.messageId)).toEqual(['cpm_a', 'cpm_b'])
    expect(messages[0]?.messageSummary).toBe('A（补全）')
  })

  test('不同 messageId 正常追加', () => {
    const store = useCopilotStore.getState()
    store.appendMessage(message({ messageId: 'cpm_1' }))
    store.appendMessage(message({ messageId: 'cpm_2' }))
    store.appendMessage(message({ messageId: 'cpm_3' }))

    expect(useCopilotStore.getState().messages.map((m) => m.messageId)).toEqual([
      'cpm_1',
      'cpm_2',
      'cpm_3',
    ])
  })

  test('用户消息与助手消息各自独立，不会互相覆盖', () => {
    const store = useCopilotStore.getState()
    store.appendMessage(message({ messageId: 'cpm_u', role: 'user', messageSummary: '问' }))
    store.appendMessage(message({ messageId: 'cpm_a', role: 'assistant', messageSummary: '答' }))

    const { messages } = useCopilotStore.getState()
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
})
