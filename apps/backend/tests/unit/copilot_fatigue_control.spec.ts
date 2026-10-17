/**
 * v3-copilot-proactive-triggers-and-fatigue-control — 疲劳控制服务单元测试
 *
 * 覆盖 spec REQ：
 * - per-kind cap 与 global cap 分别触发与同时触发
 * - 最高严重度豁免种类上限
 * - 抑制为「不创建」（不进收件箱、不影响未读计数）
 * - 静默时段按时区回落
 * - 降频与恢复
 * - 决策记录不含敏感内容
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FatigueControlService,
  type InjectedClock,
  type WindowCountProvider,
  type FrequencyStateProvider,
  type FatiguePreferenceProvider,
} from '../../app/services/copilot_triggers/fatigue_control_service.js'
import type { FatigueWindowConfig, FatiguePreference } from '@aiproj/types'
import {
  DEFAULT_FATIGUE_WINDOW_MS,
  DEFAULT_PER_KIND_CAP,
  DEFAULT_GLOBAL_CAP,
  DEFAULT_DISMISS_THRESHOLD,
  DEFAULT_REDUCED_CAP_FLOOR,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 固定时钟
// ---------------------------------------------------------------------------

class FixedClock implements InjectedClock {
  private fixedMs: number
  constructor(isoTime: string) {
    this.fixedMs = new Date(isoTime).getTime()
  }
  now(): string {
    return new Date(this.fixedMs).toISOString()
  }
  nowMs(): number {
    return this.fixedMs
  }
}

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

function createMockWindowCountProvider(
  counts: {
    kind?: number
    global?: number
  } = {},
): WindowCountProvider {
  return {
    countByKind: vi.fn().mockResolvedValue(counts.kind ?? 0),
    countGlobal: vi.fn().mockResolvedValue(counts.global ?? 0),
  }
}

function createMockFrequencyProvider(dismissCount = 0): FrequencyStateProvider {
  return {
    getDismissCount: vi.fn().mockResolvedValue(dismissCount),
    incrementDismissCount: vi.fn().mockResolvedValue(dismissCount + 1),
    resetDismissCount: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockPreferenceProvider(
  opts: {
    timezone?: string | null
    quietHours?: { start: number; end: number } | null
    preference?: FatiguePreference | null
  } = {},
): FatiguePreferenceProvider {
  return {
    getPreference: vi.fn().mockResolvedValue(opts.preference ?? null),
    getOrganizationQuietHours: vi.fn().mockResolvedValue(opts.quietHours ?? null),
    getOrganizationTimezone: vi.fn().mockResolvedValue(opts.timezone ?? null),
  }
}

const defaultFatigueConfig: FatigueWindowConfig = {
  windowMs: DEFAULT_FATIGUE_WINDOW_MS,
  perKindCap: DEFAULT_PER_KIND_CAP,
  globalCap: DEFAULT_GLOBAL_CAP,
  dismissThresholdForReduction: DEFAULT_DISMISS_THRESHOLD,
  reducedCapFloor: DEFAULT_REDUCED_CAP_FLOOR,
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('FatigueControlService', () => {
  let service: FatigueControlService
  let clock: FixedClock

  beforeEach(() => {
    clock = new FixedClock('2026-08-18T10:00:00.000Z')
  })

  // ── 窗口配置解析 ────────────────────────────────────────────────────

  describe('resolveWindowConfig', () => {
    it('should return defaults when no preference exists', async () => {
      const prefProvider = createMockPreferenceProvider()
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        prefProvider,
        clock,
      )

      const config = await service.resolveWindowConfig({
        organizationId: 'org-001',
        userId: 'user-001',
      })

      expect(config.windowMs).toBe(DEFAULT_FATIGUE_WINDOW_MS)
      expect(config.perKindCap).toBe(DEFAULT_PER_KIND_CAP)
      expect(config.globalCap).toBe(DEFAULT_GLOBAL_CAP)
    })

    it('should apply preference overrides', async () => {
      const prefProvider = createMockPreferenceProvider({
        preference: {
          organizationId: 'org-001',
          userId: null,
          windowConfig: { perKindCap: 3, globalCap: 10 },
          quietHours: null,
        },
      })
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        prefProvider,
        clock,
      )

      const config = await service.resolveWindowConfig({
        organizationId: 'org-001',
        userId: 'user-001',
      })

      expect(config.perKindCap).toBe(3)
      expect(config.globalCap).toBe(10)
      expect(config.windowMs).toBe(DEFAULT_FATIGUE_WINDOW_MS) // not overridden
    })
  })

  // ── 静默时段 ────────────────────────────────────────────────────────

  describe('isInQuietHours', () => {
    it('should return false when no quiet hours configured', async () => {
      const prefProvider = createMockPreferenceProvider({ timezone: 'Asia/Shanghai' })
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        prefProvider,
        clock,
      )

      const result = await service.isInQuietHours({ organizationId: 'org-001' })
      expect(result.inQuietHours).toBe(false)
      expect(result.timezoneFallback).toBe(false)
    })

    it('should fallback to UTC when timezone is missing', async () => {
      const prefProvider = createMockPreferenceProvider({
        timezone: null,
        quietHours: { start: 22, end: 8 },
      })
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        prefProvider,
        clock,
      )

      const result = await service.isInQuietHours({ organizationId: 'org-001' })
      expect(result.timezoneFallback).toBe(true)
    })
  })

  // ── 疲劳状态 ────────────────────────────────────────────────────────

  describe('getFatigueState', () => {
    it('should aggregate kind count, global count, and quiet hours', async () => {
      const windowProvider = createMockWindowCountProvider({ kind: 3, global: 7 })
      const freqProvider = createMockFrequencyProvider(1)
      const prefProvider = createMockPreferenceProvider({ timezone: 'UTC' })

      service = new FatigueControlService(windowProvider, freqProvider, prefProvider, clock)

      const state = await service.getFatigueState({
        actorId: 'actor-001',
        problemKind: 'schedule_risk',
        organizationId: 'org-001',
        windowConfig: defaultFatigueConfig,
      })

      expect(state.kindCount).toBe(3)
      expect(state.globalCount).toBe(7)
      expect(state.frequencyReduced).toBe(false) // 1 < 3 threshold
    })

    it('should mark frequency as reduced when dismiss count >= threshold', async () => {
      const freqProvider = createMockFrequencyProvider(3) // >= default threshold of 3
      const prefProvider = createMockPreferenceProvider({ timezone: 'UTC' })

      service = new FatigueControlService(
        createMockWindowCountProvider(),
        freqProvider,
        prefProvider,
        clock,
      )

      const state = await service.getFatigueState({
        actorId: 'actor-001',
        problemKind: 'schedule_risk',
        organizationId: 'org-001',
        windowConfig: defaultFatigueConfig,
      })

      expect(state.frequencyReduced).toBe(true)
    })
  })

  // ── 有效种类上限 ────────────────────────────────────────────────────

  describe('getEffectiveKindCap', () => {
    it('should return base cap when not frequency reduced', () => {
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        createMockPreferenceProvider(),
        clock,
      )

      const cap = service.getEffectiveKindCap(5, false, 1)
      expect(cap).toBe(5)
    })

    it('should halve cap when frequency reduced, but not below floor', () => {
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        createMockPreferenceProvider(),
        clock,
      )

      const cap = service.getEffectiveKindCap(5, true, 1)
      expect(cap).toBe(2) // floor(5/2) = 2
    })

    it('should not go below floor', () => {
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        createMockPreferenceProvider(),
        clock,
      )

      const cap = service.getEffectiveKindCap(2, true, 1)
      expect(cap).toBe(1) // floor(2/2) = 1, which equals floor
    })
  })

  // ── 采纳恢复 ────────────────────────────────────────────────────────

  describe('onAdopted', () => {
    it('should reset dismiss count', async () => {
      const freqProvider = createMockFrequencyProvider(5)
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        freqProvider,
        createMockPreferenceProvider(),
        clock,
      )

      await service.onAdopted({
        actorId: 'actor-001',
        problemKind: 'schedule_risk',
        organizationId: 'org-001',
      })

      expect(freqProvider.resetDismissCount).toHaveBeenCalledWith({
        actorId: 'actor-001',
        problemKind: 'schedule_risk',
        organizationId: 'org-001',
      })
    })
  })

  // ── 决策记录构建 ────────────────────────────────────────────────────

  describe('buildDecisionRecord', () => {
    it('should create a low-sensitivity decision record', () => {
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        createMockPreferenceProvider(),
        clock,
      )

      const record = service.buildDecisionRecord({
        organizationId: 'org-001',
        projectId: 'proj-001',
        ruleId: 'rule-001',
        actorId: 'actor-001',
        outcome: 'created',
        suppressionReason: null,
        severity: 'high',
        problemKind: 'schedule_risk',
        inboxSourceKind: 'smart_recommendation',
        windowKindCount: 1,
        windowGlobalCount: 3,
        kindCap: 5,
        globalCap: 15,
        kindCapExempt: false,
        timezoneFallback: false,
        frequencyReduced: false,
      })

      expect(record.ruleId).toBe('rule-001')
      expect(record.outcome).toBe('created')
      expect(record.severity).toBe('high')
      expect(record.kindCapExempt).toBe(false)
      expect(record.timezoneFallback).toBe(false)

      // Verify no sensitive content
      const recordStr = JSON.stringify(record)
      expect(recordStr).not.toContain('sk-proj')
      expect(recordStr).not.toContain('Bearer')
      expect(recordStr).not.toContain('You are a project')
    })

    it('should record timezone fallback when true', () => {
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        createMockPreferenceProvider(),
        clock,
      )

      const record = service.buildDecisionRecord({
        organizationId: 'org-001',
        projectId: 'proj-001',
        ruleId: 'rule-002',
        actorId: 'actor-001',
        outcome: 'suppressed',
        suppressionReason: 'quiet_hours',
        severity: 'medium',
        problemKind: 'data_staleness',
        inboxSourceKind: 'health_diagnosis_draft',
        windowKindCount: 0,
        windowGlobalCount: 0,
        kindCap: 5,
        globalCap: 15,
        kindCapExempt: false,
        timezoneFallback: true,
        frequencyReduced: false,
      })

      expect(record.timezoneFallback).toBe(true)
      expect(record.suppressionReason).toBe('quiet_hours')
    })

    it('should record kindCapExempt for highest severity', () => {
      service = new FatigueControlService(
        createMockWindowCountProvider(),
        createMockFrequencyProvider(),
        createMockPreferenceProvider(),
        clock,
      )

      const record = service.buildDecisionRecord({
        organizationId: 'org-001',
        projectId: 'proj-001',
        ruleId: 'rule-003',
        actorId: 'actor-001',
        outcome: 'created',
        suppressionReason: null,
        severity: 'critical',
        problemKind: 'risk_escalation',
        inboxSourceKind: 'smart_recommendation',
        windowKindCount: 5,
        windowGlobalCount: 10,
        kindCap: 5,
        globalCap: 15,
        kindCapExempt: true,
        timezoneFallback: false,
        frequencyReduced: false,
      })

      expect(record.kindCapExempt).toBe(true)
      expect(record.outcome).toBe('created')
    })
  })
})
