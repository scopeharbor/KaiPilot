'use client'

/**
 * v3-copilot-productized-operating-entry —— scope 变更保护（任务 4.5）。
 *
 * spec：`Scope changes while a draft exists` —— 导航改变有效项目而草稿非空时，
 * 系统 MUST 保留草稿、MUST 可见地报告 scope 变化、并且 MUST 要求用户确认或重选后才可提交。
 *
 * 实现要点：
 * - 草稿**不清空**（用户的输入不因导航丢失）；
 * - 产生 `scopeNotice`，`submitCopilotTurn` 见到它即拒绝提交；
 * - 上一 scope 的 quick start 结构化选择一律作废（跨 scope 复用即 stale）。
 */

import { useEffect, useRef } from 'react'
import { useCopilotStore } from '@/stores/copilot-store'

/** 组织级 scope 的展示名。 */
export const COPILOT_GLOBAL_SCOPE_LABEL = '全局'

export interface CopilotScopeGuardInput {
  /** 当前有效项目；null 表示组织级。 */
  readonly projectId: number | null
  /** 当前 scope 展示名；缺省时按 projectId 生成中性名。 */
  readonly label?: string | null
}

/** 生成 scope 展示名（不可用时给中性占位，不猜测项目名）。 */
export function copilotScopeLabel(projectId: number | null, label?: string | null): string {
  if (projectId === null) return COPILOT_GLOBAL_SCOPE_LABEL
  if (typeof label === 'string' && label.trim().length > 0) return label
  return `项目 #${projectId}`
}

/**
 * 监听 scope 变化并在草稿非空时挂起提交。
 *
 * 首次挂载只记录基线，不产生提示。
 */
export function useCopilotScopeGuard(input: CopilotScopeGuardInput): void {
  const setScopeNotice = useCopilotStore((state) => state.setScopeNotice)
  const setQuickStartSelection = useCopilotStore((state) => state.setQuickStartSelection)

  const previousRef = useRef<{ projectId: number | null; label: string } | null>(null)

  useEffect(() => {
    const nextLabel = copilotScopeLabel(input.projectId, input.label)
    const previous = previousRef.current

    if (previous === null) {
      previousRef.current = { projectId: input.projectId, label: nextLabel }
      return
    }
    if (previous.projectId === input.projectId) {
      // 同一 scope 内展示名刷新（例如 readiness 返回了项目名）不算变更。
      previousRef.current = { projectId: input.projectId, label: nextLabel }
      return
    }

    // scope 真的变了：作废上一 scope 的结构化选择。
    setQuickStartSelection(null)

    const draft = useCopilotStore.getState().draft
    if (draft.trim().length > 0) {
      setScopeNotice({
        previousLabel: previous.label,
        nextLabel,
        previousProjectId: previous.projectId,
        nextProjectId: input.projectId,
      })
    } else {
      setScopeNotice(null)
    }

    previousRef.current = { projectId: input.projectId, label: nextLabel }
  }, [input.projectId, input.label, setScopeNotice, setQuickStartSelection])
}
