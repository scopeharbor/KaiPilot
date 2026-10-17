/**
 * 审计事件 / 操作 / 级别 / 实体类型的中文标签集中表（polish-v1-ui-and-assignment）。
 *
 * - 与后端 `AuditEvent`（audit_service.ts）全枚举对齐；新增事件未映射时回退原码（不崩）。
 * - 审计日志表、审计详情、项目「最近活动」共用，保证「代号不外泄给用户」这一中文原生红线。
 * - 纯展示层：ID→名称的解析由后端 DTO 负责，这里只做「代号→中文」。
 */

/** 语义事件（metadata.event） → 中文短语。 */
export const EVENT_LABELS: Record<string, string> = {
  // 认证 / 权限
  LOGIN_SUCCESS: '登录成功',
  LOGIN_FAILED: '登录失败',
  LOGOUT: '登出',
  TOKEN_REFRESHED: '刷新令牌',
  PASSWORD_CHANGED: '修改密码',
  // 两步验证
  TWO_FACTOR_ENROLLMENT_STARTED: '开始设置两步验证',
  TWO_FACTOR_ENROLLMENT_SKIPPED: '跳过两步验证绑定',
  TWO_FACTOR_ENABLED: '启用两步验证',
  TWO_FACTOR_DISABLED: '关闭两步验证',
  TWO_FACTOR_CHALLENGE_ISSUED: '发起两步验证',
  TWO_FACTOR_CHALLENGE_SUCCEEDED: '两步验证通过',
  TWO_FACTOR_CHALLENGE_FAILED: '两步验证失败',
  TWO_FACTOR_RECOVERY_CODE_USED: '使用恢复码',
  TWO_FACTOR_RECOVERY_CODES_REGENERATED: '重新生成恢复码',
  PERMISSION_DENIED: '权限被拒',
  ROLE_CHANGED: '变更角色',
  // 用户
  USER_CREATED: '创建用户',
  USER_UPDATED: '更新用户',
  USER_DISABLED: '停用用户',
  USER_ENABLED: '启用用户',
  USER_DELETED: '删除用户',
  // 组织
  ORG_CREATED: '创建组织',
  ORG_UPDATED: '更新组织',
  ORG_DELETED: '删除组织',
  ORG_OWNER_TRANSFERRED: '转移组织所有权',
  MEMBER_INVITED: '邀请成员',
  MEMBER_REMOVED: '移除成员',
  // 项目
  PROJECT_CREATED: '创建项目',
  PROJECT_UPDATED: '更新项目',
  PROJECT_WORKING_CALENDAR_UPDATED: '更新工作日历',
  PROJECT_DELETED: '删除项目',
  PROJECT_ARCHIVED: '归档项目',
  PROJECT_RESTORED: '恢复项目',
  PROJECT_MEMBER_ADDED: '添加项目成员',
  PROJECT_MEMBER_ROLE_CHANGED: '变更成员角色',
  PROJECT_MEMBER_REMOVED: '移除项目成员',
  PROJECT_OWNER_TRANSFERRED: '转移项目所有权',
  // 任务 / WBS
  TASK_CREATED: '创建任务',
  TASK_UPDATED: '更新任务',
  TASK_DELETED: '删除任务',
  TASK_RESTORED: '恢复任务',
  TASK_ASSIGNED: '指派负责人',
  TASK_STATUS_CHANGED: '变更任务状态',
  WBS_NODE_CREATED: '创建 WBS 节点',
  WBS_NODE_UPDATED: '更新 WBS 节点',
  WBS_NODE_MOVED: '移动 WBS 节点',
  WBS_NODE_DELETED: '删除 WBS 节点',
  DEPENDENCY_CREATED: '创建依赖',
  DEPENDENCY_DELETED: '删除依赖',
  // 甘特 / 里程碑
  GANTT_SCHEDULE_COMMITTED: '提交排程调整',
  GANTT_BASELINE_SAVED: '保存基线',
  MILESTONE_CREATED: '创建里程碑',
  MILESTONE_UPDATED: '更新里程碑',
  MILESTONE_DELETED: '删除里程碑',
  MILESTONE_ACHIEVED: '达成里程碑',
  // AI
  AI_CONNECTION_CREATED: '新增 AI 连接',
  AI_CONNECTION_UPDATED: '更新 AI 连接',
  AI_CONNECTION_DELETED: '删除 AI 连接',
  AI_CONNECTION_TESTED: '测试 AI 连接',
  AI_INTENT_ANALYZED: 'AI 意图解析',
  AI_DRAFT_GENERATED: 'AI 生成草案',
  AI_DRAFT_FAILED: 'AI 草案生成失败',
  AI_DRAFT_SAVED: '保存 AI 草案',
  AI_DRAFT_REJECTED: '拒绝 AI 草案',
  AI_DRAFT_CONFIRMED: '确认导入 AI 草案',
  AI_DRAFT_VALIDATED: '校验 AI 草案',
  AI_DRAFT_AUTO_FIXED: '自动修复 AI 草案',
  // 通用 / 资源
  DATA_EXPORTED: '导出数据',
  CONFIG_CHANGED: '变更配置',
  RESOURCE_CREATED: '创建资源',
  RESOURCE_UPDATED: '更新资源',
  RESOURCE_DELETED: '删除资源',
  RESOURCE_ALLOCATION_CREATED: '创建资源分配',
  RESOURCE_ALLOCATION_UPDATED: '更新资源分配',
  RESOURCE_ALLOCATION_DELETED: '删除资源分配',
  // 风险
  RISK_CREATED: '登记风险',
  RISK_UPDATED: '更新风险',
  RISK_DELETED: '删除风险',
  RISK_STATUS_CHANGED: '变更风险状态',
  RISK_AI_SUGGESTED: 'AI 识别风险',
  RISK_AI_ACCEPTED: '采纳 AI 风险',
  RISK_AI_REJECTED: '忽略 AI 风险',
  // 变更请求
  CHANGE_REQUEST_CREATED: '创建变更请求',
  CHANGE_REQUEST_UPDATED: '更新变更请求',
  CHANGE_REQUEST_SUBMITTED: '提交变更请求',
  CHANGE_REQUEST_APPROVED: '批准变更请求',
  CHANGE_REQUEST_REJECTED: '驳回变更请求',
  CHANGE_REQUEST_RETURNED: '退回变更请求',
  CHANGE_REQUEST_IMPLEMENTED: '实施变更请求',
  CHANGE_REQUEST_CLOSED: '关闭变更请求',
  CHANGE_REQUEST_CANCELLED: '取消变更请求',
  // 文件 / 附件
  DOCUMENT_CREATED: '创建文件',
  DOCUMENT_FOLDER_CREATED: '创建文件夹',
  DOCUMENT_UPDATED: '更新文件',
  DOCUMENT_MOVED: '移动文件',
  DOCUMENT_DELETED: '删除文件',
  ATTACHMENT_UPLOADED: '上传附件',
  ATTACHMENT_DOWNLOADED: '下载附件',
  ATTACHMENT_DELETED: '删除附件',
  // 图表
  DIAGRAM_CREATED: '创建图表',
  DIAGRAM_UPDATED: '更新图表',
  DIAGRAM_DELETED: '删除图表',
  DIAGRAM_EXPORTED: '导出图表',
  // 报表
  REPORT_GENERATED: '生成报表',
  REPORT_EXPORTED: '导出报表',
  REPORT_DOWNLOADED: '下载报表',
  REPORT_DOWNLOAD_DENIED: '报表下载被拒',
  REPORT_ACCESS_DENIED: '报表访问被拒',
  // 评论
  COMMENT_CREATED: '发表评论',
  COMMENT_UPDATED: '编辑评论',
  COMMENT_DELETED: '删除评论',
}

