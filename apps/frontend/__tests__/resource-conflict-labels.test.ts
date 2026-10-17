import { describe, expect, it } from 'vitest'
import { RESOURCE_CONFLICT_TYPE_LABELS, resourceConflictTypeLabel } from '@/lib/api/resources'

describe('资源冲突类型标签', () => {
  it('映射覆盖后端 ResourceConflictService 全部 code', () => {
    expect(RESOURCE_CONFLICT_TYPE_LABELS).toEqual({
      overload: '分配比例超载',
      unavailable_allocation: '不可用期间分配',
      requirement_gap: '需求缺口',
      allocation_window_overflow: '分配窗口超出任务日期',
      illegal_reference: '非法资源引用',
    })
  })

  it('已知 code 返回简体中文标签', () => {
    expect(resourceConflictTypeLabel('overload')).toBe('分配比例超载')
    expect(resourceConflictTypeLabel('unavailable_allocation')).toBe('不可用期间分配')
    expect(resourceConflictTypeLabel('requirement_gap')).toBe('需求缺口')
    expect(resourceConflictTypeLabel('allocation_window_overflow')).toBe('分配窗口超出任务日期')
    expect(resourceConflictTypeLabel('illegal_reference')).toBe('非法资源引用')
  })

  it('未知 code 兜底显示原始码', () => {
    expect(resourceConflictTypeLabel('future_conflict_code')).toBe('future_conflict_code')
  })

  it('空值返回空字符串', () => {
    expect(resourceConflictTypeLabel(null)).toBe('')
    expect(resourceConflictTypeLabel(undefined)).toBe('')
  })
})
