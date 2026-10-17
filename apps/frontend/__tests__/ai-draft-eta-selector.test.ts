import { describe, expect, it } from 'vitest'
import {
  createDraftProgressProjection,
  selectDraftEta,
  type DraftProgressProjection,
} from '@/lib/ai-draft/progress-projection'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'

/**
 * 构造一个指定已完成模块数 + elapsedMs + 健康/连接/终态的 projection，
 * 用于 selectDraftEta 测试。复用 createDraftProgressProjection 保证字段完整。
 */
function projectionWith(opts: {
  completed?: number
  elapsedMs?: number
  healthState?: DraftProgressProjection['healthState']
  connection?: DraftProgressProjection['connection']
  terminal?: DraftProgressProjection['terminal']
  lastEventAt?: number | null
}): DraftProgressProjection {
  const completed = opts.completed ?? 0
  const state = createDraftProgressProjection()
  // 把前 `completed` 个模块标记为 completed
  PROJECT_DRAFT_MODULES.slice(0, completed).forEach((module) => {
    state.modules[module] = 'completed'
  })
  state.elapsedMs = opts.elapsedMs ?? 0
  state.healthState = opts.healthState ?? 'healthy'
  state.connection = opts.connection ?? 'live'
  state.terminal = opts.terminal ?? 'none'
  state.lastEventAt = opts.lastEventAt ?? null
  return state
}

describe('selectDraftEta', () => {
  describe('中段估算', () => {
    it('3/9 模块、elapsedMs=120000 → etaMs=240000, converging, 文案非空', () => {
      const p = projectionWith({ completed: 3, elapsedMs: 120_000 })
      const r = selectDraftEta(p)
      expect(r.etaMs).toBe(240_000)
      expect(r.confidence).toBe('converging')
      expect(r.formatted).toBe('~4 分钟')
    })

    it('5/9 模块、elapsedMs=200000 → stable, 文案 ~2 分钟', () => {
      const p = projectionWith({ completed: 5, elapsedMs: 200_000 })
      const r = selectDraftEta(p)
      // (200000/5)*4 = 160000ms ≈ ~3 分钟（160000/60000=2.67→四舍五入 3）
      expect(r.etaMs).toBe(160_000)
      expect(r.confidence).toBe('stable')
      expect(r.formatted).toBe('~3 分钟')
    })
  })

  describe('暖机期返回 null', () => {
    it('completed=1 → etaMs=null, confidence=initial, 文案空', () => {
      const p = projectionWith({ completed: 1, elapsedMs: 10_000 })
      const r = selectDraftEta(p)
      expect(r.etaMs).toBeNull()
      expect(r.confidence).toBe('initial')
      expect(r.formatted).toBe('')
    })

    it('completed=0 → null', () => {
      const p = projectionWith({ completed: 0, elapsedMs: 5_000 })
      const r = selectDraftEta(p)
      expect(r.etaMs).toBeNull()
      expect(r.formatted).toBe('')
    })
  })

  describe('停滞/失败/重连时返回 null', () => {
    it('healthState=stale → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'stale',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('healthState=long_running → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'long_running',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('healthState=reconnecting → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'reconnecting',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('healthState=fallback_status → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'fallback_status',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('healthState=failed → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'failed',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('healthState=user_retry_required → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'user_retry_required',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('terminal=completed → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        terminal: 'completed',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('terminal=failed → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        terminal: 'failed',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })

    it('connection=recovering + healthy → 仍可估算（recovering 在 live|recovering 白名单）', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        connection: 'recovering',
      })
      // recovering 连接但 healthState=healthy → 可用
      expect(selectDraftEta(p).etaMs).toBe(240_000)
    })

    it('connection=closed → null', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        connection: 'closed',
      })
      expect(selectDraftEta(p).etaMs).toBeNull()
    })
  })

  describe('全完成时 ETA 为 0', () => {
    it('9/9 → etaMs=0, stable, 文案空（0 返回空串）', () => {
      const p = projectionWith({ completed: 9, elapsedMs: 180_000 })
      const r = selectDraftEta(p)
      expect(r.etaMs).toBe(0)
      expect(r.confidence).toBe('stable')
      expect(r.formatted).toBe('')
    })
  })

  describe('确定性', () => {
    it('同一 projection 调用两次（不传 now）→ 相同结果', () => {
      const p = projectionWith({ completed: 3, elapsedMs: 120_000 })
      const a = selectDraftEta(p)
      const b = selectDraftEta(p)
      expect(a).toEqual(b)
    })

    it('同一 projection + 同一 now → 相同结果', () => {
      const p = projectionWith({ completed: 3, elapsedMs: 120_000, lastEventAt: 1000 })
      const a = selectDraftEta(p, 5000)
      const b = selectDraftEta(p, 5000)
      expect(a).toEqual(b)
    })
  })

  describe('now 补偿：不同 now 产生不同 ETA', () => {
    it('now 增长 60000 → elapsedMs 补偿 +60000，ETA 相应变化', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        lastEventAt: 1000,
      })
      const before = selectDraftEta(p, 2000) // elapsed=120000 + (2000-1000)=121000
      const after = selectDraftEta(p, 62_000) // elapsed=120000 + (62000-1000)=181000
      // now 增长 60000 → elapsed 增 60000 → ETA 增 (60000/3)*6 = 120000
      expect(after.etaMs!).toBeGreaterThan(before.etaMs!)
      expect(after.etaMs! - before.etaMs!).toBeCloseTo(120_000, -2)
    })

    it('不传 now → 退化为 projection.elapsedMs（无补偿）', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        lastEventAt: 1000,
      })
      const r = selectDraftEta(p)
      expect(r.etaMs).toBe(240_000) // (120000/3)*6
    })

    it('lastEventAt=null 时 now 不补偿', () => {
      const p = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        lastEventAt: null,
      })
      // now 传入但 lastEventAt null → 不补偿
      expect(selectDraftEta(p, 999_999).etaMs).toBe(240_000)
    })
  })

  describe('零 state 变更断言', () => {
    it('调用 selectDraftEta 不修改 projection 任何字段', () => {
      const p = projectionWith({ completed: 3, elapsedMs: 120_000, lastEventAt: 1000 })
      const snapshot = JSON.stringify(p)
      selectDraftEta(p, 5000)
      selectDraftEta(p)
      expect(JSON.stringify(p)).toBe(snapshot)
    })
  })
})
