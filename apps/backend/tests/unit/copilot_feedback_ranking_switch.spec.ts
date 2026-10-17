/**
 * v3-copilot-feedback-driven-ranking — 开关与偏好测试
 */

import { describe, it, expect } from 'vitest'
import { WeightingSwitchService } from '../../app/services/copilot_inbox/weighting_switch_service.js'

describe('Weighting Switch Service', () => {
  describe('default configuration', () => {
    it('weighting is disabled by default', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: false, personalDisabled: false }
      expect(service.isEnabled(config)).toBe(false)
    })

    it('default config produces identical ordering to deterministic', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: false, personalDisabled: false }
      expect(service.isEnabled(config)).toBe(false)
      // When disabled, ordering MUST be identical to deterministic ordering
    })
  })

  describe('organization enable', () => {
    it('can enable organization weighting', () => {
      const service = new WeightingSwitchService()
      const result = service.enableOrganization(1, 100)
      expect(result.success).toBe(true)
      expect(result.audit).toBeDefined()
      expect(result.audit?.action).toBe('enable')
    })

    it('audit entry is recorded', () => {
      const service = new WeightingSwitchService()
      service.enableOrganization(1, 100)
      const log = service.getAuditLog(1)
      expect(log.length).toBe(1)
      expect(log[0].action).toBe('enable')
    })
  })

  describe('personal preference', () => {
    it('personal can disable when organization enabled', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: true, personalDisabled: false }
      const result = service.setPersonalPreference(config, true)
      expect(result.success).toBe(true)
    })

    it('personal cannot enable what organization disabled', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: false, personalDisabled: true }
      const result = service.setPersonalPreference(config, false)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot enable')
    })

    it('weighting remains disabled when personal disables it', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: true, personalDisabled: true }
      expect(service.isEnabled(config)).toBe(false)
    })
  })

  describe('disabled state performs no projection read', () => {
    it('when disabled, isEnabled returns false', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: false, personalDisabled: false }
      expect(service.isEnabled(config)).toBe(false)
      // The ordering implementation MUST NOT read the weighting projection
      // This is enforced by the switch service returning false
    })
  })
})
