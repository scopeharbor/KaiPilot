import { describe, expect, it } from 'vitest'
import { computeLinearEta, isEtaAvailable, type EtaConfidence } from '@/lib/realtime/eta-estimator'

describe('computeLinearEta', () => {
  describe('线性外推正确性', () => {
    it('3/9 模块、elapsedMs=120000 → 240000ms（约 4 分钟），confidence=converging', () => {
      const result = computeLinearEta(120_000, 3, 9)
      expect(result.etaMs).toBe(240_000)
      expect(result.confidence).toBe<EtaConfidence>('converging')
    })

    it('5/9 模块（56%）、elapsedMs=200000 → 160000ms，confidence=stable', () => {
      const result = computeLinearEta(200_000, 5, 9)
      // (200000/5) * 4 = 160000
      expect(result.etaMs).toBe(160_000)
      expect(result.confidence).toBe<EtaConfidence>('stable')
    })

    it('2/9 模块（22%）、elapsedMs=60000 → 210000ms，confidence=converging', () => {
      const result = computeLinearEta(60_000, 2, 9)
      // (60000/2) * 7 = 210000
      expect(result.etaMs).toBe(210_000)
      expect(result.confidence).toBe<EtaConfidence>('converging')
    })

    it('完成率恰好 50%（4/8）→ confidence=stable', () => {
      const result = computeLinearEta(80_000, 4, 8)
      // (80000/4) * 4 = 80000
      expect(result.etaMs).toBe(80_000)
      expect(result.confidence).toBe<EtaConfidence>('stable')
    })
  })

  describe('暖机期与 null 返回', () => {
    it('completedUnits < 2（暖机期）→ etaMs=null, confidence=initial', () => {
      const result = computeLinearEta(10_000, 1, 9)
      expect(result.etaMs).toBeNull()
      expect(result.confidence).toBe<EtaConfidence>('initial')
    })

    it('completedUnits=1 且 total 很大 → 暖机期 null', () => {
      const result = computeLinearEta(5_000, 1, 100)
      expect(result.etaMs).toBeNull()
      expect(result.confidence).toBe<EtaConfidence>('initial')
    })

    it('零完成（completedUnits=0）→ null', () => {
      const result = computeLinearEta(5_000, 0, 9)
      expect(result.etaMs).toBeNull()
      expect(result.confidence).toBe<EtaConfidence>('initial')
    })

    it('elapsedMs=0 → null（无已耗时长无法外推）', () => {
      const result = computeLinearEta(0, 3, 9)
      expect(result.etaMs).toBeNull()
    })

    it('elapsedMs 为负 → null', () => {
      const result = computeLinearEta(-1000, 3, 9)
      expect(result.etaMs).toBeNull()
    })

    it('elapsedMs 为 NaN/Infinity → null', () => {
      expect(computeLinearEta(Number.NaN, 3, 9).etaMs).toBeNull()
      expect(computeLinearEta(Number.POSITIVE_INFINITY, 3, 9).etaMs).toBeNull()
    })
  })

  describe('全完成与边界', () => {
    it('全完成（completedUnits === totalUnits）→ etaMs=0, confidence=stable', () => {
      const result = computeLinearEta(180_000, 9, 9)
      expect(result.etaMs).toBe(0)
      expect(result.confidence).toBe<EtaConfidence>('stable')
    })

    it('totalUnits=1 且已完成 1 → etaMs=0, stable', () => {
      const result = computeLinearEta(5_000, 1, 1)
      expect(result.etaMs).toBe(0)
      expect(result.confidence).toBe<EtaConfidence>('stable')
    })

    it('totalUnits ≤ 0 → null', () => {
      expect(computeLinearEta(10_000, 0, 0).etaMs).toBeNull()
      expect(computeLinearEta(10_000, 1, -1).etaMs).toBeNull()
    })

    it('completedUnits > totalUnits（非法）→ null', () => {
      expect(computeLinearEta(10_000, 10, 9).etaMs).toBeNull()
    })

    it('负值防护：正常输入不会产生负 etaMs', () => {
      // 各种正常中段输入均应非负
      for (let c = 2; c <= 9; c++) {
        const r = computeLinearEta(60_000, c, 9)
        expect(r.etaMs).not.toBeNull()
        expect(r.etaMs!).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('确定性', () => {
    it('同一输入多次调用返回相同结果', () => {
      const a = computeLinearEta(120_000, 3, 9)
      const b = computeLinearEta(120_000, 3, 9)
      expect(a).toEqual(b)
    })
  })
})

describe('isEtaAvailable', () => {
  describe('healthState 枚举', () => {
    it('healthy → 可用', () => {
      expect(isEtaAvailable('healthy', 'live', 'none')).toBe(true)
    })

    it('long_running → 不可用', () => {
      expect(isEtaAvailable('long_running', 'live', 'none')).toBe(false)
    })

    it('stale → 不可用', () => {
      expect(isEtaAvailable('stale', 'live', 'none')).toBe(false)
    })

    it('reconnecting → 不可用', () => {
      expect(isEtaAvailable('reconnecting', 'live', 'none')).toBe(false)
    })

    it('fallback_status → 不可用', () => {
      expect(isEtaAvailable('fallback_status', 'live', 'none')).toBe(false)
    })

    it('failed → 不可用', () => {
      expect(isEtaAvailable('failed', 'live', 'none')).toBe(false)
    })

    it('user_retry_required → 不可用', () => {
      expect(isEtaAvailable('user_retry_required', 'live', 'none')).toBe(false)
    })
  })

  describe('terminal 状态', () => {
    it('terminal=completed → 不可用（即便 healthy）', () => {
      expect(isEtaAvailable('healthy', 'live', 'completed')).toBe(false)
    })

    it('terminal=failed → 不可用', () => {
      expect(isEtaAvailable('healthy', 'live', 'failed')).toBe(false)
    })

    it('terminal=none → 不因 terminal 阻断', () => {
      expect(isEtaAvailable('healthy', 'live', 'none')).toBe(true)
    })
  })

  describe('connection 状态组合', () => {
    it('connection=live + healthy + none → 可用', () => {
      expect(isEtaAvailable('healthy', 'live', 'none')).toBe(true)
    })

    it('connection=recovering + healthy + none → 可用', () => {
      expect(isEtaAvailable('healthy', 'recovering', 'none')).toBe(true)
    })

    it('connection=idle → 不可用', () => {
      expect(isEtaAvailable('healthy', 'idle', 'none')).toBe(false)
    })

    it('connection=connecting → 不可用', () => {
      expect(isEtaAvailable('healthy', 'connecting', 'none')).toBe(false)
    })

    it('connection=closed → 不可用', () => {
      expect(isEtaAvailable('healthy', 'closed', 'none')).toBe(false)
    })

    it('connection=failed → 不可用', () => {
      expect(isEtaAvailable('healthy', 'failed', 'none')).toBe(false)
    })
  })

  describe('组合优先级', () => {
    it('terminal 优先：即便 connection=live，terminal=failed 仍不可用', () => {
      expect(isEtaAvailable('healthy', 'live', 'failed')).toBe(false)
    })

    it('healthState 优先于 connection：stale 即便 live 也不可用', () => {
      expect(isEtaAvailable('stale', 'live', 'none')).toBe(false)
    })

    it('全 healthy 组合唯一可用', () => {
      // 唯一可用三元组：healthy + (live|recovering) + none
      expect(isEtaAvailable('healthy', 'live', 'none')).toBe(true)
      expect(isEtaAvailable('healthy', 'recovering', 'none')).toBe(true)
    })
  })
})
