'use client'

import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import {
  type ProgressPhase,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
} from '@aiproj/types'

/**
 * 9 模块确定性中文标签（RL-14：静态映射，禁止运行时注入）。
 * 顺序与契约 `PROJECT_DRAFT_MODULES`（charter → ganttPreview）严格一致。
 */
export const THEATER_MODULE_LABELS: Readonly<Record<ProjectDraftModule, string>> = {
  charter: '项目章程',
  wbs: '工作分解结构',
  tasks: '任务清单',
  dependencies: '任务依赖',
  acceptance: '验收标准',
  resource: '资源建议',
  risk: '风险建议',
  milestone: '里程碑',
  ganttPreview: '甘特图预览',
}

/** 生成中模块的缺省流式子说明（detail 缺省时使用）。 */
export const THEATER_MODULE_GENERATING_TEXT: Readonly<Record<ProjectDraftModule, string>> = {
  charter: '正在起草项目章程',
  wbs: '正在构建分解结构',
  tasks: '正在生成任务条目',
  dependencies: '正在梳理依赖关系',
  acceptance: '正在拟定验收标准',
  resource: '正在规划资源分工',
  risk: '正在评估潜在风险',
  milestone: '正在编排里程碑',
  ganttPreview: '正在编排时间沙盘',
}

/** 完成态缺省微摘要（无服务端计数摘要时使用）。 */
export const THEATER_MODULE_COMPLETED_TEXT: Readonly<Record<ProjectDraftModule, string>> = {
  charter: '章程草案已就绪',
  wbs: '分解结构已就绪',
  tasks: '任务条目已就绪',
  dependencies: '依赖关系已就绪',
  acceptance: '验收标准已就绪',
  resource: '资源分工已就绪',
  risk: '风险应对已就绪',
  milestone: '里程碑已就绪',
  ganttPreview: '排期预览已就绪',
}

/** 7 阶段流式 phase 标准中文子说明（与 design D7 逐字一致）。 */
export const THEATER_PROGRESS_PHASE_LABELS: Readonly<Record<ProgressPhase, string>> = {
  adapter_ready: '已连接生成服务',
  first_token: '已收到首批内容',
  receiving: '正在接收草案结构',
  parsing: '正在整理草案结构',
  validating: '正在检查日期、依赖与完整性',
  retrying: '正在修复输出格式',
  persisting: '草案已生成，正在准备审查',
}

/**
 * 建筑卡纯 CSS 动效与降级（RL-15：零 canvas、零 Three.js，全部原生 CSS keyframes）。
 *
 * - `nx-construct-pulse`：天青呼吸外发光（`--nx-space-cyan` #38bdf8 的固定透明度展开）；
 * - `nx-construct-spin`：微型旋转指示器；
 * - `[data-immersion='precise']` 与 `prefers-reduced-motion: reduce` 下
 *   animation / transition 全部 `!important` 归零，舞台降级为纯静态仪器面板（design D6）。
 * 由容器（TheaterGenerationStage）注入一次 `<style data-nx-theater-module-css>`。
 */
export const NX_THEATER_MODULE_CSS = `
.nx-construct-pulse {
  animation: nx-pulse-glow 2.4s ease-in-out infinite;
}
.nx-construct-spin {
  animation: nx-construct-rotate 1.1s linear infinite;
}
@keyframes nx-pulse-glow {
  0%, 100% {
    border-color: rgba(56, 189, 248, 0.55);
    box-shadow: 0 0 0 0 rgba(56, 189, 248, 0);
  }
  50% {
    border-color: rgba(56, 189, 248, 0.9);
    box-shadow: 0 0 14px 2px rgba(56, 189, 248, 0.22);
  }
}
@keyframes nx-construct-rotate {
  to {
    transform: rotate(360deg);
  }
}
[data-immersion='precise'] .nx-construct-pulse,
[data-immersion='precise'] .nx-construct-spin {
  animation: none !important;
  transition: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .nx-construct-pulse,
  .nx-construct-spin {
    animation: none !important;
    transition: none !important;
  }
}
`

