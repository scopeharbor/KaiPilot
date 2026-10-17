import Report from '#models/report'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import type { ProgressSnapshot, ReportGenerateFilters, ReportSnapshot } from '@aiproj/types'

/**
 * preset-project-reports Task 1.5 —— Model JSON 序列化单元测试。
 *
 * 覆盖：
 *   - config  prepare/consume        将对象序列化为 JSON 文本，回读时还原为对象；
 *   - dataSnapshot  prepare/consume  同上；
 *   - formatConfig  prepare/consume  允许 null → null 回读；
 *   - filePath 序列化时隐藏（API 不外泄）；
 *   - 批量写入后 verify 直读（验证 consume 路径的 JSON.parse 正确性）。
 */

test.group('Report Model JSON serialization', (group) => {
  useAuthDatabase(group)

  async function setupMinimalProject() {
    const owner = await createUser({ email: uniqueEmail('rpt-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project }
  }

  test('config 写入后回读为对象而非字符串', async ({ assert }) => {
    const { project } = await setupMinimalProject()

    const config: ReportGenerateFilters = {
      fromDate: '2026-07-01T00:00:00Z',
      toDate: '2026-07-31T00:00:00Z',
      assigneeIds: [1, 2, 3],
    }

    const report = await Report.create({
      projectId: Number(project.id),
      title: '测试报表',
      template: 'progress',
      config,
      dataSnapshot: makeSnapshot(Number(project.id)),
      formatConfig: null,
      generatedAt: null,
      generatedBy: null,
    })

    // 从 DB 重新读取
    const loaded = await Report.findOrFail(report.id)
    assert.isObject(loaded.config)
    assert.equal(loaded.config.fromDate, '2026-07-01T00:00:00Z')
    assert.deepEqual(loaded.config.assigneeIds, [1, 2, 3])
    assert.isNull(loaded.formatConfig)
  })

  test('dataSnapshot 写入后回读保留模板判别与嵌套对象', async ({ assert }) => {
    const { project } = await setupMinimalProject()

    const snapshot = makeSnapshot(Number(project.id))
    snapshot.summary.overallProgressPercent = 42.5
    snapshot.summary.totalTasks = 10
    snapshot.summary.completedTasks = 4
    snapshot.snapshotMetadata.warnings = [
      { level: 'info', message: 'WBS 为空' },
      { level: 'warning', message: '资源模块未启用' },
    ]

    const report = await Report.create({
      projectId: Number(project.id),
      title: '进度快照',
      template: 'progress',
      config: {},
      dataSnapshot: snapshot,
      formatConfig: { includeDetails: true, includeWarnings: true, locale: 'zh-CN' },
      generatedAt: null,
      generatedBy: null,
    })

    const loaded = await Report.findOrFail(report.id)
    assert.equal(loaded.dataSnapshot.template, 'progress')
    const loadedSnapshot = loaded.dataSnapshot as ProgressSnapshot
    assert.equal(loadedSnapshot.summary.overallProgressPercent, 42.5)
    assert.lengthOf(loaded.dataSnapshot.snapshotMetadata.warnings, 2)
    assert.equal(loaded.formatConfig?.locale, 'zh-CN')
  })

  test('config=null/undefined 回读为空对象', async ({ assert }) => {
    const { project } = await setupMinimalProject()

    const r1 = await Report.create({
      projectId: Number(project.id),
      title: 'config null',
      template: 'milestone',
      config: null as unknown as ReportGenerateFilters,
      dataSnapshot: makeSnapshot(Number(project.id)),
      generatedAt: null,
      generatedBy: null,
    })
    const loaded = await Report.findOrFail(r1.id)
    assert.deepEqual(loaded.config, {})
  })

  test('formatConfig=null 回读为 null', async ({ assert }) => {
    const { project } = await setupMinimalProject()
    const r = await Report.create({
      projectId: Number(project.id),
      title: 'format null',
      template: 'delay',
      config: {},
      dataSnapshot: makeSnapshot(Number(project.id)),
      formatConfig: null,
      generatedAt: null,
      generatedBy: null,
    })
    const loaded = await Report.findOrFail(r.id)
    assert.isNull(loaded.formatConfig)
  })

  test('filePath 序列化时隐去（serialize 返回 undefined）', async ({ assert }) => {
    const { project } = await setupMinimalProject()
    const r = await Report.create({
      projectId: Number(project.id),
      title: 'filePath test',
      template: 'workload',
      config: {},
      dataSnapshot: makeSnapshot(Number(project.id)),
      filePath: 'projects/7/reports/1/export.md',
      fileFormat: 'markdown',
      generatedAt: null,
      generatedBy: null,
    })
    const json = r.serialize()
    // Model 显式 `serialize: () => undefined`：API 响应绝不外泄真实磁盘路径
    // （见 report.ts:76）。断言序列化后字段为 undefined，是"下载走安全文件名"
    // 的第一道防线。
    assert.isUndefined(json.filePath)
    // filePath 真实值应存盘（DB 可读，供服务端 stream 时定位物理文件）
    const loaded = await Report.findOrFail(r.id)
    assert.equal(loaded.filePath, 'projects/7/reports/1/export.md')
  })

  test('批量创建不同模板报表后列表可正确反序列化', async ({ assert }) => {
    const { project } = await setupMinimalProject()

    const templates: Array<{
      tpl: 'progress' | 'delay' | 'workload' | 'milestone'
      title: string
    }> = [
      { tpl: 'progress', title: '进度' },
      { tpl: 'delay', title: '延期' },
      { tpl: 'workload', title: '工作量' },
      { tpl: 'milestone', title: '里程碑' },
    ]

    for (const { tpl, title } of templates) {
      const snapshot = { ...makeSnapshot(Number(project.id)), template: tpl } as ReportSnapshot
      await Report.create({
        projectId: Number(project.id),
        title,
        template: tpl,
        config: {},
        dataSnapshot: snapshot,
        generatedAt: null,
        generatedBy: null,
        filePath: null,
        fileFormat: null,
      })
    }

    // useAuthDatabase 只在 group 首次 setup 跑 migration，不做 per-test truncate；
    // 因此 Report.all() 会包含 group 内前面用例已提交的数据。按本用例项目 id 过滤，
    // 隔离出本轮批量写入的 4 条。
    const all = await Report.query().where('project_id', Number(project.id))
    assert.lengthOf(all, 4)
    for (const r of all) {
      assert.isObject(r.dataSnapshot)
      assert.isObject(r.config)
      assert.isString(r.title)
      assert.isString(r.template)
      assert.include(['progress', 'delay', 'workload', 'milestone'], r.template)
    }
  })
})

// ---------------------------------------------------------------------------
// 帮助函数
// ---------------------------------------------------------------------------

function makeSnapshot(projectId: number): ProgressSnapshot {
  return {
    template: 'progress',
    summary: {
      projectId,
      projectName: '测试项目',
      overallProgressPercent: 0,
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      notStartedTasks: 0,
      blockedTasks: 0,
    },
    statusDistribution: [],
    wbsSummaries: [],
    criticalTasks: [],
    blockers: [],
    snapshotMetadata: {
      templateVersion: '1.0',
      generatedAt: new Date().toISOString(),
      generatedBy: null,
      sourceRange: {},
      sourceDataHash: '00000000000000000000000000000000',
      warnings: [],
    },
  }
}
