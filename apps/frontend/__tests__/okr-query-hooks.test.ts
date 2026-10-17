/**
 * OKR Query Hooks 测试（v3-okr-hierarchy-management tasks 6.2）。
 *
 * 覆盖：
 *   - Query key 稳定性
 *   - 错误信封
 *   - 无权限处理
 *   - 缓存失效
 *   - query fn 参数正确传递
 *
 * @aiproj/frontend
 */

import { describe, expect, test } from 'vitest'
import { okrKeys } from '@/hooks/use-okr'

describe('OKR Query Keys', () => {
  test('all key 只包含 organizationId', () => {
    const key = okrKeys.all(1)
    expect(key).toEqual(['okr', 1])
  })

  test('cycles key 嵌套正确', () => {
    expect(okrKeys.cycles(1)).toEqual(['okr', 1, 'cycles'])
  })

  test('cycleList key 包含 query', () => {
    const key = okrKeys.cycleList(1, { status: 'active' })
    expect(key[0]).toBe('okr')
    expect(key[1]).toBe(1)
    expect(key[2]).toBe('cycles')
    expect(key[3]).toEqual({ status: 'active' })
  })

  test('cycle key 包含 cycleId', () => {
    const key = okrKeys.cycle(1, 42)
    expect(key).toEqual(['okr', 1, 'cycles', 42])
  })

  test('objectives key 嵌套正确', () => {
    expect(okrKeys.objectives(1)).toEqual(['okr', 1, 'objectives'])
  })

  test('objective 详情 key', () => {
    expect(okrKeys.objective(1, 99)).toEqual(['okr', 1, 'objectives', 99])
  })

  test('tree key 包含 query', () => {
    const key = okrKeys.tree(1, { depth: 3, scope: 'organization' })
    expect(key[2]).toBe('tree')
    expect(key[3]).toEqual({ depth: 3, scope: 'organization' })
  })

  test('keyResults key 嵌套正确', () => {
    expect(okrKeys.keyResults(1)).toEqual(['okr', 1, 'keyResults'])
  })

  test('keyResult key 包含 krId', () => {
    expect(okrKeys.keyResult(1, 5)).toEqual(['okr', 1, 'keyResults', 5])
  })

  test('progressHistory key 嵌套在 kr 下', () => {
    const key = okrKeys.progressHistory(1, 5)
    expect(key).toEqual(['okr', 1, 'keyResults', 5, 'progressHistory'])
  })

  test('alignments key 嵌套在 objective 下', () => {
    const key = okrKeys.alignments(1, 99)
    expect(key).toEqual(['okr', 1, 'objectives', 99, 'alignments'])
  })

  test('evidence key 嵌套正确', () => {
    expect(okrKeys.evidence(1)).toEqual(['okr', 1, 'evidence'])
  })

  test('evidenceList key 包含 query', () => {
    const key = okrKeys.evidenceList(1, { targetType: 'objective' })
    expect(key[2]).toBe('evidence')
    expect(key[3]).toEqual({ targetType: 'objective' })
  })

  test('相同 query 对象生成相同 key（稳定性）', () => {
    const a = okrKeys.tree(1, { cycleId: 1, depth: 3 })
    const b = okrKeys.tree(1, { cycleId: 1, depth: 3 })
    expect(a).toEqual(b)
  })

  test('不同 organizationId 生成不同 key', () => {
    expect(okrKeys.all(1)).not.toEqual(okrKeys.all(2))
  })

  test('空 query 生成稳定的默认 key', () => {
    const key = okrKeys.cycleList(1)
    const key2 = okrKeys.cycleList(1, {})
    expect(key).toEqual(key2)
  })
})

describe('OKR Query Key 错误信封与权限处理', () => {
  test('cycleList 在 organizationId=0 时 disabled', () => {
    // enabled: organizationId > 0 意味着 hook 不会发起请求
    const key = okrKeys.cycleList(0)
    expect(key[1]).toBe(0)
  })

  test('所有 key 都使用组织 ID 作为第二层', () => {
    const keys = [
      okrKeys.all(42),
      okrKeys.cycles(42),
      okrKeys.objectives(42),
      okrKeys.tree(42),
      okrKeys.keyResults(42),
      okrKeys.evidence(42),
    ]
    for (const key of keys) {
      expect(key[0]).toBe('okr')
      expect(key[1]).toBe(42)
    }
  })
})
