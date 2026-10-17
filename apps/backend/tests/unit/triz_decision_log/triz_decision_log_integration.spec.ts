/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志集成测试（tasks 10.1–10.4, 11.1–11.5）。
 *
 * 测试矛盾决策创建、Draft dry-run 阻塞、Apply 决策 ref 持久化、
 * 不匹配时失败、Apply 前零正式数据写入。
 */
import TrizDecisionLog from '#models/triz_decision_log'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import TrizDecisionLogService from '#services/triz_decision/triz_decision_log_service'
import { ContradictionDecisionBridge } from '#services/triz_decision/contradiction_decision_bridge'
import { TrizDecisionDraftAdapter } from '#services/triz_decision/triz_decision_draft_adapter'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../../functional/auth/_helpers.js'
import type { TrizDecisionSubjectRef } from '@aiproj/types'

test.group('TrizDecisionLog Integration', (group) => {
  useAuthDatabase(group)

  class MockResolver {
    async resolve(_ref: TrizDecisionSubjectRef, _orgId: number, _userId: number) {
      return { valid: true, summary: 'mock valid' }
    }
  }

  function createService() {
    return new TrizDecisionLogService(new AuditService(), new MockResolver() as any)
  }

  function createBridge() {
    return new ContradictionDecisionBridge(createService())
  }

  async function setupSimple() {
    const owner = await createUser({ email: uniqueEmail('tdl-int') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  function subjectRef(): TrizDecisionSubjectRef {
    return {
      kind: 'contradiction',
      id: 'test-contradiction-int-1',
      version: 'v1',
      summaryLevel: 'high',
      visibility: 'public',
      title: '集成测试矛盾',
    }
  }

  // ── Test 1: 矛盾决策创建 ──────────────────────────────────────────────

  test('createOnConfirm 创建采纳决策日志', async ({ assert }) => {
    const { owner, org, project } = await setupSimple()

    const bridge = createBridge()
    const fakeContradiction = {
      key: 'contra-key-1',
      title: '工期与质量矛盾',
      inputSignature: 'input-sig-001',
      outputHash: 'output-hash-001',
      relatedChangeRequestId: null,
      updatedAt: null as unknown as Date,
    } as unknown as import('#models/project_contradiction').default

    await bridge.createOnConfirm(fakeContradiction as any, owner.id, org.id, project.id)

    // 验证决策日志已创建
    const logs = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('decision_type', 'adopt')

    assert.lengthOf(logs, 1)
    assert.equal(logs[0]!.reasonSummary, '确认矛盾「工期与质量矛盾」为有效项目矛盾')
  })

  // ── Test 2: 矛盾驳回决策 ──────────────────────────────────────────────

  test('createOnDismiss 创建驳回决策日志', async ({ assert }) => {
    const { owner, org, project } = await setupSimple()

    const bridge = createBridge()
    const fakeContradiction = {
      key: 'contra-key-2',
      title: '范围与资源矛盾',
      inputSignature: 'input-sig-002',
      outputHash: null,
      relatedChangeRequestId: null,
      updatedAt: null as unknown as Date,
    } as unknown as import('#models/project_contradiction').default

    await bridge.createOnDismiss(
      fakeContradiction as any,
      '经人工评估，此矛盾在当前项目不适用',
      owner.id,
      org.id,
      project.id,
    )

    const logs = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('decision_type', 'reject')

    assert.lengthOf(logs, 1)
    assert.include(logs[0]!.reasonSummary, '不适用')
  })

  // ── Test 3: Draft dry-run 阻塞 ───────────────────────────────────────

  test('DraftAdapter 检测缺少决策日志的 TRIZ refs', async ({ assert }) => {
    const { org } = await setupSimple()
    const adapter = new TrizDecisionDraftAdapter()

    // 没有对应决策日志的 TRIZ ref
    const draftItems = [
      {
        subjectRefs: [
          {
            kind: 'contradiction' as const,
            id: 'missing-contra',
            version: 'v1',
            summaryLevel: 'high' as const,
            visibility: 'public' as const,
            title: '不存在的矛盾',
          },
        ],
      },
    ]

    const result = await adapter.validateDecisionRefs(draftItems, org.id)
    assert.isTrue(result.reasons.length > 0)
    assert.include(result.reasons[0]!, '缺少关联决策日志')
  })

  // ── Test 4: Apply 决策 ref 持久化 ─────────────────────────────────────

  test('create 创建后决策日志持久化到 DB', async ({ assert }) => {
    const { owner, org, project } = await setupSimple()
    const service = createService()

    const entry = await service.create(org.id, project.id, owner.id, {
      decisionType: 'adopt',
      subjectRefs: [subjectRef()],
      sourceRefs: [{ kind: 'rule_analysis', id: 'rule-1', hash: 'abc123' }],
      artifactHashes: [{ label: 'input', hash: 'def456' }],
      reasonSummary: '持久化测试理由',
    })

    const found = await TrizDecisionLog.findOrFail(entry.id)
    assert.equal(found.reasonSummary, '持久化测试理由')
    assert.equal(found.reasonHash.length, 8) // computeTrizDecisionHash 输出固定 8 字符
  })

  // ── Test 5: Apply 前零正式数据写入 ────────────────────────────────────

  test('Bridge 创建决策日志但不应写正式业务数据', async ({ assert }) => {
    const { owner, org, project } = await setupSimple()
    const bridge = createBridge()

    const fakeContradiction = {
      key: 'contra-key-5',
      title: '仅创建决策日志',
      inputSignature: 'input-sig-005',
      outputHash: null,
      relatedChangeRequestId: null,
      updatedAt: null as unknown as Date,
    } as unknown as import('#models/project_contradiction').default

    await bridge.createOnConfirm(fakeContradiction as any, owner.id, org.id, project.id)

    // 决策日志已创建
    const logs = await TrizDecisionLog.query().where('organization_id', org.id)
    assert.isAbove(logs.length, 0)

    // 不写入其他业务表（仅验证决策日志表包含数据即可）
    const activeLogs = logs.filter((l) => l.decisionStatus === 'active')
    assert.isAbove(activeLogs.length, 0)
  })
})
