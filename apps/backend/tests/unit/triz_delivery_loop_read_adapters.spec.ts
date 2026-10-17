/**
 * v3-triz-to-delivery-closed-loop —— adapters 纯逻辑单测（tasks 5.1/5.3/5.5/5.7）。
 *
 * 覆盖：registry 闭集负例（重复/未知 kind）、四组状态标准化映射全矩阵
 * （含 on_hold/at_risk/missed/planned 边界与未知值 fail closed）、context 映射
 * 不含完成语义篡改。零数据库。
 */
import { describe, expect, it } from 'vitest'

import {
  TrizDlClosedAdapterRegistry,
  TrizDlAdapterRegistryError,
  isContextKind,
  isRequiredDeliveryKind,
} from '../../app/services/triz_delivery_loop/read_adapters.js'
import {
  mapTaskStatus,
  mapMilestoneStatus,
  mapContextStatus,
} from '../../app/services/triz_delivery_loop/default_read_adapters.js'
import type { TrizDlClosedDeliveryPort } from '../../app/services/triz_delivery_loop/read_adapters.js'

const fakePort = (kind: TrizDlClosedDeliveryPort['kind']): TrizDlClosedDeliveryPort => ({
  kind,
  fetchSummaries: async () => new Map(),
})

describe('closed adapter registry', () => {
  it('闭集注册与读取', () => {
    const reg = new TrizDlClosedAdapterRegistry()
      .register(fakePort('task'))
      .register(fakePort('milestone'))
      .register(fakePort('risk'))
      .register(fakePort('change_request'))
    expect(reg.registeredKinds()).toEqual(['change_request', 'milestone', 'risk', 'task'])
    expect(reg.require('task').kind).toBe('task')
    expect(reg.get('risk')!.kind).toBe('risk')
  })

  it('重复注册拒绝', () => {
    const reg = new TrizDlClosedAdapterRegistry().register(fakePort('task'))
    expect(() => reg.register(fakePort('task'))).toThrow(TrizDlAdapterRegistryError)
  })

  it('kind 划分闭集一致：required 与 context 不相交且并集为全部 kind', () => {
    expect(isRequiredDeliveryKind('task')).toBe(true)
    expect(isRequiredDeliveryKind('milestone')).toBe(true)
    expect(isRequiredDeliveryKind('risk')).toBe(false)
    expect(isContextKind('risk')).toBe(true)
    expect(isContextKind('change_request')).toBe(true)
    expect(isContextKind('task')).toBe(false)
  })
})

describe('状态标准化映射全矩阵', () => {
  it('task 六态逐一映射；on_hold 归 blocked；未知值 null', () => {
    expect(mapTaskStatus('not_started')).toBe('not_started')
    expect(mapTaskStatus('in_progress')).toBe('in_progress')
    expect(mapTaskStatus('completed')).toBe('completed')
    expect(mapTaskStatus('blocked')).toBe('blocked')
    expect(mapTaskStatus('on_hold')).toBe('blocked')
    expect(mapTaskStatus('cancelled')).toBe('cancelled')
    expect(mapTaskStatus('done_guessed')).toBeNull()
  })

  it('milestone 五态：planned→not_started、at_risk/missed→blocked、achieved→completed', () => {
    expect(mapMilestoneStatus('not_started')).toBe('not_started')
    expect(mapMilestoneStatus('planned')).toBe('not_started')
    expect(mapMilestoneStatus('at_risk')).toBe('blocked')
    expect(mapMilestoneStatus('missed')).toBe('blocked')
    expect(mapMilestoneStatus('achieved')).toBe('completed')
    expect(mapMilestoneStatus('half_done')).toBeNull()
  })

  it('context 映射：不产生“参与 completion 判定”的歧义值（仅展示性标准化）', () => {
    // risk
    expect(mapContextStatus('risk', 'identified')).toBe('not_started')
    expect(mapContextStatus('risk', 'mitigating')).toBe('in_progress')
    expect(mapContextStatus('risk', 'resolved')).toBe('completed')
    expect(mapContextStatus('risk', 'accepted')).toBe('cancelled')
    expect(mapContextStatus('risk', 'mystery')).toBeNull()
    // change_request
    expect(mapContextStatus('change_request', 'draft')).toBe('not_started')
    expect(mapContextStatus('change_request', 'under_review')).toBe('in_progress')
    expect(mapContextStatus('change_request', 'implemented')).toBe('completed')
    expect(mapContextStatus('change_request', 'rejected')).toBe('cancelled')
    expect(mapContextStatus('change_request', 'whatever')).toBeNull()
    // 未知 kind 一律 null
    expect(mapContextStatus('task', 'completed')).toBeNull()
  })
})
