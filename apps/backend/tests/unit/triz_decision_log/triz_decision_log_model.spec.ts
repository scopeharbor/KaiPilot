/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志模型测试（tasks 2.3–2.4）。
 *
 * 测试 JSON 列、索引、追加式保护、修订链、跨组织隔离。
 */
import TrizDecisionLog from '#models/triz_decision_log'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../../functional/auth/_helpers.js'
import type { TrizDecisionSubjectRef, TrizDecisionSourceRef } from '@aiproj/types'

test.group('TrizDecisionLog Model', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('tdl-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  function makeSubjectRef(overrides: Partial<TrizDecisionSubjectRef> = {}): TrizDecisionSubjectRef {
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

  function makeSourceRef(overrides: Partial<TrizDecisionSourceRef> = {}): TrizDecisionSourceRef {
    return {
      kind: 'rule_analysis',
      id: 'rule-1',
      hash: 'abc123',
      summary: '基于 TRIZ 规则 35 分析',
      ...overrides,
    }
  }

  // ── Test 1: JSON round-trip ─────────────────────────────────────────

  test('subject_refs / source_refs / artifact_hashes JSON 列正确序列化/反序列化', async ({
    assert,
  }) => {
    const { org, project, owner } = await setup()

    const subjectRefs = [makeSubjectRef()]
    const sourceRefs = [makeSourceRef()]
    const artifactHashes = [{ label: 'input', hash: 'def456', algorithm: 'sha256' }]

    // 用 raw query 直接插入避免 ORM 预处理干扰
    const log = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'adopt',
      decisionStatus: 'active',
      subjectRefs,
      sourceRefs,
      artifactHashes,
      reasonSummary: '确认矛盾为有效项目矛盾',
      reasonHash: 'aabbccdd',
      createdBy: owner.id,
    })

    assert.isAbove(log.id, 0)

    // 重新查询校验 JSON 还原
    const found = await TrizDecisionLog.findOrFail(log.id)
    assert.isArray(found.subjectRefs)
    assert.lengthOf(found.subjectRefs, 1)
    assert.equal(found.subjectRefs[0]!.kind, 'contradiction')
    assert.equal(found.subjectRefs[0]!.id, 'test-contradiction-1')

    assert.isArray(found.sourceRefs)
    assert.lengthOf(found.sourceRefs, 1)
    assert.equal(found.sourceRefs[0]!.kind, 'rule_analysis')

    assert.isArray(found.artifactHashes)
    assert.lengthOf(found.artifactHashes, 1)
    assert.equal(found.artifactHashes[0]!.hash, 'def456')
  })

  // ── Test 2: Indexes ─────────────────────────────────────────────────

  test('按 org + project + status 能查到记录', async ({ assert }) => {
    const { org, project, owner } = await setup()

    await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'reject',
      decisionStatus: 'active',
      subjectRefs: [makeSubjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '驳回矛盾',
      reasonHash: '1234abcd',
      createdBy: owner.id,
    })

    const count = await TrizDecisionLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('decision_status', 'active')
      .count('* as total')

    const total = Number(count[0]?.$extras?.total ?? 0)
    assert.isAbove(total, 0)
  })

  // ── Test 3: Append-only ──────────────────────────────────────────────

  test('禁止通过 save() 更新核心字段（追加式保护）', async ({ assert }) => {
    const { org, project, owner } = await setup()

    const log = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'adopt',
      decisionStatus: 'active',
      subjectRefs: [makeSubjectRef()],
      sourceRefs: [makeSourceRef()],
      artifactHashes: [],
      reasonSummary: '原始理由',
      reasonHash: 'hash1',
      createdBy: owner.id,
    })

    // 尝试更新 decisionType（禁止）
    log.decisionType = 'reject'
    await assert.rejects(async () => {
      await log.save()
    }, /TRIZ decision logs are append-only/)
  })

  // ── Test 4: 禁止删除 ──────────────────────────────────────────────────

  test('禁止通过 delete() 删除决策日志', async ({ assert }) => {
    const { org, project, owner } = await setup()

    const log = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'adopt',
      decisionStatus: 'active',
      subjectRefs: [makeSubjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '不可删除',
      reasonHash: 'hash2',
      createdBy: owner.id,
    })

    await assert.rejects(async () => {
      await log.delete()
    }, /TRIZ decision logs cannot be deleted/)
  })

  // ── Test 5: Superseding ──────────────────────────────────────────────

  test('修订链：old → superseded, new 指向 old', async ({ assert }) => {
    const { org, project, owner } = await setup()

    const oldLog = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'adopt',
      decisionStatus: 'active',
      subjectRefs: [makeSubjectRef()],
      sourceRefs: [makeSourceRef()],
      artifactHashes: [],
      reasonSummary: '旧决策',
      reasonHash: 'oldhash',
      createdBy: owner.id,
    })

    // 标记旧记录为 superseded
    oldLog.decisionStatus = 'superseded'
    await oldLog.save()

    const newLog = await TrizDecisionLog.create({
      organizationId: org.id,
      projectId: project.id,
      decisionType: 'modified_accept',
      decisionStatus: 'active',
      subjectRefs: [makeSubjectRef()],
      sourceRefs: [makeSourceRef()],
      artifactHashes: [],
      reasonSummary: '新决策',
      reasonHash: 'newhash',
      supersedesDecisionLogId: oldLog.id,
      createdBy: owner.id,
    })

    // 校验状态
    const refreshedOld = await TrizDecisionLog.findOrFail(oldLog.id)
    assert.equal(refreshedOld.decisionStatus, 'superseded')

    const refreshedNew = await TrizDecisionLog.findOrFail(newLog.id)
    assert.equal(refreshedNew.decisionStatus, 'active')
    assert.equal(refreshedNew.supersedesDecisionLogId, oldLog.id)
  })

  // ── Test 6: Cross-org isolation ──────────────────────────────────────

  test('跨组织隔离：不同组织的决策日志不可见', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-cross') })
    const org1 = await createOrganization(owner)
    const { project: proj1 } = await createProjectWithMember(
      org1,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const owner2 = await createUser({ email: uniqueEmail('tdl-cross-2') })
    const org2 = await createOrganization(owner2)

    await TrizDecisionLog.create({
      organizationId: org1.id,
      projectId: proj1.id,
      decisionType: 'adopt',
      decisionStatus: 'active',
      subjectRefs: [makeSubjectRef()],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: 'org1 的决策',
      reasonHash: 'org1hash',
      createdBy: owner.id,
    })

    // org2 不应看到 org1 的决策
    const count = await TrizDecisionLog.query()
      .where('organization_id', org2.id)
      .count('* as total')

    const total = Number(count[0]?.$extras?.total ?? 0)
    assert.equal(total, 0)
  })
})
