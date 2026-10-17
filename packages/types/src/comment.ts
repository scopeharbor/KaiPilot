/**
 * v2-collaboration-comments-mentions —— V2 评论系统共享类型扩展。
 *
 * V1 basic-comments 基础上新增：
 * - 统一实体评论（entity_type + entity_id）
 * - 回复线程（parent_id 一级）
 * - 评论状态（open/resolved）
 * - 结构化 @提及（comment_mentions 读模型）
 * - 低敏摘要
 */

// ---------------------------------------------------------------------------
// 评论目标实体类型（V2 扩展）
// ---------------------------------------------------------------------------

export const COMMENT_ENTITY_TYPES = [
  'project',
  'task',
  'milestone',
  'risk',
  'file',
  'change_request',
] as const
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number]

// ---------------------------------------------------------------------------
// 正文格式
// ---------------------------------------------------------------------------

export const COMMENT_BODY_FORMATS = ['plain', 'markdown'] as const
export type CommentBodyFormat = (typeof COMMENT_BODY_FORMATS)[number]

// ---------------------------------------------------------------------------
// 评论状态
// ---------------------------------------------------------------------------

export const COMMENT_STATUSES = ['open', 'resolved'] as const
export type CommentStatus = (typeof COMMENT_STATUSES)[number]

// ---------------------------------------------------------------------------
// 提及对象
// ---------------------------------------------------------------------------

export interface CommentMention {
  id: number
  commentId: number
  mentionedUserId: number
  createdBy: number
  createdAt: string
  /** 填充的用户信息（仅列表/详情场景） */
  mentionedUser?: {
    id: number
    fullName: string
    email: string
    avatarUrl?: string | null
  } | null
}

// ---------------------------------------------------------------------------
// 评论实体（V2 API 响应）
// ---------------------------------------------------------------------------

export interface Comment {
  id: number
  organizationId: number
  projectId: number
  entityType: CommentEntityType
  entityId: number
  /**
   * V1 任务评论兼容字段。V2 统一使用 entityType/entityId；
   * 当 entityType='task' 时 taskId 可由 entityId 镜像得到。
   */
  taskId?: number | null
  /** V1 前端兼容别名，等价于 entityType。 */
  targetType?: CommentEntityType
  authorId: number
  /** V3：作者类型（user | agent），区分真人与 Copilot */
  authorType?: 'user' | 'agent'
  body: string | null
  bodyFormat: CommentBodyFormat
  parentId: number | null
  status: CommentStatus
  resolvedBy: number | null
  resolvedAt: string | null
  editedAt: string | null
  deletedAt: string | null
  deletedBy: number | null
  createdAt: string
  updatedAt: string
  /** 计算属性 */
  isDeleted: boolean
  isEdited: boolean
  isResolved: boolean
  replyCount: number
}

// ---------------------------------------------------------------------------
// 评论详情（含作者信息 + 回复 + 提及）
// ---------------------------------------------------------------------------

export interface CommentWithAuthor extends Comment {
  author: {
    id: number
    fullName: string
    email: string
    avatarUrl?: string | null
  } | null
  /** V3：作者类型（user | agent），区分真人与 Copilot */
  authorType?: 'user' | 'agent'
  mentions?: CommentMention[]
  replies?: CommentWithAuthor[]
}

// ---------------------------------------------------------------------------
// 低敏摘要（用于通知、活动、实时 payload）
// ---------------------------------------------------------------------------

export interface CommentSummary {
  id: number
  entityType: CommentEntityType
  entityId: number
  authorId: number
  /** 正文截断，最长 200 字符 */
  bodyExcerpt: string
  hasReplies: boolean
  isResolved: boolean
  mentionedUserIds: number[]
  createdAt: string
}

// ---------------------------------------------------------------------------
// 创建评论请求（V2）
// ---------------------------------------------------------------------------

export interface CreateCommentRequest {
  /** 评论正文（去除首尾空白后 1-5000 字符） */
  body: string
  /** 正文格式（默认 plain） */
  bodyFormat?: CommentBodyFormat
  /** 回复的目标根评论 ID（可选，用于回复） */
  parentId?: number | null
  /** 提及的用户 ID 列表 */
  mentions?: number[]
}

// ---------------------------------------------------------------------------
// 更新评论请求（V2）
// ---------------------------------------------------------------------------

