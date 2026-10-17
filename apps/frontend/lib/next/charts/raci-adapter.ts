/**
 * RACI 责任分配矩阵数据适配器（v3-chart-gallery-tier2-governance-matrices W1 · task 1.2）。
 *
 * 职责：
 * 1. 纯函数下沉解析后端 `RaciMatrixResponse` 信封；
 * 2. 交叉映射任务行与成员列，组装二维矩阵模型；
 * 3. 统计单 A（Accountable）完整性视觉校验状态（恰 1 个 A 属于正常中性，0 个或 >1 个 A 赋予中性提示）；
 * 4. 零感性指责或惊恐词汇，恪守 DOM 中性规范；
 * 5. 处理无成员或无任务时的空态降级。
 */
import type {
  RaciMatrixResponse,
  RaciMember,
  RaciRole,
  RaciTaskSummary,
} from '@/lib/api/project-metrics'
import { TASK_STATUS_LABELS } from '@/lib/task-status'

export type AccountableStatus = 'normal' | 'missing' | 'multiple'

export interface RaciMemberColumn {
  id: number
  displayName: string
  email: string
  role: string
}

export interface RaciMatrixCell {
  userId: number
  roles: RaciRole[]
}

export interface RaciMatrixRow {
  taskId: number
  taskName: string
  taskStatus: string
  taskStatusLabel: string
  accountableCount: number
  accountableStatus: AccountableStatus
  accountableHint: string
  hasAccountableDeviation: boolean
  cells: Record<number, RaciRole[]>
}

export interface RaciMatrixViewModel {
  members: RaciMemberColumn[]
  rows: RaciMatrixRow[]
  totalTasks: number
  totalMembers: number
  normalAccountableCount: number
  deviatedAccountableCount: number
  isEmpty: boolean
}

export const RACI_ROLE_DEFINITIONS: Record<
  RaciRole,
  { label: string; name: string; description: string; className: string }
> = {
  R: {
    label: 'R',
    name: '执行人 (Responsible)',
    description: '具体负责执行与落实该任务的成员',
    className:
      'bg-[var(--nx-accent)]/15 text-[var(--nx-accent)] border border-[var(--nx-accent)]/30 font-semibold',
  },
  A: {
    label: 'A',
    name: '负责/审核人 (Accountable)',
    description: '对交付成果拥有最终决策与审核责任的成员（原则上每项任务有且仅有一位）',
    className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold',
  },
  C: {
    label: 'C',
    name: '咨询人 (Consulted)',
    description: '在任务执行过程中提供专业输入与顾问意见的双向沟通成员',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30 font-medium',
  },
  I: {
    label: 'I',
    name: '知会人 (Informed)',
    description: '在任务进度或状态更新时需及时通报的单向知晓成员',
    className: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 font-medium',
  },
}

export function formatMemberDisplayName(member: RaciMember): string {
  if (member.name && member.name.trim()) return member.name.trim()
  if (member.email && member.email.trim()) return member.email.trim()
  return `成员 #${member.id}`
}

export function formatMemberRole(member: RaciMember): string {
  if (member.role && member.role.trim()) return member.role.trim()
  return '项目成员'
}

/**
 * 评估任务的 Accountable 完整性：
 * - 恰 1 个 A：标准中性
 * - 0 个 A：当前任务未设置审核人（中性提示）
 * - >1 个 A：当前任务设置了多位审核人（中性提示）
 */
export function evaluateAccountableIntegrity(count: number): {
  status: AccountableStatus
  hint: string
  hasDeviation: boolean
} {
  if (count === 1) {
    return {
      status: 'normal',
      hint: '已配置 1 位审核人',
      hasDeviation: false,
    }
  }
  if (count === 0) {
    return {
      status: 'missing',
      hint: '当前任务未设置审核人',
      hasDeviation: true,
    }
  }
  return {
    status: 'multiple',
    hint: '当前任务设置了多位审核人',
    hasDeviation: true,
  }
}

/**
 * 构建 RACI 视图模型纯函数。
 */
export function buildRaciViewModel(
  data: RaciMatrixResponse | null | undefined,
): RaciMatrixViewModel {
  if (!data || !data.members || !data.tasks) {
    return {
      members: [],
      rows: [],
      totalTasks: 0,
      totalMembers: 0,
      normalAccountableCount: 0,
      deviatedAccountableCount: 0,
      isEmpty: true,
    }
  }

  const members: RaciMemberColumn[] = data.members.map((m) => ({
    id: m.id,
    displayName: formatMemberDisplayName(m),
    email: m.email || '',
    role: formatMemberRole(m),
  }))

  const rawMatrix = data.matrix || {}
  let normalCount = 0
  let deviatedCount = 0

  const rows: RaciMatrixRow[] = data.tasks.map((task: RaciTaskSummary) => {
    const taskCells = rawMatrix[task.id] || {}
    let aCount = 0
    const cellMap: Record<number, RaciRole[]> = {}

    for (const member of members) {
      const roles = taskCells[member.id] || []
      cellMap[member.id] = roles
      if (roles.includes('A')) {
        aCount++
      }
    }

    const { status: aStatus, hint, hasDeviation } = evaluateAccountableIntegrity(aCount)
    if (hasDeviation) {
      deviatedCount++
    } else {
      normalCount++
    }

    const taskStatusLabel =
      (TASK_STATUS_LABELS as Record<string, string>)[task.status] || task.status

    return {
      taskId: task.id,
      taskName: task.name,
      taskStatus: task.status,
      taskStatusLabel,
      accountableCount: aCount,
      accountableStatus: aStatus,
      accountableHint: hint,
      hasAccountableDeviation: hasDeviation,
      cells: cellMap,
    }
  })

  const isEmpty = members.length === 0 || rows.length === 0

  return {
    members,
    rows,
    totalTasks: rows.length,
    totalMembers: members.length,
    normalAccountableCount: normalCount,
    deviatedAccountableCount: deviatedCount,
    isEmpty,
  }
}
