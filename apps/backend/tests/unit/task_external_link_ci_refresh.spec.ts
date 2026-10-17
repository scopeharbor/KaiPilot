import { ProjectRoleName } from '#rbac'
import TaskExternalLinkService from '#services/task_external_link_service'
import Task from '#models/task'
import AuditLog from '#models/audit_log'
import { GitHubReadonlyFixtureClient } from '#services/integrations/github_readonly_client'
import { GitLabReadonlyFixtureClient } from '#services/integrations/gitlab_readonly_client'
import type { GitHubConnectionResolver } from '#services/integrations/github_connection_resolver'
import type { GitlabConnectionResolver } from '#services/integrations/gitlab_connection_resolver'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * v2-5-code-repository-ci-status-display 任务 4.2 / 4.4 / 4.8 / 5.5 ——
 * 刷新 CI 投影的 service 行为、持久化边界、审计脱敏与任务事实隔离。
 *
 * 全部 fixture/mock：注入伪连接解析器返回受控 token 前缀，fixture client 据此产出场景，
 * 不触任何真实 provider / webhook / 外部写回。
 */

/** 伪造连接解析器：token 存在→connected，否则 connection_required。 */
function makeService(opts: { githubToken?: string; gitlabToken?: string } = {}) {
  const ghResolver = {
    async resolve() {
      return opts.githubToken
        ? { type: 'connected', accessToken: opts.githubToken, connection: {} }
        : { type: 'connection_required', message: '当前用户尚未连接 GitHub' }
    },
  } as unknown as GitHubConnectionResolver
  const glResolver = {
    async resolve() {
      return opts.gitlabToken
        ? { type: 'connected', accessToken: opts.gitlabToken, connection: {} }
        : { type: 'connection_required', message: '当前用户尚未连接 GitLab' }
    },
  } as unknown as GitlabConnectionResolver
  return new TaskExternalLinkService(
    new GitHubReadonlyFixtureClient(),
    new GitLabReadonlyFixtureClient(),
    ghResolver,
    glResolver,
  )
}

