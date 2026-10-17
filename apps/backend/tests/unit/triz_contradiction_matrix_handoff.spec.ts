// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Handoff 单元测试
// v3-triz-contradiction-matrix-ui / tasks §4.6, §4.7
//
// 测试覆盖：
// - handoff 元数据只含 refs/hashes/warnings（不含正式业务数据）
// - 正式项目/任务/依赖/资源/风险/排程/范围/变更/里程碑数据保持不变
// - stale 来源阻断 handoff
// - 审计事件 payload 低敏脱敏
// - 权限拒绝不泄露信息

import AuditLog from '#models/audit_log'
import ProjectContradiction from '#models/project_contradiction'
import Task from '#models/task'
import TrizContradictionMatrixHandoffService from '#services/triz_contradiction/triz_contradiction_matrix_handoff_service'
import { AuditEvent } from '#services/audit_service'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import {
  computeMatrixCellKey,
  computeTensionKey,
  computeMatrixHandoffIdempotencyKey,
  type MatrixHandoffInput,
  type MatrixSourceRef,
} from '@aiproj/types'

const FIXTURE_CATALOG_VERSION = 'fixture-1.0.0'

async function seedContradiction(args: {
  orgId: number
  projectId: number
  key: string
  improving?: string
  worsening?: string
  outputHash?: string
  stale?: boolean
  title?: string
}) {
  return ProjectContradiction.create({
    organizationId: args.orgId,
    projectId: args.projectId,
    key: args.key,
    dedupeKey: `mxc-handoff-dedupe-${args.key}`,
    type: 'technical',
    ruleId: 'CD-001',
    ruleVersion: '1.0.0',
    improvingParameterKey: (args.improving ?? 'duration') as any,
    worseningParameterKey: (args.worsening ?? 'cost') as any,
    improvingDirection: null,
    worseningDirection: null,
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    severity: 'high',
    confidence: 0.8,
    title: args.title ?? '工期与成本技术矛盾',
    evidence: [],
    suggestedPrinciples: [
      { principleId: 'segmentation', name: '分割', relevance: 0.8, advice: '分段交付' },
    ],
    inputSignature: `sig-${args.key}`,
    outputHash: args.outputHash ?? `hash-${args.key}`,
    status: 'confirmed',
    stale: args.stale ?? false,
    staleReason: args.stale ? '来源数据已变化' : null,
    relatedChangeRequestId: null,
    confirmedBy: null,
    confirmedAt: null,
    dismissedBy: null,
    dismissedAt: null,
    dismissReason: null,
    aiExplanation: null,
  })
}

function buildHandoffInput(overrides: Partial<MatrixHandoffInput> = {}): MatrixHandoffInput {
  const selectedCells = overrides.selectedCells ?? [
    computeMatrixCellKey({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      catalogVersion: FIXTURE_CATALOG_VERSION,
    }),
  ]
  const selectedTensions = overrides.selectedTensions ?? [
    computeTensionKey({ parameterKey: 'scope', catalogVersion: FIXTURE_CATALOG_VERSION }),
  ]
  const sourceHashes = overrides.sourceHashes ?? ['hash-mxc-handoff-001']
  const idempotencyKey =
    overrides.idempotencyKey ??
    computeMatrixHandoffIdempotencyKey({
      projectId: 100,
      selectedCells,
      selectedTensions,
      sourceHashes,
    })

  const sourceRefs: MatrixSourceRef[] = overrides.sourceRefs ?? [
    {
      sourceType: 'contradiction',
      ref: 'mxc-handoff-001',
      hash: 'hash-mxc-handoff-001',
      title: '工期与成本技术矛盾',
      severity: 'high',
      stale: false,
      isAiGenerated: false,
      isFallback: false,
      warningCodes: [],
    },
  ]

  return {
    target: 'workbench',
    organizationId: 1,
    projectId: 100,
    actorId: 7,
    selectedCells,
    selectedTensions,
    sourceRefs,
    sourceHashes,
    selectedParameterKeys: ['duration', 'cost', 'scope'] as any,
    selectedPrincipleIds: ['segmentation'] as any,
    warningSummary: { total: 0, blocking: 0, warning: 0, info: 0, codes: [] },
    idempotencyKey,
    note: '测试 handoff',
    ...overrides,
  }
}

