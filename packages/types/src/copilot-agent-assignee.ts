// v3-copilot-agent-as-assignee —— AI Agent 作为任务执行人的共享契约。
//
// Red Line 2：Agent assignee 产出的是 pending draft，不是直接变更。
// Agent 不可被选为审批人，不计入资源负载/容量/参与者。
// Agent 分配必须附带 due time；逾期分配可见地回退到人类。
// 不得在分配记录中存储 prompt、model output、token 或 secret。

// ---------------------------------------------------------------------------
// Assignee 类型：区分人类用户与 AI Agent
// ---------------------------------------------------------------------------

export const ASSIGNEE_TYPES = ['user', 'agent'] as const
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number]

/**
 * 类型守卫：验证输入是否为合法的 AssigneeType。
 */
export function validateAssigneeType(type: string): type is AssigneeType {
  return (ASSIGNEE_TYPES as readonly string[]).includes(type)
}

// ---------------------------------------------------------------------------
// Agent 分配状态枚举
// ---------------------------------------------------------------------------

export const AGENT_ASSIGNMENT_STATUSES = ['pending', 'completed', 'overdue', 'failed'] as const
export type AgentAssignmentStatus = (typeof AGENT_ASSIGNMENT_STATUSES)[number]

/**
 * 状态守卫：验证输入是否为合法的 AgentAssignmentStatus。
 */
export function isAgentAssignmentStatus(status: string): status is AgentAssignmentStatus {
  return (AGENT_ASSIGNMENT_STATUSES as readonly string[]).includes(status)
}

// ---------------------------------------------------------------------------
// 合法状态转换表（pending → completed/overdue/failed；终态不可逆）
// ---------------------------------------------------------------------------

export const AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS: Record<
  AgentAssignmentStatus,
  readonly AgentAssignmentStatus[]
> = {
  pending: ['completed', 'overdue', 'failed'],
  completed: [],
  overdue: [],
  failed: [],
}

/**
 * 判断目标状态转换是否合法。
 */
export function isValidAgentAssignmentTransition(
  from: AgentAssignmentStatus,
  to: AgentAssignmentStatus,
): boolean {
  return AGENT_ASSIGNMENT_ALLOWED_TRANSITIONS[from].includes(to)
}

// ---------------------------------------------------------------------------
// Agent 分配业务规则
// ---------------------------------------------------------------------------

/**
 * 是否必须附带 due time。Agent 分配必须有截止时间，人类分配可选。
 */
export function requiresDueTime(assigneeType: AssigneeType): boolean {
  return assigneeType === 'agent'
}

// ---------------------------------------------------------------------------
// 敏感数据检测
// ---------------------------------------------------------------------------

/** 在分配记录中禁止出现的键名模式（不区分大小写子串匹配）。 */
const SENSITIVE_KEY_PATTERNS = [
  'prompt',
  'modeloutput',
  'model_output',
  'modelOutput',
  'token',
  'secret',
  'apikey',
  'api_key',
  'apiKey',
  'password',
  'authorization',
]

/**
 * 检查分配记录是否包含敏感数据（prompt/model output/token/secret）。
 * 匹配键名的大小写不敏感子串；抛出 Error 并列出命中的键。
 */
export function assertNoSensitiveData(record: Record<string, unknown>): void {
  const hits: string[] = []
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase()
    for (const pattern of SENSITIVE_KEY_PATTERNS) {
      if (lower.includes(pattern)) {
        hits.push(key)
        break
      }
    }
  }
  if (hits.length > 0) {
    throw new Error(`Agent assignment record contains sensitive keys: ${hits.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// AgentAssignment 实体（对应数据库 agent_assignments 表行）
// ---------------------------------------------------------------------------

export interface AgentAssignment {
  /** 主键 ID */
  id: number
  /** 关联任务 ID */
  taskId: number
  /** 关联项目 ID */
  projectId: number
  /** 所属组织 ID（组织级数据隔离） */
  organizationId: number
  /** 分配对象类型：user 或 agent */
  assigneeType: AssigneeType
  /** 分配对象 ID（agent 分配时为 agent 注册 ID；user 分配时为用户 ID） */
  assigneeId: number | null
  /** 执行分配操作的用户 ID */
  assignedBy: number
  /** 截止时间（ISO 8601）；agent 分配时必填 */
  dueTime: string
  /** 当前状态 */
  status: AgentAssignmentStatus
  /** 审计时间戳 */
  createdAt: string
  /** 审计时间戳 */
  updatedAt: string
}

// ---------------------------------------------------------------------------
// AgentAssignmentInput —— 创建/更新分配的请求体
// ---------------------------------------------------------------------------

export interface AgentAssignmentInput {
  /** 目标任务 ID */
  taskId: number
  /** 分配对象类型 */
  assigneeType: AssigneeType
  /** 分配对象 ID（agent 时可为 null，由系统分配） */
  assigneeId?: number | null
  /** 截止时间（ISO 8601）；agent 分配时必填 */
  dueTime: string
}

// ---------------------------------------------------------------------------
// AgentAssignmentOverdueResult —— 逾期回退结果
// ---------------------------------------------------------------------------

export interface AgentAssignmentOverdueResult {
  /** 关联任务 ID */
  taskId: number
  /** 逾期的分配记录 ID */
  assignmentId: number
  /** 逾期判定时间 */
  clearedAt: string
  /** 已通知的用户 ID 列表 */
  notifiedUsers: number[]
}

// ---------------------------------------------------------------------------
// Fixtures —— 五种标准状态的测试夹具
// ---------------------------------------------------------------------------

/**
 * 标准 agent 分配（pending，含 due time）。
 */
export function makeAgentAssignment(overrides?: Partial<AgentAssignment>): AgentAssignment {
  return {
    id: 1,
    taskId: 100,
    projectId: 10,
    organizationId: 1,
    assigneeType: 'agent',
    assigneeId: null,
    assignedBy: 42,
    dueTime: '2026-08-20T18:00:00.000Z',
    status: 'pending',
    createdAt: '2026-08-18T09:00:00.000Z',
    updatedAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  }
}

/**
 * 缺少 due time 的 agent 分配（应被拒绝）。
 */
export function makeAgentAssignmentNoDueTime(): AgentAssignmentInput {
  return {
    taskId: 100,
    assigneeType: 'agent',
    assigneeId: null,
    dueTime: '',
  }
}

/**
 * 已完成的 agent 分配（agent 已产出 pending draft）。
 */
export function makeAgentAssignmentCompleted(): AgentAssignment {
  return makeAgentAssignment({
    id: 2,
    status: 'completed',
    dueTime: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T11:45:00.000Z',
  })
}

/**
 * 逾期的 agent 分配（需要回退到人类）。
 */
export function makeAgentAssignmentOverdue(): AgentAssignment {
  return makeAgentAssignment({
    id: 3,
    status: 'overdue',
    dueTime: '2026-08-17T18:00:00.000Z',
    updatedAt: '2026-08-18T09:00:00.000Z',
  })
}

/**
 * 未授权的 agent 分配尝试（assignedBy 与项目无权限关系）。
 */
export function makeAgentAssignmentUnauthorized(): AgentAssignment {
  return makeAgentAssignment({
    id: 4,
    assignedBy: 999,
    organizationId: 99,
    projectId: 999,
    updatedAt: '2026-08-18T09:00:00.000Z',
  })
}
