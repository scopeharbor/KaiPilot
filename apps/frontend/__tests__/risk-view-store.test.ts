import { beforeEach, describe, expect, test } from 'vitest'
import { useRiskViewStore } from '@/stores/risk-view-store'

describe('stores/risk-view-store', () => {
  beforeEach(() => {
    useRiskViewStore.getState().resetSuggestions()
    useRiskViewStore.getState().setMatrixBasis('inherent')
    useRiskViewStore.getState().setCategoryFilter(null)
    useRiskViewStore.getState().setStatusFilter(null)
    useRiskViewStore.getState().setAiDrawerOpen(false)
  })

  test('matrixBasis 默认 inherent', () => {
    expect(useRiskViewStore.getState().matrixBasis).toBe('inherent')
  })

  test('setMatrixBasis 切换残余', () => {
    useRiskViewStore.getState().setMatrixBasis('residual')
    expect(useRiskViewStore.getState().matrixBasis).toBe('residual')
  })

  test('categoryFilter 默认 null', () => {
    expect(useRiskViewStore.getState().categoryFilter).toBeNull()
  })

  test('setCategoryFilter 设置类别', () => {
    useRiskViewStore.getState().setCategoryFilter('technical')
    expect(useRiskViewStore.getState().categoryFilter).toBe('technical')
  })

  test('setCategoryFilter 清除类别', () => {
    useRiskViewStore.getState().setCategoryFilter('technical')
    useRiskViewStore.getState().setCategoryFilter(null)
    expect(useRiskViewStore.getState().categoryFilter).toBeNull()
  })

  test('statusFilter 默认 null', () => {
    expect(useRiskViewStore.getState().statusFilter).toBeNull()
  })

  test('setStatusFilter 设置状态', () => {
    useRiskViewStore.getState().setStatusFilter('analyzing')
    expect(useRiskViewStore.getState().statusFilter).toBe('analyzing')
  })

  test('aiDrawerOpen 默认 false', () => {
    expect(useRiskViewStore.getState().aiDrawerOpen).toBe(false)
  })

  test('setAiDrawerOpen 打开/关闭', () => {
    useRiskViewStore.getState().setAiDrawerOpen(true)
    expect(useRiskViewStore.getState().aiDrawerOpen).toBe(true)
    useRiskViewStore.getState().setAiDrawerOpen(false)
    expect(useRiskViewStore.getState().aiDrawerOpen).toBe(false)
  })

  test('markAccepted 添加到 accepted 集合', () => {
    useRiskViewStore.getState().markAccepted('batch-1')
    expect(useRiskViewStore.getState().acceptedSuggestionIds.has('batch-1')).toBe(true)
  })

  test('markRejected 添加到 rejected 集合', () => {
    useRiskViewStore.getState().markRejected('batch-2')
    expect(useRiskViewStore.getState().rejectedSuggestionIds.has('batch-2')).toBe(true)
  })

  test('resetSuggestions 清空 accepted 和 rejected', () => {
    useRiskViewStore.getState().markAccepted('batch-1')
    useRiskViewStore.getState().markRejected('batch-2')
    useRiskViewStore.getState().resetSuggestions()
    expect(useRiskViewStore.getState().acceptedSuggestionIds.size).toBe(0)
    expect(useRiskViewStore.getState().rejectedSuggestionIds.size).toBe(0)
  })

  test('多次 markAccepted 不重复', () => {
    useRiskViewStore.getState().markAccepted('batch-1')
    useRiskViewStore.getState().markAccepted('batch-1')
    expect(useRiskViewStore.getState().acceptedSuggestionIds.size).toBe(1)
  })

  test('accepted 和 rejected 互不影响', () => {
    useRiskViewStore.getState().markAccepted('batch-1')
    useRiskViewStore.getState().markRejected('batch-2')
    expect(useRiskViewStore.getState().acceptedSuggestionIds.has('batch-1')).toBe(true)
    expect(useRiskViewStore.getState().acceptedSuggestionIds.has('batch-2')).toBe(false)
    expect(useRiskViewStore.getState().rejectedSuggestionIds.has('batch-2')).toBe(true)
    expect(useRiskViewStore.getState().rejectedSuggestionIds.has('batch-1')).toBe(false)
  })
})
