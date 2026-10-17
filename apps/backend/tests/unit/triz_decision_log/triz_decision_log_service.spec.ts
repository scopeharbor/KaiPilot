/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志 Service 测试（tasks 2.5–2.8, 3.1–3.6）。
 *
 * 测试 create、reject、partial accept、supersede、invalid refs、
 * unauthorized targets、redaction、isolation。
 */
import AuditLog from '#models/audit_log'
import TrizDecisionLog from '#models/triz_decision_log'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import TrizDecisionLogService from '#services/triz_decision/triz_decision_log_service'
import { ValidationException, ResourceNotFoundException } from '#exceptions/api_exception'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../../functional/auth/_helpers.js'
import type { TrizDecisionSubjectRef, TrizDecisionSourceRef } from '@aiproj/types'

// Mock resolver: rejects refs with 'non-existent' in the id
class MockResolver {
  async resolve(ref: TrizDecisionSubjectRef, _orgId: number, _userId: number) {
    if (ref.id === 'non-existent-key') {
      return { valid: false, summary: `ref ${ref.id} not found` }
    }
    return { valid: true, summary: 'mock valid' }
  }
}

test.group('TrizDecisionLogService', (group) => {
  useAuthDatabase(group)

  function createService() {
    return new TrizDecisionLogService(new AuditService(), new MockResolver() as any)
  }

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('tdl-svc') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project, service: createService() }
  }

  function subjectRef(overrides: Partial<TrizDecisionSubjectRef> = {}): TrizDecisionSubjectRef {
    return {
      kind: 'contradiction',
      id: 'test-contradiction-1',
      version: 'v1',
      summaryLevel: 'high',
      visibility: 'public',
      title: '测试矛盾',
      ...overrides,
    }
  }

  function sourceRef(overrides: Partial<TrizDecisionSourceRef> = {}): TrizDecisionSourceRef {
    return {
      kind: 'rule_analysis',
      id: 'rule-1',
      hash: 'abc123',
      summary: '基于 TRIZ 规则分析',
      ...overrides,
    }
  }

  // ── Test 1: create adopt ────────────────────────────────────────────

  test('create 采纳决策：写入数据并审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const entry = await service.create(org.id, project.id, owner.id, {
      decisionType: 'adopt',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      artifactHashes: [],
      reasonSummary: '确认矛盾为有效项目矛盾',
    })

    assert.equal(entry.decisionType, 'adopt')
    assert.equal(entry.decisionStatus, 'active')
    assert.equal(entry.projectId, project.id)
    assert.equal(entry.reasonSummary, '确认矛盾为有效项目矛盾')
    assert.isAbove(entry.id, 0)

    // 审计日志
    const logs = await AuditLog.query()
      .where('entity_type', 'triz_decision_log')
      .where('action', 'create')
    assert.isAbove(logs.length, 0)
  })

  // ── Test 2: create reject ────────────────────────────────────────────

  test('create 驳回决策：无需 sourceRefs', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const entry = await service.create(org.id, project.id, owner.id, {
      decisionType: 'reject',
      subjectRefs: [subjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '该矛盾为误报',
    })

    assert.equal(entry.decisionType, 'reject')
    assert.equal(entry.decisionStatus, 'active')
  })

  // ── Test 3: partial_accept ───────────────────────────────────────────

  test('create 部分采纳决策：需要 sourceRefs', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(
      () =>
        service.create(org.id, project.id, owner.id, {
          decisionType: 'partial_accept',
          subjectRefs: [subjectRef()],
          sourceRefs: [], // 缺少 sourceRefs
          artifactHashes: [],
          reasonSummary: '部分采纳',
        }),
      ValidationException,
    )
  })

  // ── Test 4: supersede ───────────────────────────────────────────────

  test('supersede 创建新决策并标记旧决策为 superseded', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const old = await service.create(org.id, project.id, owner.id, {
      decisionType: 'adopt',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      artifactHashes: [],
      reasonSummary: '旧决策理由',
    })

    const updated = await service.supersede(org.id, project.id, owner.id, old.id, {
      decisionType: 'modified_accept',
      subjectRefs: [subjectRef({ id: 'test-contradiction-1' })],
      sourceRefs: [sourceRef()],
      artifactHashes: [],
      reasonSummary: '新决策理由',
    })

    // 新记录的 supersedesDecisionLogId 指向旧记录
    assert.equal(updated.supersedesDecisionLogId, old.id)
    assert.equal(updated.decisionType, 'modified_accept')
    assert.equal(updated.decisionStatus, 'active')

    // 旧记录变为 superseded
    const refreshedOld = await TrizDecisionLog.findOrFail(old.id)
    assert.equal(refreshedOld.decisionStatus, 'superseded')
  })

  // ── Test 5: 不可废止已废止的决策 ─────────────────────────────────────

  test('禁止重复废止已 superseded 的决策', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const old = await service.create(org.id, project.id, owner.id, {
      decisionType: 'adopt',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      artifactHashes: [],
      reasonSummary: '待废止',
    })

    await service.supersede(org.id, project.id, owner.id, old.id, {
      decisionType: 'modified_accept',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      artifactHashes: [],
      reasonSummary: '新理由',
    })

    // 再次尝试废止同一记录
    await assert.rejects(
      () =>
        service.supersede(org.id, project.id, owner.id, old.id, {
          decisionType: 'reject',
          subjectRefs: [subjectRef()],
          sourceRefs: [],
          artifactHashes: [],
          reasonSummary: '再次废止',
        }),
      ValidationException,
    )
  })

  // ── Test 6: Invalid refs ─────────────────────────────────────────────

  test('不存在的 subject ref 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(
      () =>
        service.create(org.id, project.id, owner.id, {
          decisionType: 'adopt',
          subjectRefs: [subjectRef({ id: 'non-existent-key' })],
          sourceRefs: [sourceRef()],
          artifactHashes: [],
          reasonSummary: '不存在的矛盾',
        }),
      ValidationException,
    )
  })

  // ── Test 7: Empty subjectRefs ────────────────────────────────────────

  test('空 subjectRefs 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await assert.rejects(
      () =>
        service.create(org.id, project.id, owner.id, {
          decisionType: 'adopt',
          subjectRefs: [],
          sourceRefs: [],
          artifactHashes: [],
          reasonSummary: '无主题',
        }),
      ValidationException,
    )
  })

  // ── Test 8: Redaction ────────────────────────────────────────────────

  test('决策日志理由被脱敏处理（含敏感 token）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const entry = await service.create(org.id, project.id, owner.id, {
      decisionType: 'reject',
      subjectRefs: [subjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '驳回理由: token=sk-abc12345defghijklmnopqrstuvwxyz67890extralong',
    })

    assert.notInclude(entry.reasonSummary, 'sk-abc12345defgh')
    assert.include(entry.reasonSummary, '[REDACTED_TOKEN]')
  })

  // ── Test 9: Cross-org isolation ──────────────────────────────────────

  test('跨组织 404 — 查不到另一组织的决策', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-cross-svc') })
    const org1 = await createOrganization(owner)
    const { project: proj1 } = await createProjectWithMember(
      org1,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const owner2 = await createUser({ email: uniqueEmail('tdl-cross-svc-2') })
    const org2 = await createOrganization(owner2)
    const { project: proj2 } = await createProjectWithMember(
      org2,
      owner2,
      owner2,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const service = createService()

    // 在 org1 中创建
    const entry = await service.create(org1.id, proj1.id, owner.id, {
      decisionType: 'adopt',
      subjectRefs: [subjectRef()],
      sourceRefs: [sourceRef()],
      artifactHashes: [],
      reasonSummary: 'org1 决策',
    })

    // 从 org2 查 org1 的决策 → 404
    await assert.rejects(
      () => service.detail(org2.id, proj2.id, entry.id),
      ResourceNotFoundException,
    )
  })

  // ── Test 10: Internal visibility redaction ────────────────────────────

  test('internal visibility 的 subject ref 返回脱敏标题', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const entry = await service.create(org.id, project.id, owner.id, {
      decisionType: 'reject',
      subjectRefs: [subjectRef({ visibility: 'internal', title: '内部矛盾详情' })],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '内部决策',
    })

    const detail = await service.detail(org.id, project.id, entry.id)
    const internalRef = detail.subjectRefs.find((r) => r.visibility === 'internal')
    assert.isDefined(internalRef)
    assert.equal(internalRef!.title, '[内部引用]')
  })
})