export interface UpdateCommentRequest {
  /** 评论正文（去除首尾空白后 1-5000 字符） */
  body?: string
  /** 正文格式 */
  bodyFormat?: CommentBodyFormat
}

// ---------------------------------------------------------------------------
// 评论列表查询参数（V2）
// ---------------------------------------------------------------------------

export interface ListCommentsQuery {
  page?: number
  perPage?: number
  /** 排序字段（默认 -createdAt，支持 -createdAt 降序、createdAt 升序） */
  sort?: string
  /** 状态筛选（open/resolved） */
  status?: CommentStatus
}

// ---------------------------------------------------------------------------
// 评论分页响应（V2）
// ---------------------------------------------------------------------------

export interface CommentsListResponse {
  data: CommentWithAuthor[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// ---------------------------------------------------------------------------
// 评论权限字段（用于前端权限守卫）
// ---------------------------------------------------------------------------

export interface CommentPermissions {
  canView: boolean
  canCreate: boolean
  canUpdateSelf: boolean
  canDeleteSelf: boolean
  canModerate: boolean
  canResolve: boolean
}

// ---------------------------------------------------------------------------
// 评论统计
// ---------------------------------------------------------------------------

export interface CommentCount {
  entityType: CommentEntityType
  entityId: number
  count: number
}

// ---------------------------------------------------------------------------
// 提及候选（前端输入 @ 时请求）
// ---------------------------------------------------------------------------

export interface MentionCandidate {
  userId: number
  fullName: string
  email: string
  avatarUrl?: string | null
}

// ---------------------------------------------------------------------------
// v3-copilot-comment-thread-agent —— Agent 身份契约
// ---------------------------------------------------------------------------

/** 评论作者类型：user（真人）或 agent（Copilot） */
export const COMMENT_AUTHOR_TYPES = ['user', 'agent'] as const
export type CommentAuthorType = (typeof COMMENT_AUTHOR_TYPES)[number]

/** 特殊 agent 作者标识（不写入 users 表） */
export const COPILOT_AGENT_ID = -1 as const
export const COPILOT_AGENT_NAME = 'Copilot' as const

/**
 * 提及候选中的 Copilot 特殊条目。
 * 与 MentionCandidate 形状兼容但 userId 为负数标识，
 * 前端通过 authorType==='agent' 区分。
 */
export interface CopilotMentionEntry {
  /** 特殊负数标识，不指向 users 表 */
  userId: typeof COPILOT_AGENT_ID
  fullName: typeof COPILOT_AGENT_NAME
  email: ''
  avatarUrl: null
  /** 区分 Copilot 与真人用户 */
  authorType: 'agent'
}

/**
 * 讨论串上下文进入回合的形状。
 * 有界低敏摘要 + 来源引用，不含 prompt / 模型输出 / token / secret。
 */
export interface ThreadContextForTurn {
  /** 讨论串所属实体引用 */
  entityRef: string
  /** 此前若干条评论的低敏摘要（按字节预算截断） */
  summaries: Array<{
    commentId: number
    authorName: string
    /** 正文截断，最长 200 字符 */
    bodyExcerpt: string
    createdAt: string
  }>
  /** 是否因字节预算截断 */
  truncated: boolean
  /** 截断时已用字节数 */
  contextBytesUsed: number
  /** 字节预算上限 */
  contextBytesLimit: number
}

/**
 * Copilot 回复落评论表时的 authorType 标记。
 */
export interface AgentCommentMetadata {
  authorType: 'agent'
  /** 回合 ID，用于追溯 */
  turnId?: string
}

// ---------------------------------------------------------------------------
// 禁存约束敏感样本（用于负例测试）
// ---------------------------------------------------------------------------

export const COPILOT_COMMENT_SENSITIVE_SAMPLES = [
  'sk-ant-api03-',
  'Bearer eyJhbGciOi',
  'password=secret123',
  'apiKey: "ghp_"',
  'Authorization: Basic',
  'SELECT * FROM users WHERE',
  'curl -H "Authorization"',
] as const

/**
 * 禁存约束验证：检查字符串是否包含敏感样本。
 */
export function containsSensitiveSample(text: string): string | null {
  for (const sample of COPILOT_COMMENT_SENSITIVE_SAMPLES) {
    if (text.includes(sample)) return sample
  }
  return null
}
