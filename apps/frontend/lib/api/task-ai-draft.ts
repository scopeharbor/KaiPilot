import { apiFetch } from '@/lib/api-client'
import type { CreateTaskInput, TaskPriority } from '@/lib/api/tasks'

/** 看板「在此列新建任务」的 AI 补全结果（草稿，不落库）。 */
export interface TaskAiDraft {
  name: string
  description: string
  /** 工作日；0.5 表示半天。 */
  durationDays: number
  priority: TaskPriority
  wbsNodeId: number | null
  wbsNodeName: string | null
  roleHint: string | null
  doneCriteria: string[]
  steps: string[]
  /** 描述的事超过 2 天时的拆分建议（空数组表示一张卡就够）。 */
  split: Array<{ name: string; durationDays: number; doneCriteria: string[]; steps: string[] }>
  note: string | null
}

export const taskAiDraftApi = {
  draft: (
    projectId: number,
    input: {
      description: string
      liveOutputId?: string
      connectionId?: number
      modelId?: number
      /** 互动调整：对上一版草稿的修改意见（带 previous 一起发）。 */
      instruction?: string
      previous?: TaskAiDraft
    },
  ) =>
    apiFetch<TaskAiDraft>(`/projects/${projectId}/tasks/ai-draft`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

/** 任务说明：正文 + 完成标准 + 可打勾的执行步骤（与 AI 草案转正的任务格式一致）。 */
export function taskAiDescription(input: {
  description: string
  doneCriteria: string[]
  steps: string[]
}): string {
  const parts = [input.description.trim()]
  if (input.doneCriteria.length > 0) {
    parts.push(`**完成标准**：\n${input.doneCriteria.map((item) => `- ${item}`).join('\n')}`)
  }
  if (input.steps.length > 0) {
    parts.push(`**执行步骤**：\n${input.steps.map((item) => `- [ ] ${item}`).join('\n')}`)
  }
  return parts.filter(Boolean).join('\n\n')
}

/** 把一张 AI 草稿卡转成建任务请求（工期半天也按 1 个排期日记，工时按 8 小时 / 天）。 */
export function taskAiCreateInput(input: {
  name: string
  description: string
  durationDays: number
  priority: TaskPriority
  status: CreateTaskInput['status']
  startDate: string
  wbsNodeId: number | null
  roleHint: string | null
  doneCriteria: string[]
  steps: string[]
}): CreateTaskInput {
  return {
    name: input.name.trim(),
    description: taskAiDescription(input),
    status: input.status,
    priority: input.priority,
    startDate: input.startDate,
    durationDays: Math.max(1, Math.ceil(input.durationDays)),
    estimatedHours: Math.round(input.durationDays * 8),
    ...(input.wbsNodeId ? { wbsNodeId: input.wbsNodeId } : {}),
    customFields: {
      execution: {
        purpose: input.description.trim(),
        doneCriteria: input.doneCriteria,
        steps: input.steps,
        ...(input.roleHint ? { roleHint: input.roleHint } : {}),
      },
      source: 'kanban-ai-draft',
    },
  }
}