/** 底层动作枚举（audit_logs.action） → 中文。 */
export const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  read: '查看',
  update: '更新',
  delete: '删除',
  export: '导出',
  import: '导入',
  login: '登录',
  logout: '登出',
  approve: '批准',
  reject: '拒绝',
  ai_generate: 'AI 生成',
  apply: '应用',
  rollback: '回滚',
}

/** 级别 → 中文。 */
export const SEVERITY_LABELS: Record<string, string> = {
  info: '信息',
  warning: '警告',
  error: '错误',
  critical: '严重',
}

/** 实体类型 → 中文。 */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  project: '项目',
  project_member: '项目成员',
  task: '任务',
  wbs_node: 'WBS 节点',
  milestone: '里程碑',
  dependency: '任务依赖',
  risk: '风险',
  change_request: '变更请求',
  document: '文件',
  attachment: '附件',
  diagram: '图表',
  report: '报表',
  comment: '评论',
  resource: '资源',
  resource_allocation: '资源分配',
  ai_project_draft: 'AI 草案',
  ai_connection: 'AI 连接',
  user: '用户',
  organization: '组织',
  gantt_baseline: '甘特基线',
}

export function eventLabel(event: string | null | undefined): string {
  if (!event) return ''
  return EVENT_LABELS[event] ?? event
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return '-'
  return ACTION_LABELS[action] ?? action
}

export function severityLabel(severity: string | null | undefined): string {
  if (!severity) return '-'
  return SEVERITY_LABELS[severity] ?? severity
}

export function entityTypeLabel(entityType: string | null | undefined): string {
  if (!entityType) return ''
  return ENTITY_TYPE_LABELS[entityType] ?? entityType
}

/**
 * 「事件」优先，回退「操作」：最近活动/审计事件列的统一取名。
 * event 命中中文即用；否则用 action 中文；再否则回退原始 event/action 码。
 */
export function activityLabel(event: string | null | undefined, action: string): string {
  if (event) {
    const mapped = EVENT_LABELS[event]
    if (mapped) return mapped
  }
  return eventLabel(event) || actionLabel(action)
}