async function baseSetup() {
  const owner = await createUser({ email: uniqueEmail('ci-refresh-owner') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return {
    owner,
    org,
    project,
    actor: { userId: Number(owner.id), organizationId: Number(org.id) },
  }
}

const GH_PR = {
  provider: 'github' as const,
  linkType: 'pull_request' as const,
  repositoryOwner: 'acme',
  repositoryName: 'web',
  externalNumber: 7,
  externalStatus: 'open' as const,
  externalUrl: 'https://github.com/acme/web/pull/7',
}

const GL_MR = {
  provider: 'gitlab' as const,
  linkType: 'merge_request' as const,
  repositoryOwner: 'acme',
  repositoryName: 'web',
  externalNumber: 3,
  externalStatus: 'open' as const,
  externalUrl: 'https://gitlab.com/acme/web/-/merge_requests/3',
}

// ---------------------------------------------------------------------------
// 4.2 service 场景
// ---------------------------------------------------------------------------

test.group('CI 刷新 service 场景（任务 4.2）', (group) => {
  useAuthDatabase(group)

  test('GitHub PR 成功刷新 → ciSummary=passed', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ githubToken: 'gho_ci_pass_x' })
    const link = await svc.create(project.id, 1, GH_PR, actor)
    const r = await svc.refresh(link.id, project.id, 1, actor)
    assert.equal(r.result, 'success')
    assert.equal(r.ciSummary?.state, 'passed')
    assert.equal(r.ciSummary?.source, 'github_checks')
    assert.equal(r.ciSummary?.reasonCode, 'ok')
  })

  test('GitHub PR CI 失败 → 状态刷新成功但 ciSummary=failed', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ githubToken: 'gho_ci_failed_x' })
    const link = await svc.create(project.id, 1, GH_PR, actor)
    const r = await svc.refresh(link.id, project.id, 1, actor)
    assert.equal(r.result, 'success')
    assert.equal(r.ciSummary?.state, 'failed')
  })

  test('GitHub PR CI 运行中 → ciSummary=running', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ githubToken: 'gho_ci_running_x' })
    const link = await svc.create(project.id, 1, GH_PR, actor)
    const r = await svc.refresh(link.id, project.id, 1, actor)
    assert.equal(r.ciSummary?.state, 'running')
  })

  test('provider 未连接 → connection_required，ciSummary 保持既有（null）', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({}) // 无 token
    const link = await svc.create(project.id, 1, GH_PR, actor)
    const r = await svc.refresh(link.id, project.id, 1, actor)
    assert.equal(r.result, 'connection_required')
    assert.isNull(r.ciSummary ?? null)
  })

  test('forbidden / not_found / rate_limited / temporarily_unavailable 均保留既有摘要', async ({
    assert,
  }) => {
    const { project, actor } = await baseSetup()
    const cases = [
      ['gho_forbidden_', 'forbidden', false],
      ['gho_notfound_', 'not_found', false],
      ['gho_ratelimited_', 'rate_limited', true],
      ['gho_timeout_', 'temporarily_unavailable', false],
    ] as const
    let num = 300
    for (const [prefix, expected, retry] of cases) {
      num += 1
      const svc = makeService({ githubToken: `${prefix}x` })
      const link = await svc.create(project.id, 1, { ...GH_PR, externalNumber: num }, actor)
      const r = await svc.refresh(link.id, project.id, 1, actor)
      assert.equal(r.result, expected)
      assert.isNull(r.ciSummary ?? null) // 刷新前无摘要 → 失败分支保持 null
      if (retry) assert.equal(r.retryAfter, 60)
    }
  })

  test('GitLab MR 成功刷新 → ciSummary=passed (gitlab_pipeline)', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ gitlabToken: 'glpat_ci_pass_x' })
    const link = await svc.create(project.id, 1, GL_MR, actor)
    const r = await svc.refresh(link.id, project.id, 1, actor)
    assert.equal(r.result, 'success')
    assert.equal(r.ciSummary?.state, 'passed')
    assert.equal(r.ciSummary?.source, 'gitlab_pipeline')
  })

  test('GitLab Issue 降级 → CI 仅对 MR 有意义，ciSummary 保持 null', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ gitlabToken: 'glpat_ci_pass_x' })
    const link = await svc.create(
      project.id,
      1,
      {
        provider: 'gitlab',
        linkType: 'issue',
        repositoryOwner: 'acme',
        repositoryName: 'web',
        externalNumber: 9,
        externalStatus: 'open',
        externalUrl: 'https://gitlab.com/acme/web/-/issues/9',
      },
      actor,
    )
    const r = await svc.refresh(link.id, project.id, 1, actor)
    assert.equal(r.result, 'success')
    assert.isNull(r.ciSummary ?? null)
  })
})

// ---------------------------------------------------------------------------
// 4.4 持久化：只有完整成功才更新摘要
// ---------------------------------------------------------------------------

test.group('CI 摘要持久化边界（任务 4.4）', (group) => {
  useAuthDatabase(group)

  test('成功刷新持久化 ciSummary；随后失败刷新保留旧摘要与外部快照', async ({ assert }) => {
    const { project, actor } = await baseSetup()

    // 1) 成功刷新 → 持久化 passed
    const svcOk = makeService({ githubToken: 'gho_ci_pass_x' })
    const link = await svcOk.create(project.id, 1, GH_PR, actor)
    await svcOk.refresh(link.id, project.id, 1, actor)

    const afterSuccess = await svcOk.getById(link.id, project.id, 1, actor)
    assert.equal(afterSuccess?.getCiSummary()?.state, 'passed')
    const statusAfterSuccess = afterSuccess!.externalStatus
    const observedAfterSuccess = afterSuccess!.lastObservedAt?.toMillis()

    // 2) 失败刷新（forbidden）→ 旧 ciSummary、externalStatus、lastObservedAt 全保留
    const svcFail = makeService({ githubToken: 'gho_forbidden_x' })
    const r = await svcFail.refresh(link.id, project.id, 1, actor)
    assert.equal(r.result, 'forbidden')

    const afterFail = await svcFail.getById(link.id, project.id, 1, actor)
    assert.equal(afterFail?.getCiSummary()?.state, 'passed') // 摘要未被抹掉
    assert.equal(afterFail?.externalStatus, statusAfterSuccess) // 快照保留
    assert.equal(afterFail?.lastObservedAt?.toMillis(), observedAfterSuccess) // 观测时间保留
  })

  test('从未成功过 → 失败刷新不产生摘要（保持 null）', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ githubToken: 'gho_notfound_x' })
    const link = await svc.create(project.id, 1, GH_PR, actor)
    await svc.refresh(link.id, project.id, 1, actor)
    const reloaded = await svc.getById(link.id, project.id, 1, actor)
    assert.isNull(reloaded?.getCiSummary() ?? null)
  })
})

