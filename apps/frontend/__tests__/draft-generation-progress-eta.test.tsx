import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import { DraftGenerationProgress } from '@/components/ai-copilot/DraftGenerationProgress'
import {
  createDraftProgressProjection,
  type DraftProgressProjection,
} from '@/lib/ai-draft/progress-projection'

/** 构造一个指定已完成模块数 + 健康态的 projection。 */
function projectionWith(opts: {
  completed?: number
  elapsedMs?: number
  healthState?: DraftProgressProjection['healthState']
  connection?: DraftProgressProjection['connection']
  terminal?: DraftProgressProjection['terminal']
}): DraftProgressProjection {
  const completed = opts.completed ?? 0
  const state = createDraftProgressProjection()
  PROJECT_DRAFT_MODULES.slice(0, completed).forEach((module) => {
    state.modules[module] = 'completed'
  })
  state.elapsedMs = opts.elapsedMs ?? 0
  state.healthState = opts.healthState ?? 'healthy'
  state.connection = opts.connection ?? 'live'
  state.terminal = opts.terminal ?? 'none'
  return state
}

/** 从 moduleStatuses 派生（组件接收的 prop 形式）。 */
function statusesFor(
  completed: number,
): Partial<
  Record<(typeof PROJECT_DRAFT_MODULES)[number], 'completed' | 'pending' | 'generating' | 'failed'>
> {
  const out: Partial<Record<string, 'completed' | 'pending'>> = {}
  PROJECT_DRAFT_MODULES.forEach((m, i) => {
    out[m] = i < completed ? 'completed' : 'pending'
  })
  return out as never
}

describe('DraftGenerationProgress ETA 渲染', () => {
  describe('ETA 显示/隐藏逻辑', () => {
    it('converging（3/9, 120000ms）→ 显示「估算中… ~4 分钟」', () => {
      const projection = projectionWith({ completed: 3, elapsedMs: 120_000 })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(3)} projection={projection} />)
      expect(screen.getByText('估算中…')).toBeInTheDocument()
      expect(screen.getByText('~4 分钟')).toBeInTheDocument()
    })

    it('stable（5/9, 200000ms）→ 显示「预计剩余」无「估算中」', () => {
      const projection = projectionWith({ completed: 5, elapsedMs: 200_000 })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(5)} projection={projection} />)
      expect(screen.getByText('预计剩余')).toBeInTheDocument()
      expect(screen.queryByText('估算中…')).not.toBeInTheDocument()
      // (200000/5)*4 = 160000ms → ~3 分钟
      expect(screen.getByText('~3 分钟')).toBeInTheDocument()
    })

    it('不传 projection → 不渲染 ETA 文案', () => {
      render(<DraftGenerationProgress moduleStatuses={statusesFor(3)} />)
      expect(screen.queryByText('估算中…')).not.toBeInTheDocument()
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })
  })

  describe('暖机期不渲染 ETA', () => {
    it('completed=1（暖机期 initial）→ 无 ETA 文案', () => {
      const projection = projectionWith({ completed: 1, elapsedMs: 10_000 })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(1)} projection={projection} />)
      expect(screen.queryByText('估算中…')).not.toBeInTheDocument()
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })

    it('completed=0 → 无 ETA 文案', () => {
      const projection = projectionWith({ completed: 0, elapsedMs: 5_000 })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(0)} projection={projection} />)
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })
  })

  describe('停滞/失败时清空 ETA', () => {
    it('healthState=stale → 无 ETA 文案', () => {
      const projection = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'stale',
      })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(3)} projection={projection} />)
      expect(screen.queryByText('估算中…')).not.toBeInTheDocument()
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })

    it('healthState=failed → 无 ETA 文案', () => {
      const projection = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        healthState: 'failed',
      })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(3)} projection={projection} />)
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })

    it('terminal=completed → 无 ETA 文案（即便 healthy）', () => {
      const projection = projectionWith({
        completed: 9,
        elapsedMs: 180_000,
        terminal: 'completed',
      })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(9)} projection={projection} />)
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })

    it('connection=closed → 无 ETA 文案', () => {
      const projection = projectionWith({
        completed: 3,
        elapsedMs: 120_000,
        connection: 'closed',
      })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(3)} projection={projection} />)
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })
  })

  describe('全完成 ETA 为零', () => {
    it('9/9 → etaMs=0 → formatEta 返回空串 → 不渲染 ETA 行', () => {
      const projection = projectionWith({ completed: 9, elapsedMs: 180_000 })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(9)} projection={projection} />)
      // 全完成：etaMs=0 → formatted 为空串 → showEta=false（etaMs !== null 但文案空）
      expect(screen.queryByText('预计剩余')).not.toBeInTheDocument()
    })
  })

  describe('数字合理', () => {
    it('小时级时长文案出现「小时」', () => {
      // 3/9, elapsedMs=3600000 (1h) → (3600000/3)*6 = 7200000ms = ~2 小时 0 分钟
      const projection = projectionWith({ completed: 3, elapsedMs: 3_600_000 })
      render(<DraftGenerationProgress moduleStatuses={statusesFor(3)} projection={projection} />)
      expect(screen.getByText(/小时/)).toBeInTheDocument()
    })
  })

  describe('aria-live 节流（D5：ETA 不单独触发播报）', () => {
    it('ETA 文案不引入独立的 aria-live 区域', () => {
      const projection = projectionWith({ completed: 3, elapsedMs: 120_000 })
      const { container } = render(
        <DraftGenerationProgress moduleStatuses={statusesFor(3)} projection={projection} />,
      )
      // ETA 文案行不应自带 aria-live（已在 progress 的 aria-live 区域内，不单独播报）
      const etaLine = screen.getByText('估算中…').closest('p')
      expect(etaLine).not.toBeNull()
      expect(etaLine?.hasAttribute('aria-live')).toBe(false)
      // 整个组件最多只有既有的那一个 sr-only aria-live 区域
      const liveRegions = container.querySelectorAll('[aria-live]')
      expect(liveRegions.length).toBe(1)
    })
  })
})
