/**
 * PMO Priority Scoring —— 前端 API client 和 hook 测试
 *
 * v3-pmo-priority-scoring-model §5.2
 */
import { describe, it, expect } from 'vitest'
import { priorityScoringKeys } from '@/lib/api/pmo-priority-scoring'

describe('priorityScoringKeys', () => {
  it('all key 稳定', () => {
    expect(priorityScoringKeys.all).toEqual(['pmo', 'priority-scoring'])
  })

  it('summary key 包含 version', () => {
    const key = priorityScoringKeys.summary('pmo-priority-v1')
    expect(key).toEqual(['pmo', 'priority-scoring', 'summary', 'pmo-priority-v1'])
  })

  it('summary key 无 version 时返回 undefined', () => {
    const key = priorityScoringKeys.summary()
    expect(key).toEqual(['pmo', 'priority-scoring', 'summary', undefined])
  })

  it('projects key 包含查询参数', () => {
    const key = priorityScoringKeys.projects({ page: 1, perPage: 20 })
    expect(key).toEqual(['pmo', 'priority-scoring', 'projects', { page: 1, perPage: 20 }])
  })

  it('groups key 包含 groupBy 和 version', () => {
    const key = priorityScoringKeys.groups('priority_level', 'pmo-priority-v1')
    expect(key).toEqual(['pmo', 'priority-scoring', 'groups', 'priority_level', 'pmo-priority-v1'])
  })

  it('weights key 包含 version', () => {
    const key = priorityScoringKeys.weights('pmo-priority-v1')
    expect(key).toEqual(['pmo', 'priority-scoring', 'weights', 'pmo-priority-v1'])
  })

  it('detail key 包含 projectId 和 version', () => {
    const key = priorityScoringKeys.detail(42, 'pmo-priority-v1')
    expect(key).toEqual(['pmo', 'priority-scoring', 'detail', 42, 'pmo-priority-v1'])
  })

  it('projects key 无参数时仍包含空对象', () => {
    const key = priorityScoringKeys.projects()
    expect(key).toEqual(['pmo', 'priority-scoring', 'projects', {}])
  })
})

describe('priority scoring query key stability', () => {
  it('summary keys 相同参数不变', () => {
    const k1 = priorityScoringKeys.summary('pmo-priority-v1')
    const k2 = priorityScoringKeys.summary('pmo-priority-v1')
    expect(k1).toEqual(k2)
  })

  it('projects keys 不同参数不等', () => {
    const k1 = priorityScoringKeys.projects({ page: 1 })
    const k2 = priorityScoringKeys.projects({ page: 2 })
    expect(k1).not.toEqual(k2)
  })

  it('weights keys 不同版本不等', () => {
    const k1 = priorityScoringKeys.weights('pmo-priority-v1')
    const k2 = priorityScoringKeys.weights()
    expect(k1).not.toEqual(k2)
  })
})
