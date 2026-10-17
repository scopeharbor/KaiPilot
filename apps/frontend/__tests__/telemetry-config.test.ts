/**
 * v3-frontend-ai-usage-telemetry —— 测试：组织默认值生效且个人选择优先。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getOrganizationTelemetryDefault,
  setOrganizationTelemetryDefault,
  resolveTelemetryEnabled,
} from '../lib/telemetry/telemetry-config'

describe('telemetry-config', () => {
  beforeEach(() => {
    // 清除 localStorage 中的配置
    localStorage.removeItem('aiproj-telemetry-org-default')
    localStorage.removeItem('aiproj-telemetry-enabled')
  })

  afterEach(() => {
    // 清除 localStorage 中的配置
    localStorage.removeItem('aiproj-telemetry-org-default')
    localStorage.removeItem('aiproj-telemetry-enabled')
  })

  describe('组织级默认值', () => {
    it('默认启用', () => {
      expect(getOrganizationTelemetryDefault()).toBe(true)
    })

    it('可以设置为禁用', () => {
      setOrganizationTelemetryDefault(false)
      expect(getOrganizationTelemetryDefault()).toBe(false)
    })

    it('可以设置为启用', () => {
      setOrganizationTelemetryDefault(false)
      setOrganizationTelemetryDefault(true)
      expect(getOrganizationTelemetryDefault()).toBe(true)
    })
  })

  describe('个人选择优先', () => {
    it('个人选择优先于组织默认值', () => {
      // 组织默认禁用
      setOrganizationTelemetryDefault(false)

      // 个人选择启用
      expect(resolveTelemetryEnabled(true)).toBe(true)
    })

    it('个人选择禁用优先于组织默认启用', () => {
      // 组织默认启用
      setOrganizationTelemetryDefault(true)

      // 个人选择禁用
      expect(resolveTelemetryEnabled(false)).toBe(false)
    })

    it('无个人选择时使用组织默认值', () => {
      // 组织默认禁用
      setOrganizationTelemetryDefault(false)

      // 无个人选择（null）
      expect(resolveTelemetryEnabled(null)).toBe(false)
    })

    it('无个人选择且无组织默认值时默认启用', () => {
      // 无个人选择（null），无组织默认值
      expect(resolveTelemetryEnabled(null)).toBe(true)
    })
  })
})
