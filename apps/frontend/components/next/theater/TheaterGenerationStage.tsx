'use client'

import { RefreshCw } from 'lucide-react'
import { PROJECT_DRAFT_MODULES, type ProjectDraftModule } from '@aiproj/types'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import type { DraftProgressHealthState } from '@/lib/ai-draft/progress-projection'
import {
  NX_THEATER_MODULE_CSS,
  THEATER_MODULE_LABELS,
  THEATER_PROGRESS_PHASE_LABELS,
  TheaterModuleConstructCard,
} from './TheaterModuleConstructCard'

export interface TheaterGenerationStageProps {
  /** 各模块完成态微摘要（如「已生成 12 项任务」），由装配层从服务端事件数据投影；缺省显示模块默认文案。 */
  summaries?: Partial<Record<ProjectDraftModule, string>>
  /** 连接健康度覆盖（测试或装配层注入）；缺省自读 store.progressProjection.healthState。 */
  healthState?: DraftProgressHealthState
}

/** 恢复提示条文案（design D4：stale / reconnecting 时非阻塞浮现）。 */
const RESTORE_BANNER_COPY: Readonly<Partial<Record<DraftProgressHealthState, string>>> = {
  stale: '连接暂时停滞，正在尝试恢复连接',
  reconnecting: '正在重新建立进度连接',
}

const TOTAL_MODULES = PROJECT_DRAFT_MODULES.length

/**
 * 9 模块场景叙事建造舞台（v3-ui-next-theater-generation D5 / D6 / 任务 2.4）。
 *
 * - 3x3 响应式矩阵消费 store `moduleStatuses` 驱动 9 张建筑卡，缺省键按 `pending` 处理；
 *   已 `completed` 的模块在停滞/恢复期间**严禁回退为空白蓝图**（design D4 关键防御）；
 * - 顶部挂载非阻塞恢复提示条：`progressProjection.healthState` 为 `stale` / `reconnecting`
 *   时浮现（RL-07：只消费服务端事件驱动的健康状态，组件零定时器）；
 * - 精确档（precise）与 `prefers-reduced-motion` 下 `NX_THEATER_MODULE_CSS` 将全部
 *   动效 `!important` 归零，舞台呈现高对比度静态仪器面板；
 * - 内嵌 `aria-live="polite"` 隐藏读屏节点，实时播报「草案模块生成进度」，文案严格
 *   遵守防误导纪律（禁止「项目已创建」类措辞）。
 */
export function TheaterGenerationStage({
  summaries,
  healthState: healthStateOverride,
}: TheaterGenerationStageProps) {
  const activeTier = useImmersionTier()
  const moduleStatuses = useAiProjectDraftStore((state) => state.moduleStatuses)
  const storeHealthState = useAiProjectDraftStore((state) => state.progressProjection.healthState)
  const phase = useAiProjectDraftStore((state) => state.progressProjection.phase)
  const healthState = healthStateOverride ?? storeHealthState

  const statusOf = (module: ProjectDraftModule) => moduleStatuses[module] ?? 'pending'
  const completedCount = PROJECT_DRAFT_MODULES.filter(
    (module) => moduleStatuses[module] === 'completed',
  ).length
  const firstGenerating = PROJECT_DRAFT_MODULES.find(
    (module) => moduleStatuses[module] === 'generating',
  )
  const firstFailed = PROJECT_DRAFT_MODULES.find((module) => moduleStatuses[module] === 'failed')
  const activePhaseLabel =
    firstGenerating !== undefined && phase !== null ? THEATER_PROGRESS_PHASE_LABELS[phase] : null

  const bannerCopy = RESTORE_BANNER_COPY[healthState]
  const isRecovering = healthState === 'stale' || healthState === 'reconnecting'

  let liveText = `草案模块生成进度：`
  if (firstGenerating !== undefined) {
    liveText += `正在建造${THEATER_MODULE_LABELS[firstGenerating]}，`
  } else if (firstFailed !== undefined) {
    liveText += `模块「${THEATER_MODULE_LABELS[firstFailed]}」生成中断，`
  }
  liveText += `已完成 ${completedCount} 个，共 ${TOTAL_MODULES} 个模块。`

  return (
    <section
      data-theater-generation-stage
      data-immersion={activeTier}
      aria-label="草案模块生成场景"
      className="mx-auto flex w-full max-w-4xl flex-col gap-4"
    >
      <style data-nx-theater-module-css>{NX_THEATER_MODULE_CSS}</style>

      <header data-stage-header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-wide text-[var(--nx-text-primary)]">
          草案生成中
        </h2>
        <span
          data-stage-progress
          className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 text-[11px] text-[var(--nx-text-secondary)]"
        >
          已完成 <span className="font-mono text-[var(--nx-status-success)]">{completedCount}</span>
          /{TOTAL_MODULES} 模块
        </span>
      </header>

      {isRecovering && bannerCopy ? (
        <div
          data-health-banner={healthState}
          role="status"
          className="flex items-center gap-2 rounded border border-[var(--nx-status-warning)]/50 bg-[var(--nx-bg-1)] px-4 py-2 text-xs text-[var(--nx-text-secondary)]"
        >
          <RefreshCw
            className="nx-construct-spin h-3.5 w-3.5 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          {bannerCopy}
        </div>
      ) : null}

      <div data-module-matrix className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
        {PROJECT_DRAFT_MODULES.map((module) => (
          <TheaterModuleConstructCard
            key={module}
            module={module}
            status={statusOf(module)}
            detail={module === firstGenerating ? activePhaseLabel : null}
            summary={summaries?.[module] ?? null}
          />
        ))}
      </div>

      <div aria-live="polite" aria-atomic="true" className="sr-only" data-stage-live>
        {liveText}
      </div>
    </section>
  )
}

export default TheaterGenerationStage
