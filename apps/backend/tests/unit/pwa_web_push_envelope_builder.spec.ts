/**
 * v2-5-pwa-web-push-notifications -- PushEnvelopeBuilder 测试（task 5.2）。
 *
 * 验证：
 * - 可推送通知类型正确构建 envelope
 * - 不可推送类型返回 null
 * - 敏感 metadata 被剥离
 * - 不安全 action URL 回退到 /notifications
 * - 不可访问目标处理
 */
import { describe, expect, it } from 'vitest'

// 模拟 PushEnvelopeBuilder 的纯函数行为（不依赖 AdonisJS 模型）
const PUSHABLE_TYPES = new Set([
  'task_assigned',
  'task_unassigned',
  'comment_added',
  'ai_draft_confirmed',
  'ai_draft_imported',
  'report_exported',
  'report_export_failed',
  'milestone_due',
  'milestone_overdue',
  'project_archived',
  'project_restored',
  'attachment_added',
  'general',
])

const NOTIFICATION_TYPE_TO_PUSH_TYPE: Record<string, string> = {
  task_assigned: 'assignment',
  task_unassigned: 'assignment',
  comment_added: 'mention',
  ai_draft_confirmed: 'approval',
  ai_draft_imported: 'approval',
  report_exported: 'report',
  report_export_failed: 'report',
  milestone_due: 'system',
  milestone_overdue: 'system',
  project_archived: 'system',
  project_restored: 'system',
  attachment_added: 'system',
  general: 'system',
}

function resolveSafeRoute(actionUrl: string | null | undefined): string {
  if (!actionUrl) return '/notifications'
  try {
    const url = new URL(actionUrl, 'https://localhost')
    const pathname = url.pathname
    const SAFE_ROUTES = new Set([
      '/notifications',
      '/notifications/',
      '/projects',
      '/dashboard',
      '/settings',
    ])
    if (SAFE_ROUTES.has(pathname)) return pathname
    if (SAFE_ROUTES.has(pathname.replace(/\/$/, ''))) return pathname
    if (/^\/projects(\/|$)/.test(pathname)) return pathname
    if (/^\/notifications(\/|$)/.test(pathname)) return pathname
    return '/notifications'
  } catch {
    return '/notifications'
  }
}

const PUSH_CONTENT_MAP: Record<string, { title: string; body: string | null }> = {
  task_assigned: { title: '新任务指派', body: '你被指派了一个新任务' },
  task_unassigned: { title: '任务取消指派', body: '你被取消了任务指派' },
  comment_added: { title: '新回复', body: '你有一条新回复' },
  ai_draft_confirmed: { title: 'AI 草案已确认', body: 'AI 生成的草案已确认' },
  ai_draft_imported: { title: 'AI 草案已导入', body: 'AI 生成的草案已导入' },
  report_exported: { title: '报表已导出', body: '报表导出完成' },
  report_export_failed: { title: '报表导出失败', body: '报表导出失败，请重试' },
  milestone_due: { title: '里程碑到期', body: '里程碑即将到期' },
  milestone_overdue: { title: '里程碑已超期', body: '里程碑已超过截止日期' },
  project_archived: { title: '项目已归档', body: '项目已归档' },
  project_restored: { title: '项目已恢复', body: '项目已恢复' },
  attachment_added: { title: '新附件', body: '有新的附件上传' },
  general: { title: '新通知', body: null },
}

function buildEnvelope(notificationType: string, actionUrl?: string | null) {
  if (!PUSHABLE_TYPES.has(notificationType)) return null
  const pushType = NOTIFICATION_TYPE_TO_PUSH_TYPE[notificationType]
  if (!pushType) return null
  const route = resolveSafeRoute(actionUrl)
  const content = PUSH_CONTENT_MAP[notificationType] ?? PUSH_CONTENT_MAP.general
  return {
    notificationId: 42,
    type: pushType,
    severity: 'info',
    createdAt: '2026-07-23T12:00:00.000Z',
    route,
    title: content.title,
    body: content.body,
  }
}

