import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import {
  previewReport,
  checkBlockingWarnings,
  createReportVersion,
  retryJob,
} from '#services/report_v2/generation_service'
import ReportVersion from '#models/report_version'

test.group('Report V2 — Preview / Dry-run', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rv2-gen') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('preview progress 模板返回有效结果且不创建版本', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const result = await previewReport(Number(org.id), Number(project.id), Number(owner.id), {
      templateId: 'progress',
    })

    assert.equal(result.templateId, 'progress')
    assert.isNotEmpty(result.templateVersion)
    assert.isNotEmpty(result.title)
    assert.isObject(result.dateRange)
    assert.isObject(result.dataSources)
    assert.isArray(result.warnings)
    assert.isBoolean(result.blocking)
    assert.isArray(result.exportFormats)

    // no-write: preview 不创建版本或任务
    const versions = await ReportVersion.query().where('project_id', Number(project.id))
    assert.equal(versions.length, 0)
  })

  test('preview project-weekly 模板返回有效结果', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const result = await previewReport(Number(org.id), Number(project.id), Number(owner.id), {
      templateId: 'project-weekly',
      filters: { fromDate: '2026-07-01', toDate: '2026-07-07' },
    })

    assert.equal(result.templateId, 'project-weekly')
    assert.equal(result.dateRange.fromDate, '2026-07-01')
    assert.equal(result.dateRange.toDate, '2026-07-07')
    assert.includeMembers(result.exportFormats, ['markdown', 'pdf', 'xlsx'])
  })

  test('项目无数据时 preview 不抛异常', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const result = await previewReport(Number(org.id), Number(project.id), Number(owner.id), {
      templateId: 'health-summary',
    })

    assert.equal(result.templateId, 'health-summary')
    assert.isArray(result.warnings)
    // 无 dashboard_metrics → 可能 blocking
    assert.isBoolean(result.blocking)
  })
})

test.group('Report V2 — Blocking Warning', () => {
  test('全部数据源可用时不阻塞', ({ assert }) => {
    const blocking = checkBlockingWarnings(
      {
        task_summary: {
          sourceKey: 'task_summary',
          status: 'available',
          generatedAt: '',
          data: null,
          warnings: [],
          sourceHash: '',
        },
        schedule_summary: {
          sourceKey: 'schedule_summary',
          status: 'available',
          generatedAt: '',
          data: null,
          warnings: [],
          sourceHash: '',
        },
      },
      ['task_summary', 'schedule_summary'],
    )
    assert.isFalse(blocking)
  })

  test('必需数据源 unavailable 时阻塞', ({ assert }) => {
    const blocking = checkBlockingWarnings(
      {
        task_summary: {
          sourceKey: 'task_summary',
          status: 'unavailable',
          generatedAt: '',
          data: null,
          warnings: [],
          sourceHash: '',
        },
      },
      ['task_summary'],
    )
    assert.isTrue(blocking)
  })

  test('缺失数据源时阻塞', ({ assert }) => {
    const blocking = checkBlockingWarnings({}, ['required_ds'])
    assert.isTrue(blocking)
  })

  test('可选数据源不可用不阻塞', ({ assert }) => {
    const blocking = checkBlockingWarnings(
      {
        task_summary: {
          sourceKey: 'task_summary',
          status: 'available',
          generatedAt: '',
          data: null,
          warnings: [],
          sourceHash: '',
        },
        optional_ds: {
          sourceKey: 'optional_ds',
          status: 'unavailable',
          generatedAt: '',
          data: null,
          warnings: [],
          sourceHash: '',
        },
      },
      ['task_summary'],
    )
    assert.isFalse(blocking)
  })
})

test.group('Report V2 — Version & Job Creation', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rv2-vj') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('创建版本和任务成功', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const { version, job } = await createReportVersion(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
      null,
      {
        templateId: 'progress',
        title: '测试创建版本',
        previewSnapshotHash: 'preview_hash_123',
      },
    )

    assert.equal(version.templateId, 'progress')
    assert.equal(version.title, '测试创建版本')
    assert.equal(version.snapshotHash, 'preview_hash_123')
    assert.equal(version.generatedBy, Number(owner.id))

    assert.equal(job.status, 'queued')
    assert.equal(job.attempt, 1)
    assert.equal(job.versionId, version.id)
    assert.equal(job.requestedBy, Number(owner.id))
  })

  test('幂等 key 不同可多次创建', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const r1 = await createReportVersion(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
      null,
      {
        templateId: 'delay',
        previewSnapshotHash: 'hash_a',
        idempotencyKey: 'idem-a',
      },
    )

    assert.equal(r1.job.idempotencyKey, 'idem-a')
    // 不同幂等 key 允许
    const r2 = await createReportVersion(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
      null,
      {
        templateId: 'milestone',
        previewSnapshotHash: 'hash_b',
        idempotencyKey: 'idem-b',
      },
    )
    assert.notEqual(r2.job.idempotencyKey, r1.job.idempotencyKey)
  })

  test('版本不覆盖旧版本（每次创建新版本）', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const v1 = await createReportVersion(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
      null,
      { templateId: 'progress', previewSnapshotHash: 'hash_1' },
    )

    const v2 = await createReportVersion(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
      null,
      { templateId: 'progress', previewSnapshotHash: 'hash_2' },
    )

    assert.notEqual(v1.version.id, v2.version.id)
    assert.notEqual(v1.job.id, v2.job.id)
  })
})

test.group('Report V2 — Job Retry', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rv2-retry') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('重试创建新 attempt 且保留原任务链接', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const { job } = await createReportVersion(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
      null,
      { templateId: 'workload', previewSnapshotHash: 'hash_retry' },
    )

    job.status = 'failed'
    job.finishedAt = DateTime.now()
    job.errorCategory = 'RENDER_FAILED'
    await job.save()

    // 重试
    const newJob = await retryJob(job.id, Number(org.id))

    assert.equal(newJob.attempt, 2)
    assert.equal(newJob.versionId, job.versionId)
    assert.equal(newJob.templateId, job.templateId)
    assert.equal(newJob.status, 'queued')
    assert.notEqual(newJob.id, job.id)
  })
})