export interface TheaterModuleConstructCardProps {
  /** 9 核心模块键之一（charter / wbs / ... / ganttPreview）。 */
  module: ProjectDraftModule
  /** 建造状态；缺省 pending（蓝图待建态）。 */
  status?: ProjectDraftModuleStatus
  /** 生成中态实时流式子阶段描述（由容器喂入 `draft.progress` 的 phase 说明）。 */
  detail?: string | null
  /** 完成态已生成数据微摘要（如「已生成 12 项任务」）；缺省用模块默认完成文案。 */
  summary?: string | null
}

const STATUS_META: Readonly<
  Record<
    ProjectDraftModuleStatus,
    {
      label: string
      icon: typeof Circle
      iconTone: string
      cardClass: string
    }
  >
> = {
  pending: {
    label: '蓝图规划中',
    icon: Circle,
    iconTone: 'text-[var(--nx-text-muted)]',
    cardClass: 'border-dashed border-[var(--nx-border-hairline)] opacity-60',
  },
  generating: {
    label: '建造中',
    icon: Loader2,
    iconTone: 'text-[var(--nx-space-cyan)]',
    cardClass: 'nx-construct-pulse border-[var(--nx-space-cyan)]',
  },
  completed: {
    label: '已就绪',
    icon: CheckCircle2,
    iconTone: 'text-[var(--nx-status-success)]',
    cardClass: 'border-[var(--nx-status-success)]/60 bg-[var(--nx-workspace-surface)]',
  },
  failed: {
    label: '生成中断',
    icon: AlertCircle,
    iconTone: 'text-[var(--nx-status-danger)]',
    cardClass: 'border-[var(--nx-status-danger)]/60',
  },
}

/**
 * 单模块场景建筑卡（v3-ui-next-theater-generation D5 / 任务 2.1-2.2）。
 *
 * 4 种互斥建造状态，全部由服务端流式事件驱动（RL-07，组件零定时器零自增）：
 * - `pending` 蓝图待建：发丝虚线边框 + 弱化 Circle + 「蓝图规划中」；
 * - `generating` 脉冲建造：天青微光呼吸（`nx-construct-pulse`）+ 旋转 Loader2 + 流式子说明；
 * - `completed` 坚实完成：实线绿边 + CheckCircle2 + 「已就绪」+ 数据微摘要；
 * - `failed` 建造异常：红色警示 + AlertCircle + 「生成中断」。
 *
 * 双通道无障碍：每个状态同时具备「颜色 + 语义图标 + 中文文字」，色弱/色盲用户可无损理解。
 */
export function TheaterModuleConstructCard({
  module,
  status = 'pending',
  detail,
  summary,
}: TheaterModuleConstructCardProps) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  const isGenerating = status === 'generating'

  let detailText: string
  if (status === 'generating') {
    detailText = detail ?? THEATER_MODULE_GENERATING_TEXT[module]
  } else if (status === 'completed') {
    detailText = summary ?? THEATER_MODULE_COMPLETED_TEXT[module]
  } else if (status === 'failed') {
    detailText = `${THEATER_MODULE_LABELS[module]}生成中断，可重试生成。`
  } else {
    detailText = '等待 AI 开始生成该模块。'
  }

  return (
    <article
      data-construct-card
      data-construct-module={module}
      data-construct-state={status}
      aria-label={`模块 ${THEATER_MODULE_LABELS[module]}：${meta.label}`}
      className={`rounded-md border bg-[var(--nx-workspace-surface)]/40 p-3 ${meta.cardClass}`}
    >
      <header className="flex items-center gap-2">
        <span
          data-construct-icon
          className={`flex h-6 w-6 shrink-0 items-center justify-center ${isGenerating ? 'nx-construct-spin' : ''}`}
        >
          <Icon className={`h-4 w-4 ${meta.iconTone}`} aria-hidden />
        </span>
        <h3 className="truncate text-sm font-medium text-[var(--nx-text-primary)]">
          {THEATER_MODULE_LABELS[module]}
        </h3>
        <span
          data-construct-status-badge
          className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${meta.iconTone} border-current`}
        >
          {meta.label}
        </span>
      </header>
      <p data-construct-detail className="mt-2 truncate text-xs text-[var(--nx-text-muted)]">
        {detailText}
      </p>
    </article>
  )
}

export default TheaterModuleConstructCard
