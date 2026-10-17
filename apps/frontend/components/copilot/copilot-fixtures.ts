'use client'

import type {
  CopilotAssumptionEntry,
  CopilotMessage,
  CopilotRecommendedAction,
  CopilotRouteDecision,
} from '@aiproj/types'
import { deriveRequiresUserConfirmation } from '@aiproj/types'

/**
 * Copilot 面板本阶段的**演示数据**（v3-copilot-sidebar-shell）。
 *
 * 意图路由 / 上下文采集 / 动作确认通道未接入（分别归 intent-catalog-and-router /
 * context-packet / action-and-preview-boundary），面板以 fixture 驱动可交互演示，
 * 且**显式标注无后端**（红线任务组 7 / 任务 7.5）。
 *
 * 数据纪律：全部为低敏摘要；**不含**完整 prompt/模型输出/业务正文/secret。
 * fixture 的形状与 `copilot-shared-contracts` 类型一致——路由能力落地后同形状数据
 * 由生产通道提供，壳的渲染面不变。
 */

export const COPILOT_DEMO_SESSION_ID = 'cps-demo-v3-sidebar-shell'

/** 有界摘要：面板内展示/内存会话统一截断到 120 字（消息无全文字段，契约级约束）。 */
export function boundedCopilotSummary(text: string, max = 120): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max) + '…'
}

/** 分步进度（任务 4.6）：理解需求 / 分析结构 / 生成方案。 */
export const COPILOT_DEMO_STREAM_STEPS = [
  { key: 'understanding', label: '理解需求' },
  { key: 'analyzing', label: '分析结构' },
  { key: 'generating', label: '生成方案' },
] as const

/** 演示用预计剩余文案（真实 ETA 依赖生产流式通道，任务 4.6 仅展示语义）。 */
export const COPILOT_DEMO_ETA_TEXT = '预计剩余约 20 秒'

/** 演示会话的欢迎消息（低敏摘要）。 */
export function buildCopilotDemoWelcomeMessage(now = new Date().toISOString()): CopilotMessage {
  return {
    messageId: 'cpm-demo-welcome',
    sessionId: COPILOT_DEMO_SESSION_ID,
    role: 'assistant',
    messageSummary:
      '你好，我是开项 AI Copilot。当前为**演示预览**：意图路由尚未接入，对话只在本机演示，不会修改任何项目数据。',
    sourceRefs: [],
    createdAt: now,
  }
}

/**
 * 演示回复（提交后流式完成后追加的 AI 侧消息）。
 * 使用 `deriveRequiresUserConfirmation` 派生确认要求（调用方不可省略，契约约束）。
 */
export function buildCopilotDemoReply(now = new Date().toISOString()): CopilotMessage {
  return {
    messageId: 'cpm-demo-reply',
    sessionId: COPILOT_DEMO_SESSION_ID,
    role: 'assistant',
    messageSummary:
      '已按你的输入生成演示答复：建议先核对项目范围与任务依赖（演示数据，未接入生产检索）。下方动作卡片处于预览禁用态，动作通道接入前不会执行任何写入。',
    sourceRefs: [],
    createdAt: now,
  }
}

export function buildCopilotDemoRouteDecisions(): readonly CopilotRouteDecision[] {
  return [
    {
      routeId: 'cpr-demo-1',
      destination: 'general_qa',
      confidence: 'medium',
      order: 0,
      reason: '演示路由建议',
      sourceRefs: [],
      sourceHashes: [],
      warnings: [],
    },
    {
      routeId: 'cpr-demo-2',
      destination: 'knowledge_base',
      confidence: 'low',
      order: 1,
      reason: '演示路由建议',
      sourceRefs: [],
      sourceHashes: [],
      warnings: [],
    },
  ]
}

/** 演示动作卡片：mutation 类 → requiresUserConfirmation=true（红线 7.x 渲染为禁用预览态）。 */
export function buildCopilotDemoActions(): readonly CopilotRecommendedAction[] {
  const base = {
    actionId: 'cpa-demo-1',
    destination: 'ai_draft_generation' as const,
    actionType: 'preview' as const,
    intentClass: 'mutation' as const,
    label: '生成项目草案（演示）',
    description: '根据当前对话内容生成项目章程与任务清单草案。',
    sourceRefs: [],
    sourceHashes: [],
    requiredPermissions: ['project:create'],
    isStale: false,
    idempotencyKey: 'demo-ai-draft-1',
    lowSensitivitySummary: '生成项目草案（演示，未接入路由）',
  }
  return [
    {
      ...base,
      requiresUserConfirmation: deriveRequiresUserConfirmation(base.destination, base.actionType),
    },
  ]
}

/** 演示假设条目（插槽 5.2 的演示数据；置信度 0–100）。 */
export function buildCopilotDemoAssumptions(): readonly CopilotAssumptionEntry[] {
  return [
    {
      assumptionId: 'cpa-a-demo-1',
      statement: '假设项目周期按 4 周估算（演示默认值）',
      source: 'default',
      confidence: 55,
      usedDefault: true,
      needsConfirmation: true,
      editable: true,
    },
  ]
}