// ---------------------------------------------------------------------------
// 4.8 审计脱敏
// ---------------------------------------------------------------------------

test.group('CI 审计脱敏（任务 4.8）', (group) => {
  useAuthDatabase(group)

  const FORBIDDEN_LEAKS = [
    'gho_',
    'glpat_',
    'Bearer',
    'check_runs',
    'artifacts',
    'output',
    'details_url',
    'full workflow logs',
    'SENSITIVE build log',
    'gho_should_not_leak',
    'gho_secret_token',
    'gho_secret_query_param',
    'CLIENT_SECRET',
    'client_secret',
  ]

  async function auditMetaFor(linkId: number): Promise<string> {
    const logs = await AuditLog.query()
      .where('entity_type', 'task_external_link')
      .where('entity_id', linkId)
    return JSON.stringify(
      logs.map((l) => ({ action: l.action, metadata: l.metadata, changes: l.changes })),
    )
  }

  test('成功分支审计只含低敏 CI 元数据，不含 token/payload/log', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ githubToken: 'gho_ci_pass_secrettoken' })
    const link = await svc.create(project.id, 1, GH_PR, actor)
    await svc.refresh(link.id, project.id, 1, actor)

    const serialized = await auditMetaFor(link.id)
    for (const leak of FORBIDDEN_LEAKS) {
      assert.notInclude(serialized, leak, `审计不应泄露: ${leak}`)
    }
    // 低敏 CI 元数据存在
    assert.include(serialized, 'ciNewState')
    assert.include(serialized, 'passed')
    assert.include(serialized, 'github_checks')
  })

  test('失败分支审计不含 token/payload', async ({ assert }) => {
    const { project, actor } = await baseSetup()
    const svc = makeService({ githubToken: 'gho_forbidden_secrettoken' })
    const link = await svc.create(project.id, 1, GH_PR, actor)
    await svc.refresh(link.id, project.id, 1, actor)
    const serialized = await auditMetaFor(link.id)
    for (const leak of FORBIDDEN_LEAKS) {
      assert.notInclude(serialized, leak, `审计不应泄露: ${leak}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 5.5 任务事实隔离
// ---------------------------------------------------------------------------

test.group('CI 刷新不写任务事实（任务 5.5）', (group) => {
  useAuthDatabase(group)

  test('passed/failed/running 刷新都不改任务状态/负责人/日期/进度', async ({ assert }) => {
    const { owner, project, actor } = await baseSetup()

    const created = await Task.create({
      projectId: project.id,
      name: 'CI 隔离任务',
      status: 'in_progress',
      taskType: 'task',
      priority: 'high',
      assigneeId: Number(owner.id),
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-31'),
      progressPercent: 40,
      isCriticalPath: true,
    })
    const taskId = Number(created.id)

    // 从库读取基线快照（与后续 reload 格式一致）
    const base = await Task.findOrFail(taskId)
    const baseFacts = {
      status: base.status,
      assigneeId: base.assigneeId,
      priority: base.priority,
      startISO: base.startDate?.toISODate() ?? null,
      endISO: base.endDate?.toISODate() ?? null,
      progressPercent: base.progressPercent,
      isCriticalPath: base.isCriticalPath,
    }

    let num = 200
    for (const token of ['gho_ci_pass_x', 'gho_ci_failed_x', 'gho_ci_running_x']) {
      num += 1
      const svc = makeService({ githubToken: token })
      const link = await svc.create(project.id, taskId, { ...GH_PR, externalNumber: num }, actor)
      await svc.refresh(link.id, project.id, taskId, actor)

      // 重新从库读取任务，断言任务事实一字未改
      const reloaded = await Task.findOrFail(taskId)
      assert.equal(reloaded.status, baseFacts.status)
      assert.equal(reloaded.assigneeId, baseFacts.assigneeId)
      assert.equal(reloaded.priority, baseFacts.priority)
      assert.equal(reloaded.startDate?.toISODate() ?? null, baseFacts.startISO)
      assert.equal(reloaded.endDate?.toISODate() ?? null, baseFacts.endISO)
      assert.equal(reloaded.progressPercent, baseFacts.progressPercent)
      assert.equal(reloaded.isCriticalPath, baseFacts.isCriticalPath)
    }
  })
})