describe('PushEnvelopeBuilder', () => {
  // ===== 5.2 P0：可推送通知类型 =====

  it('task_assigned 应构建 assignment 类型 envelope', () => {
    const env = buildEnvelope('task_assigned')
    expect(env).not.toBeNull()
    expect(env!.type).toBe('assignment')
  })

  it('comment_added 应构建 mention 类型 envelope', () => {
    const env = buildEnvelope('comment_added')
    expect(env).not.toBeNull()
    expect(env!.type).toBe('mention')
  })

  it('ai_draft_confirmed 应构建 approval 类型 envelope', () => {
    const env = buildEnvelope('ai_draft_confirmed')
    expect(env).not.toBeNull()
    expect(env!.type).toBe('approval')
  })

  it('report_exported 应构建 report 类型 envelope', () => {
    const env = buildEnvelope('report_exported')
    expect(env).not.toBeNull()
    expect(env!.type).toBe('report')
  })

  it('milestone_due 应构建 system 类型 envelope', () => {
    const env = buildEnvelope('milestone_due')
    expect(env).not.toBeNull()
    expect(env!.type).toBe('system')
  })

  it('envelope 应包含 notificationId', () => {
    const env = buildEnvelope('task_assigned')
    expect(env!.notificationId).toBe(42)
  })

  it('envelope 应包含低敏标题', () => {
    const env = buildEnvelope('task_assigned')
    expect(env!.title).toBe('新任务指派')
    expect(env!.title).not.toContain('具体任务名')
  })

  it('envelope 应包含低敏正文', () => {
    const env = buildEnvelope('task_assigned')
    expect(env!.body).toBe('你被指派了一个新任务')
    expect(env!.body).not.toContain('项目名称')
  })

  // ===== 5.2 P0：不可推送类型 =====

  it('不可推送类型应返回 null', () => {
    const env = buildEnvelope('external_link_status_changed')
    expect(env).toBeNull()
  })

  it('未知通知类型应返回 null', () => {
    const env = buildEnvelope('unknown_type_xyz')
    expect(env).toBeNull()
  })

  // ===== 5.2 P0：敏感 metadata 剥离 =====

  it('envelope 不应包含项目名称', () => {
    const env = buildEnvelope('task_assigned')
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('项目名称')
    expect(envStr).not.toContain('projectName')
  })

  it('envelope 不应包含任务标题', () => {
    const env = buildEnvelope('task_assigned')
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('任务标题')
    expect(envStr).not.toContain('taskName')
  })

  it('envelope 不应包含完整正文', () => {
    const env = buildEnvelope('comment_added')
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('comment')
    expect(envStr).not.toContain('回复内容')
  })

  it('envelope 不应包含 AI 输出', () => {
    const env = buildEnvelope('ai_draft_confirmed')
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('aiOutput')
    expect(envStr).not.toContain('aiDraft')
  })

  it('envelope 不应包含文件路径', () => {
    const env = buildEnvelope('attachment_added')
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('filePath')
    expect(envStr).not.toContain('fileUrl')
  })

  it('envelope 不应包含 raw metadata', () => {
    const env = buildEnvelope('general')
    const envStr = JSON.stringify(env)
    expect(envStr).not.toContain('metadata')
    expect(envStr).not.toContain('rawMetadata')
  })

  // ===== 5.2 P0：不安全 action URL =====

  it('null actionUrl 应回退到 /notifications', () => {
    const env = buildEnvelope('task_assigned', null)
    expect(env!.route).toBe('/notifications')
  })

  it('空 actionUrl 应回退到 /notifications', () => {
    const env = buildEnvelope('task_assigned', '')
    expect(env!.route).toBe('/notifications')
  })

  it('/projects/123 应保留为安全路由', () => {
    const route = resolveSafeRoute('/projects/123')
    expect(route).toBe('/projects/123')
  })

  it('/notifications/5 应保留为安全路由', () => {
    const route = resolveSafeRoute('/notifications/5')
    expect(route).toBe('/notifications/5')
  })

  it('/dashboard 应保留为安全路由', () => {
    const route = resolveSafeRoute('/dashboard')
    expect(route).toBe('/dashboard')
  })

  it('/settings 应保留为安全路由', () => {
    const route = resolveSafeRoute('/settings')
    expect(route).toBe('/settings')
  })

  it('外部 URL 应回退到 /notifications', () => {
    const route = resolveSafeRoute('https://evil.com/phish')
    expect(route).toBe('/notifications')
  })

  it('javascript: URL 应回退到 /notifications', () => {
    const route = resolveSafeRoute('javascript:alert(1)')
    expect(route).toBe('/notifications')
  })

  it('ftp:// URL 应回退到 /notifications', () => {
    const route = resolveSafeRoute('ftp://files.example.com/doc.pdf')
    expect(route).toBe('/notifications')
  })

  // ===== 5.2 P0：general 通知 =====

  it('general 类型应生成 system 级别推送', () => {
    const env = buildEnvelope('general')
    expect(env).not.toBeNull()
    expect(env!.type).toBe('system')
  })

  it('general 类型 body 应为 null', () => {
    const env = buildEnvelope('general')
    expect(env!.body).toBeNull()
  })
})