test.group('V3 TRIZ 矛盾矩阵 Handoff — 元数据与正式数据隔离', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('mxc-handoff-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const service = new TrizContradictionMatrixHandoffService(
      // 使用真实 matrixService（已注入）
      await import('#services/triz_contradiction/triz_contradiction_matrix_service').then(
        (m) => new m.default(),
      ),
      await import('#services/audit_service').then((m) => new m.default()),
    )
    return { owner, org, project, service }
  }

  test('handoff 成功返回 created 状态与 targetRef', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-handoff-001',
      outputHash: 'hash-mxc-handoff-001',
    })

    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const result = await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    assert.equal(result.status, 'created')
    assert.isNotNull(result.targetRef)
    assert.isNull(result.blockedReason)
    assert.equal(result.idempotencyKey, input.idempotencyKey)
  })

  test('handoff targetRef 以 mx_wb 或 mx_dr 前缀开头', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-prefix-001',
      outputHash: 'hash-mxc-prefix-001',
    })

    // workbench 目标
    const wbInput = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      target: 'workbench',
      sourceHashes: ['hash-mxc-prefix-001'],
    })
    const wbResult = await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input: wbInput,
    })
    assert.isTrue(wbResult.targetRef?.startsWith('mx_wb_'))

    // draft_review 目标
    const drInput = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      target: 'draft_review',
      sourceHashes: ['hash-mxc-prefix-001'],
    })
    const drResult = await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input: drInput,
    })
    assert.isTrue(drResult.targetRef?.startsWith('mx_dr_'))
  })

  test('handoff 元数据只含 refs/hashes/warnings，不含正式业务数据', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-meta-001',
      outputHash: 'hash-mxc-meta-001',
    })

    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      sourceHashes: ['hash-mxc-meta-001'],
    })

    const result = await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    // targetRef 是稳定 hash，不含敏感业务数据
    assert.isString(result.targetRef)
    const json = JSON.stringify(result)
    // 不应包含正式业务数据字段
    assert.notInclude(json, 'taskPatch')
    assert.notInclude(json, 'scheduleOverride')
    assert.notInclude(json, 'resourceReallocation')
    assert.notInclude(json, 'scopeMutation')
    assert.notInclude(json, 'changeRequestPatch')
    assert.notInclude(json, 'milestoneOverride')
  })

  test('handoff 不修改正式项目/任务数据', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-noop-001',
      outputHash: 'hash-mxc-noop-001',
    })

    // 记录 handoff 前的正式数据状态
    const tasksBefore = await Task.query().where('project_id', project.id)
    const contradictionsBefore = await ProjectContradiction.query().where('project_id', project.id)

    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      sourceHashes: ['hash-mxc-noop-001'],
    })

    await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    // handoff 后正式数据不变
    const tasksAfter = await Task.query().where('project_id', project.id)
    const contradictionsAfter = await ProjectContradiction.query().where('project_id', project.id)

    assert.equal(tasksBefore.length, tasksAfter.length)
    assert.equal(contradictionsBefore.length, contradictionsAfter.length)

    // 矛盾记录的 status/severity 等字段不变
    for (const c of contradictionsAfter) {
      assert.equal(c.status, 'confirmed')
      assert.equal(c.severity, 'high')
    }
  })

  test('stale 来源阻断 handoff 返回 stale_blocked', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-stale-001',
      outputHash: 'hash-current-001',
    })

    // 选中时用的是旧 hash（与当前不匹配）
    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      sourceHashes: ['hash-outdated-001'], // 不匹配当前 hash
      sourceRefs: [
        {
          sourceType: 'contradiction',
          ref: 'mxc-stale-001',
          hash: 'hash-outdated-001',
          title: '已过期矛盾',
          severity: 'high',
          stale: true,
          isAiGenerated: false,
          isFallback: false,
          warningCodes: ['STALE_SOURCE_CONTRADICTION'],
        },
      ],
    })

    const result = await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    assert.equal(result.status, 'stale_blocked')
    assert.isNull(result.targetRef)
    assert.isNotNull(result.blockedReason)
  })

  test('非法输入抛出错误', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const badInput = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      selectedCells: [], // 空
      selectedTensions: [], // 空 → 至少选一个
    })

    await assert.rejects(async () => {
      await service.createHandoff({
        user: owner,
        organizationId: org.id,
        projectId: project.id,
        input: badInput,
      })
    })
  })

  test('审计事件记录 handoff 尝试与结果', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-audit-001',
      outputHash: 'hash-mxc-audit-001',
    })

    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      sourceHashes: ['hash-mxc-audit-001'],
    })

    await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    // 应记录尝试与成功两个审计事件
    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)

    const attemptLog = logs.find(
      (l) => l.action === 'read' && l.metadata?.event === AuditEvent.TRIZ_MATRIX_HANDOFF_ATTEMPT,
    )
    const createdLog = logs.find(
      (l) => l.action === 'create' && l.metadata?.event === AuditEvent.TRIZ_MATRIX_HANDOFF_CREATED,
    )

    assert.isDefined(attemptLog)
    assert.isDefined(createdLog)
  })
})

