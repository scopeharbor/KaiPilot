/**
 * report_periodic_notification_activity —— 通知/活动低敏测试（task 6.5）。
 *
 * 验证通知和活动事件：
 * - 不包含报表正文
 * - 不包含 AI prompt
 * - 不包含模型输出
 * - 不包含成本详情
 * - 不包含原始下载 URL
 * - 不可访问目标返回泛化消息
 */
import { test } from '@japa/runner'
import { buildPeriodicReportNotification } from '#services/report_v2/periodic_notification_integration'
import type { PeriodicReportNotificationInput } from '#services/report_v2/periodic_notification_integration'
import { buildPeriodicActivityEvent } from '#services/report_v2/periodic_activity_integration'
import type { PeriodicActivityInput } from '#services/report_v2/periodic_activity_integration'
import PeriodicReportAccessGuard from '#services/report_v2/periodic_access_guard'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

// ---------------------------------------------------------------------------
// 标准输入
// ---------------------------------------------------------------------------

const NOTIFICATION_INPUT: PeriodicReportNotificationInput = {
  organizationId: 1,
  recipientId: 10,
  projectId: 42,
  reportId: 7,
  versionId: 123,
  templateId: 'weekly-ai-summary',
  periodType: 'weekly',
  periodRange: { fromDate: '2026-07-07', toDate: '2026-07-13' },
  title: 'AI 周报摘要',
  event: 'periodic_draft_pending_review',
}

const ACTIVITY_INPUT: PeriodicActivityInput = {
  organizationId: 1,
  projectId: 42,
  userId: 10,
  reportId: 7,
  versionId: 123,
  templateId: 'weekly-ai-summary',
  periodType: 'weekly',
  periodRange: { fromDate: '2026-07-07', toDate: '2026-07-13' },
  event: 'report_draft_generated',
}

// ===========================================================================
// 通知低敏测试
// ===========================================================================

