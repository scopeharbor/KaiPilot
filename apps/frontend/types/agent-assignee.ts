/**
 * Agent-assignee 类型定义（v3-copilot-agent-as-assignee）。
 *
 * AI agent 可作为任务负责人，但行为与人类负责人有本质区别：
 * - Agent「出方案」而非「执行工作」
 * - Agent 不参与审批、资源负载、参与人计数
 *
 * 后端在 TaskDto 中通过 `assigneeType` 字段区分；前端所有视图统一消费本模块。
 */

/** 负责人类别。 */
export type AssigneeType = 'user' | 'agent'

/** Agent 负责人引用（对齐后端 AgentDto）。 */
export interface AgentAssignment {
  id: number
  name: string
  initials: string
  /** Agent 模型标识（如 'gpt-4'、'claude-opus-4'），可选。 */
  model?: string
}

/** 判断是否 agent 负责人。 */
export function isAgentAssignee(assigneeType?: AssigneeType | null): boolean {
  return assigneeType === 'agent'
}

/** 负责人显示名称（agent 带模型后缀）。 */
export function assigneeDisplayName(
  assignee: { fullName?: string | null; email?: string } | undefined | null,
  assigneeType?: AssigneeType | null,
  agentModel?: string,
): string {
  if (isAgentAssignee(assigneeType)) {
    const name = assignee?.fullName || assignee?.email || 'AI'
    return agentModel ? `${name}（${agentModel}）` : name
  }
  return assignee?.fullName || assignee?.email || '未分配'
}

/** Agent 分配状态标签（用于 UI 展示，非执行）。 */
export const AGENT_ACTION_LABEL = 'AI 出方案' as const

/** Agent 负责人 aria 标签前缀。 */
export const AGENT_ARIA_PREFIX = 'AI 负责人' as const
