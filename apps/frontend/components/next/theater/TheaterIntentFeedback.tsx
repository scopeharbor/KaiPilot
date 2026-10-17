'use client'

import * as React from 'react'
import { BadgeCheck, Gauge, Package, Target } from 'lucide-react'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import type { ProjectType } from '@aiproj/types'

/**
 * 项目类型中文标签与令牌色映射（v3-ui-next-theater-intent-clarify D1 / spec「意图解析结果
 * 轻量 HUD」）。映射为确定性静态数据，仅供 HUD 与就绪态复用（RL-14）；颜色只消费
 * `--nx-*` 令牌，禁止硬编码色值（RL-15）。
 */
export const PROJECT_TYPE_META: Readonly<Record<ProjectType, { label: string; token: string }>> = {
  software: { label: '软件系统', token: 'var(--nx-chart-3)' },
  event: { label: '活动项目', token: 'var(--nx-chart-4)' },
  research: { label: '调研项目', token: 'var(--nx-chart-6)' },
  product: { label: '产品项目', token: 'var(--nx-chart-7)' },
  general: { label: '通用项目', token: 'var(--nx-chart-1)' },
}

export function projectTypeLabel(projectType: ProjectType): string {
  return PROJECT_TYPE_META[projectType]?.label ?? '通用项目'
}

interface ConfidenceMeta {
  text: string
  percent: number
  token: string
  Icon: typeof Gauge
}

function describeConfidence(overallConfidence: number): ConfidenceMeta {
  const percent = Math.round(Math.min(1, Math.max(0, overallConfidence)) * 100)
  if (percent >= 80) {
    return {
      text: `高置信度 ${percent}%`,
      percent,
      token: 'var(--nx-status-success)',
      Icon: BadgeCheck,
    }
  }
  if (percent >= 60) {
    return {
      text: `中等置信度 ${percent}%`,
      percent,
      token: 'var(--nx-status-warning)',
      Icon: Gauge,
    }
  }
  return { text: `低置信度 ${percent}%`, percent, token: 'var(--nx-status-danger)', Icon: Gauge }
}

/**
 * 意图解析结果要素 HUD（tasks 3.1）。
 *
 * - 发丝线仪器面板，结构化呈现项目类型徽章、核心目标、范围交付物摘要与初始置信度；
 * - 双通道无障碍：颜色令牌 + 中文文字 + 语义图标，绝不单靠颜色传达状态（RL-15）；
 * - `branch === 'ready'` 时由 store 的 `status === 'ready'` 派生，呈现 100% 完备指示；
 * - 纯展示组件：零副作用、零请求、零落库（RL-01），置入剧场后由状态机控制显隐。
 */
export function TheaterIntentFeedback() {
  const parsedIntent = useAiProjectDraftStore((state) => state.parsedIntent)
  const status = useAiProjectDraftStore((state) => state.status)
  const understanding = useAiProjectDraftStore((state) => state.understandingDraft)

  if (!parsedIntent) return null

  const typeMeta = PROJECT_TYPE_META[parsedIntent.projectType]
  const objective = parsedIntent.objectives[0] ?? null
  // 原话里常常不列交付物；追问流程也不专门问它——交付物由「项目理解」的能力地图整理出来。
  // 原话没有时改读理解，别让用户去等一个不会发生的「澄清补充」。
  const understandingCapabilities = understanding?.capabilities.map((item) => item.name) ?? []
  const deliverableSource =
    parsedIntent.deliverables.length > 0 ? parsedIntent.deliverables : understandingCapabilities
  const deliverables = deliverableSource.slice(0, 3)
  const moreDeliverables = Math.max(0, deliverableSource.length - deliverables.length)
  const ready = status === 'ready'
  const confidence = describeConfidence(ready ? 1 : parsedIntent.overallConfidence)
  const ConfidenceIcon = confidence.Icon

  return (
    <section
      data-theater-feedback
      aria-label="意图解析要素反馈"
      className="nx-space-atmosphere mx-auto w-full max-w-3xl rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/80 px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-project-type={parsedIntent.projectType}
          role="status"
          className="rounded border px-2 py-0.5 text-xs font-medium"
          style={{
            color: typeMeta.token,
            borderColor: typeMeta.token,
            backgroundColor: 'var(--nx-space-surface)',
          }}
        >
          {typeMeta.label}
        </span>
        <span className="text-xs tracking-wide text-[var(--nx-text-muted)]">
          {ready ? '意图信息完备 · 可直接生成' : '初始要素识别（后续以澄清为准）'}
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3" data-theater-feedback-grid>
        {objective ? (
          <div className="flex items-start gap-2" data-theater-feedback-objective>
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
            <div className="min-w-0">
              <p className="text-[11px] leading-none text-[var(--nx-text-muted)]">核心目标</p>
              <p className="mt-1 truncate text-xs leading-relaxed text-[var(--nx-text-primary)]">
                {objective}
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex items-start gap-2" data-theater-feedback-deliverables>
          <Package className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] leading-none text-[var(--nx-text-muted)]">范围交付物</p>
            <p
              className="mt-1 truncate text-xs leading-relaxed text-[var(--nx-text-primary)]"
              // 一行放不下会被截成「…」：悬停时显示完整清单。
              title={deliverableSource.length > 0 ? deliverableSource.join('、') : undefined}
            >
              {deliverables.length > 0
                ? `${deliverables.join(' · ')}${moreDeliverables > 0 ? ` 等 ${deliverableSource.length} 项` : ''}`
                : '会在 AI 梳理项目理解时整理'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2" data-theater-feedback-confidence>
          <ConfidenceIcon
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: confidence.token }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[11px] leading-none text-[var(--nx-text-muted)]">初始置信度</p>
            <p
              className="mt-1 text-xs font-medium leading-relaxed"
              style={{ color: confidence.token }}
              aria-label={confidence.text}
            >
              {ready ? '要素完备 100%' : confidence.text}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