test.group('Periodic Notification — Low-Sensitivity', () => {
  const SENSITIVE_PATTERNS = [
    'executiveSummary',
    'highlights',
    'progressNarrative',
    'riskAndIssues',
    'AiPeriodicDraft',
    'modelSummary',
    'costSummary',
    'promptTokens',
    'completionTokens',
    'estimatedCost',
    'prompt:',
    'model_output',
    'raw_output',
    'download_url',
    'file_path',
    'fileHash',
    'aiDraft',
    'aiCostRef',
  ]

  function testAllEvents(eventLabel: string, event: PeriodicReportNotificationInput['event']) {
    test(`${eventLabel} 通知不包含敏感内容`, ({ assert }) => {
      const input = { ...NOTIFICATION_INPUT, event }
      const result = buildPeriodicReportNotification(input)

      for (const pattern of SENSITIVE_PATTERNS) {
        assert.notInclude(result.body, pattern, `body 不应包含「${pattern}」`)
        assert.notInclude(result.title, pattern, `title 不应包含「${pattern}」`)
        assert.notInclude(
          JSON.stringify(result.metadata),
          pattern,
          `metadata 不应包含「${pattern}」`,
        )
      }

      // 通知正文只含低敏状态摘要
      assert.isString(result.body)
      assert.isAbove(result.body.length, 0)

      // actionUrl 指向项目中低敏目标
      if (result.actionUrl) {
        assert.include(result.actionUrl, '/projects/')
        assert.notInclude(result.actionUrl, 'aiDraft')
        assert.notInclude(result.actionUrl, 'download_url')
      }
    })
  }

  testAllEvents('待审核', 'periodic_draft_pending_review')
  testAllEvents('生成失败', 'periodic_draft_generation_failed')
  testAllEvents('预算阻断', 'periodic_budget_blocked')
  testAllEvents('确认完成', 'periodic_draft_confirmed')
  testAllEvents('退回', 'periodic_draft_returned')
  testAllEvents('导出可用', 'periodic_export_ready')

  test('通知正文不含原始报表数据', ({ assert }) => {
    const input = { ...NOTIFICATION_INPUT }
    const result = buildPeriodicReportNotification(input)

    // 正文不应包含项目具体数值
    assert.notInclude(result.body, '42') // projectId
    assert.notInclude(result.body, '7') // reportId
    assert.notInclude(result.body, '123') // versionId

    // 不含敏感指标
    assert.notMatch(result.body, /完成率/)
    assert.notMatch(result.body, /延期/)

    // 含类型标签
    assert.include(result.body, '周报')
  })

  test('metadata 只含低敏引用', ({ assert }) => {
    const result = buildPeriodicReportNotification(NOTIFICATION_INPUT)
    const meta = result.metadata

    // 低敏字段
    assert.property(meta, 'reportId')
    assert.property(meta, 'versionId')
    assert.property(meta, 'templateId')
    assert.property(meta, 'periodType')
    assert.property(meta, 'periodRange')

    // metadata 值数量合理（不含敏感详情）
    const keys = Object.keys(meta)
    assert.isAtMost(keys.length, 7) // reportId, versionId, templateId, periodType, periodRange(2 fields), status
  })

  test('所有通知类型都有 actionUrl', ({ assert }) => {
    const events: PeriodicReportNotificationInput['event'][] = [
      'periodic_draft_pending_review',
      'periodic_draft_generation_failed',
      'periodic_budget_blocked',
      'periodic_draft_confirmed',
      'periodic_draft_returned',
      'periodic_export_ready',
    ]

    for (const event of events) {
      const result = buildPeriodicReportNotification({ ...NOTIFICATION_INPUT, event })
      assert.isNotNull(result.actionUrl, `${event} 应有 actionUrl`)
      assert.isNotEmpty(result.actionUrl!, `${event} actionUrl 不应为空`)
    }
  })

  test('生成失败通知含 errorCategory', ({ assert }) => {
    const result = buildPeriodicReportNotification({
      ...NOTIFICATION_INPUT,
      event: 'periodic_draft_generation_failed',
      errorCategory: 'ai_timeout',
    })
    assert.include(result.body, 'ai_timeout')
    assert.equal(result.metadata.errorCategory, 'ai_timeout')
  })
})

// ===========================================================================
// 活动事件低敏测试
// ===========================================================================

test.group('Periodic Activity — Low-Sensitivity', () => {
  const SENSITIVE_PATTERNS = [
    'executiveSummary',
    'highlights',
    'progressNarrative',
    'AiPeriodicDraft',
    'modelSummary',
    'costSummary',
    'promptTokens',
    'estimatedCost',
    'aiDraft',
    'aiCostRef',
    'download_url',
    'file_path',
    'fileHash',
  ]

  function testAllEvents(eventLabel: string, event: PeriodicActivityInput['event']) {
    test(`${eventLabel} 活动不包含敏感内容`, ({ assert }) => {
      const input = { ...ACTIVITY_INPUT, event }
      const result = buildPeriodicActivityEvent(input)

      // summary 不含敏感内容
      for (const pattern of SENSITIVE_PATTERNS) {
        assert.notInclude(result.summary, pattern)
        assert.notInclude(JSON.stringify(result.metadata), pattern)
      }

      // targetUrl 指向项目内
      if (result.targetUrl) {
        assert.include(result.targetUrl, '/projects/')
        assert.notInclude(result.targetUrl, 'aiDraft')
      }

      // summary 包含周期类型标签
      assert.include(result.summary, '周报')
    })
  }

  testAllEvents('预览创建', 'report_periodic_preview_created')
  testAllEvents('草稿生成成功', 'report_draft_generated')
  testAllEvents('草稿生成失败', 'report_draft_generation_failed')
  testAllEvents('预算阻断', 'report_budget_blocked')
  testAllEvents('确认完成', 'report_draft_confirmed')
  testAllEvents('退回', 'report_draft_returned')
  testAllEvents('重新生成', 'report_draft_regenerated')
  testAllEvents('导出', 'report_periodic_exported')

  test('活动事件类型标记为 report_activity', ({ assert }) => {
    const result = buildPeriodicActivityEvent(ACTIVITY_INPUT)
    assert.equal(result.type, 'report_activity')
  })

  test('活动 metadata 只含低敏引用', ({ assert }) => {
    const input: PeriodicActivityInput = {
      ...ACTIVITY_INPUT,
      event: 'report_periodic_exported',
      exportFormat: 'markdown',
    }
    const result = buildPeriodicActivityEvent(input)

    assert.property(result.metadata, 'reportId')
    assert.property(result.metadata, 'templateId')
    assert.property(result.metadata, 'periodType')
    assert.property(result.metadata, 'periodRange')
    assert.property(result.metadata, 'exportFormat')

    // 不含完整项目数据
    assert.notProperty(result.metadata, 'projectName')
    assert.notProperty(result.metadata, 'aiDraft')
    assert.notProperty(result.metadata, 'costSummary')
  })

  test('导出活动含格式信息', ({ assert }) => {
    const result = buildPeriodicActivityEvent({
      ...ACTIVITY_INPUT,
      event: 'report_periodic_exported',
      exportFormat: 'pdf',
    })
    assert.include(result.summary, 'pdf')
    assert.equal(result.metadata.exportFormat, 'pdf')
  })
})