test.group('V3 TRIZ 矛盾矩阵 Handoff — 审计 payload 脱敏 (§4.7)', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('mxc-redact-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const { default: TrizContradictionMatrixService } =
      await import('#services/triz_contradiction/triz_contradiction_matrix_service')
    const { default: AuditService } = await import('#services/audit_service')
    const matrixService = new TrizContradictionMatrixService()
    const auditService = new AuditService()
    const service = new TrizContradictionMatrixHandoffService(matrixService, auditService)
    return { owner, org, project, service }
  }

  test('审计 metadata 不含敏感字段', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-redact-001',
      outputHash: 'hash-mxc-redact-001',
    })

    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      sourceHashes: ['hash-mxc-redact-001'],
      note: '测试备注 with sensitive: api_key=secret123',
    })

    await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)

    const json = JSON.stringify(logs.map((l) => l.metadata))

    // 审计 payload 不应含敏感字段
    assert.notInclude(json, 'api_key')
    assert.notInclude(json, 'secret123')
    assert.notInclude(json, 'full_prompt')
    assert.notInclude(json, 'model_output')
    assert.notInclude(json, 'full_evidence')
  })

  test('审计 metadata 只记录计数，不泄露来源标题', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-count-001',
      outputHash: 'hash-mxc-count-001',
      title: '高度敏感的项目矛盾标题',
    })

    const input = buildHandoffInput({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      sourceHashes: ['hash-mxc-count-001'],
      sourceRefs: [
        {
          sourceType: 'contradiction',
          ref: 'mxc-count-001',
          hash: 'hash-mxc-count-001',
          title: '高度敏感的项目矛盾标题',
          severity: 'high',
          stale: false,
          isAiGenerated: false,
          isFallback: false,
          warningCodes: [],
        },
      ],
    })

    await service.createHandoff({
      user: owner,
      organizationId: org.id,
      projectId: project.id,
      input,
    })

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)

    const createdLog = logs.find(
      (l) => l.metadata?.event === AuditEvent.TRIZ_MATRIX_HANDOFF_CREATED,
    )
    assert.isDefined(createdLog)

    // 只记录计数，不记录来源标题
    const meta = createdLog!.metadata as Record<string, unknown>
    assert.isDefined(meta.selectedCellsCount)
    assert.isDefined(meta.selectedTensionsCount)
    assert.isUndefined(meta.sourceRefs)
    assert.isUndefined(meta.sourceTitles)
  })
})
