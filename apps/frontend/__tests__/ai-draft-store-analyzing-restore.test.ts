/**
 * AI 快速创建：刷新时「分析中」不原样恢复（否则卡在正在分析、重新分析按钮禁用）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ClarificationCard } from '@aiproj/types'
import {
  AI_PROJECT_DRAFT_STORAGE_KEY,
  persistableDraftStatus,
  useAiProjectDraftStore,
} from '@/stores/ai-project-draft-store'

const card = { field: 'startDate' } as unknown as ClarificationCard

function persistedStatus() {
  const raw = sessionStorage.getItem(AI_PROJECT_DRAFT_STORAGE_KEY)
  return raw ? (JSON.parse(raw) as { state: { status: string } }).state.status : null
}

describe('persistableDraftStatus', () => {
  it('分析中且已有问题卡：回到澄清，让用户重新作答当前卡', () => {
    expect(persistableDraftStatus({ status: 'analyzing', cards: [card], activeCard: null })).toBe(
      'clarifying',
    )
    expect(persistableDraftStatus({ status: 'analyzing', cards: [], activeCard: card })).toBe(
      'clarifying',
    )
  })

  it('首次分析中（还没有问题卡）：回到输入', () => {
    expect(persistableDraftStatus({ status: 'analyzing', cards: [], activeCard: null })).toBe(
      'idle',
    )
  })

  it('其他状态原样保留', () => {
    for (const status of ['idle', 'clarifying', 'ready', 'error'] as const) {
      expect(persistableDraftStatus({ status, cards: [card], activeCard: card })).toBe(status)
    }
  })
})

describe('useAiProjectDraftStore 落盘', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAiProjectDraftStore.setState({ status: 'idle', cards: [], activeCard: null })
  })

  it('开始分析后存储里是可恢复的状态，而不是「分析中」', () => {
    useAiProjectDraftStore.setState({ cards: [card], activeCard: card, status: 'clarifying' })
    useAiProjectDraftStore.getState().startAnalyzing()
    expect(useAiProjectDraftStore.getState().status).toBe('analyzing')
    expect(persistedStatus()).toBe('clarifying')
  })
})