// ===========================================================================
// 访问守卫测试
// ===========================================================================

test.group('Periodic Report Access Guard', (group) => {
  useAuthDatabase(group)

  test('项目不存在返回 inaccessible', async ({ assert }) => {
    const guard = new PeriodicReportAccessGuard()
    const result = await guard.checkAccess(1, 1, 99999)
    assert.equal(result.status, 'inaccessible')
    assert.equal(result.inaccessibleMessage, '目标不可访问')
    assert.equal(result.project ?? null, null)
  })

  test('非活跃成员返回 inaccessible', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('guard1') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const outsider = await createUser({ email: uniqueEmail('guard2') })

    const guard = new PeriodicReportAccessGuard()
    const result = await guard.checkAccess(Number(outsider.id), Number(org.id), Number(project.id))

    assert.equal(result.status, 'inaccessible')
    assert.equal(result.inaccessibleMessage, '目标不可访问')
  })

  test('可访问时返回项目基本信息', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('guard3') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const guard = new PeriodicReportAccessGuard()
    const result = await guard.checkAccess(Number(owner.id), Number(org.id), Number(project.id))

    assert.equal(result.status, 'accessible')
    assert.isNotNull(result.project)
    assert.equal(result.project!.id, Number(project.id))
    assert.isString(result.project!.name)
  })

  test('quickCheckPeriodicReportAccess 快捷校验', async ({ assert }) => {
    const { quickCheckPeriodicReportAccess } =
      await import('#services/report_v2/periodic_access_guard')
    const owner = await createUser({ email: uniqueEmail('guard4') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const ok = await quickCheckPeriodicReportAccess(
      Number(owner.id),
      Number(org.id),
      Number(project.id),
    )
    assert.isTrue(ok)

    const nog = await quickCheckPeriodicReportAccess(999, Number(org.id), Number(project.id))
    assert.isFalse(nog)
  })

  test('inaccessible 不泄露项目信息', async ({ assert }) => {
    const guard = new PeriodicReportAccessGuard()
    const result = await guard.checkAccess(1, 1, 99999)

    assert.equal(result.status, 'inaccessible')
    assert.isNull(result.project ?? null)
    assert.equal(result.inaccessibleMessage, '目标不可访问')
    // 不包含任何项目名称或 ID
    assert.notMatch(result.inaccessibleMessage ?? '', /\d+/)
  })
})
