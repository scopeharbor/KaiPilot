'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import type { ProgressPhase } from '@aiproj/types'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { selectDraftEta } from '@/lib/ai-draft/progress-projection'

/** 7 阶段流式进度标准中文子说明（spec「品牌 Loader、等待态中文文案」；文案审查纪律：统一草案语义）。 */
export const PROGRESS_PHASE_COPY: Readonly<Record<ProgressPhase, string>> = {
  adapter_ready: '已连接生成服务',
  first_token: '已收到首批内容',
  receiving: '正在接收草案结构',
  parsing: '正在整理草案结构',
  validating: '正在检查日期、依赖与完整性',
  retrying: '正在修复输出格式',
  persisting: '草案已生成，正在准备审查',
}

/** 本地挂载计时基准（design D7：3 秒内完成不闪常驻文案，避免界面闪烁）。 */
export const WAIT_COPY_THRESHOLD_MS = 3_000

export const BRAND_LOADER_LIGHT_SRC = '/branding/aiproj-logo-loader-light.svg'
export const BRAND_LOADER_DARK_SRC = '/branding/aiproj-logo-loader-dark.svg'

/**
 * 品牌 Loader 等待态（tasks 3.1 / design D7）。
 *
 * - 官方品牌 SVG Loader 随色彩主题自适应（resolvedTheme === 'dark' → 暗色资产）；
 * - 生成耗时超过 3 秒常驻展示主标题「AI 正在生成项目草案」与 7 阶段标准中文子说明；
 * - ETA 由 selectDraftEta(projection) 纯派生：暖机期（confidence=initial / 非 healthy
 *   连接）formatted 为空串 → 完全隐藏；收敛后展示「预计剩余 X」。**严禁本地倒计时
 *   减法器（RL-07）**：本组件零 setInterval，数值变化只随服务端事件驱动的
 *   projection 更新。
 * - 3 秒阈值计时器只决定文案是否常驻，绝不推进任何进度数字（RL-07）。
 */
export function TheaterGenerationLoader() {
  const { resolvedTheme } = useTheme()
  const projection = useAiProjectDraftStore((state) => state.progressProjection)
  const [showWaitCopy, setShowWaitCopy] = React.useState(false)

  React.useEffect(() => {
    if (showWaitCopy) return
    const timer = window.setTimeout(() => setShowWaitCopy(true), WAIT_COPY_THRESHOLD_MS)
    return () => window.clearTimeout(timer)
  }, [showWaitCopy])

  const eta = selectDraftEta(projection)
  const showEta = eta.etaMs !== null && eta.confidence !== 'initial' && eta.formatted !== ''
  const etaPrefix = eta.confidence === 'converging' ? '估算中…' : '预计剩余'
  const phaseLabel = projection.phase ? PROGRESS_PHASE_COPY[projection.phase] : '草案生成中'

  return (
    <div
      data-theater-loader
      role="status"
      aria-live="polite"
      aria-label="AI 正在生成项目草案"
      className="flex flex-col items-center gap-3 py-2 text-center"
    >
      <img
        data-theater-brand-loader
        src={resolvedTheme === 'dark' ? BRAND_LOADER_DARK_SRC : BRAND_LOADER_LIGHT_SRC}
        width={72}
        height={72}
        alt=""
        aria-hidden="true"
        className="aspect-square shrink-0 object-contain"
      />
      {showWaitCopy ? (
        <div className="flex flex-col items-center gap-1.5">
          <h2
            data-theater-loader-title
            className="text-base font-semibold tracking-wide text-[var(--nx-text-primary)]"
          >
            AI 正在生成项目草案
          </h2>
          <p
            data-theater-loader-phase
            className="text-xs leading-relaxed text-[var(--nx-text-secondary)]"
          >
            {phaseLabel}
          </p>
          {showEta ? (
            <p
              data-theater-loader-eta
              className="font-mono text-[11px] text-[var(--nx-text-muted)]"
            >
              <span aria-hidden>{etaPrefix}</span> {eta.formatted}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="sr-only">草案生成中</span>
      )}
    </div>
  )
}

export default TheaterGenerationLoader
