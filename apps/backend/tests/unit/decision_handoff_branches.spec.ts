/**
 * v3-pmo-decision-intelligence-workbench —— DecisionHandoffService 分支补测
 * （task 11.4：handoff_service 行覆盖 ≥90%）。
 */
import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import type AuditService from '#services/audit_service'
import PmoDecisionCase from '#models/pmo_decision_case'
import PmoDecisionOutcome from '#models/pmo_decision_outcome'

const auditStub = { log: async () => undefined } as never as AuditService

async function makeService() {
  const { default: Service } = await import('#services/decision_workbench/decision_handoff_service')
  const { default: app } = await import('@adonisjs/core/services/app')
  const policy = await app.container.make(DecisionWorkbenchPolicy)
  return new Service(policy, auditStub)
}

async function seedCaseWithOutcome(input: {
  organizationId: number
  ownerId: number
  status: string
  action: 'approve' | 'defer' | null
  selectedOptionId?: number | null
}): Promise<number> {
  const row = await PmoDecisionCase.create({
    organizationId: input.organizationId,
    title: 'handoff 分支议题',
    decisionQuestion: '分支测试？',
    scopeSummary: '',
    ownerId: input.ownerId,
    dueDate: null,
    status: input.status as never,
    revision: 1,
    supersedesCaseId: null,
    supersededByCaseId: null,
    createdBy: input.ownerId,
    updatedBy: input.ownerId,
  } as never)
  if (input.action) {
    await PmoDecisionOutcome.create({
      organizationId: input.organizationId,
      caseId: Number(row.id),
      action: input.action,
      selectedOptionId: input.selectedOptionId ?? null,
      supersededByCaseId: null,
      snapshotHash: 'hash0000',
      reviewFingerprint: 'fp000000',
      outcomeDigest: `d${row.id}`.slice(0, 8),
      rationale: null,
      acknowledgedWarnings: [],
      actorId: input.ownerId,
    } as never)
  }
  return Number(row.id)
}

async function catchCreate(
  service: unknown,
  user: unknown,
  organizationId: number,
  input: Record<string, unknown>,
): Promise<Error> {
  try {
    await (service as { create: (...args: unknown[]) => Promise<unknown> }).create(
      user,
      organizationId,
      input,
    )
    return new Error('NO_THROW')
  } catch (error) {
    return error as Error
  }
}

test.group('DecisionHandoffService 分支补测（task 11.4）', (group) => {
  useAuthDatabase(group)

  test('decided 但缺任何结论 → 缺少 approve 结论', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('hfb-noout') })
    const org = await createOrganization(owner)
    const service = await makeService()
    const caseId = await seedCaseWithOutcome({
      organizationId: Number(org.id),
      ownerId: Number(owner.id),
      status: 'decided',
      action: null,
    })
    const error = await catchCreate(service, owner, Number(org.id), {
      caseId,
      target: 'navigation',
      idempotencyKey: 'k1',
    })
    assert.include(error.message, 'approve 结论')
  })

  test('结论为 defer（非 approve）→ 同样拒绝', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('hfb-defer') })
    const org = await createOrganization(owner)
    const service = await makeService()
    const caseId = await seedCaseWithOutcome({
      organizationId: Number(org.id),
      ownerId: Number(owner.id),
      status: 'decided',
      action: 'defer',
    })
    const error = await catchCreate(service, owner, Number(org.id), {
      caseId,
      target: 'navigation',
      idempotencyKey: 'k2',
    })
    assert.include(error.message, 'approve 结论')
  })

  test('requiresSelectedOption 的目标在无选中方案时拒绝', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('hfb-optreq') })
    const org = await createOrganization(owner)
    const service = await makeService()
    const caseId = await seedCaseWithOutcome({
      organizationId: Number(org.id),
      ownerId: Number(owner.id),
      status: 'decided',
      action: 'approve',
      selectedOptionId: null,
    })
    const error = await catchCreate(service, owner, Number(org.id), {
      caseId,
      target: 'priority_review_intent',
      idempotencyKey: 'k3',
    })
    assert.include(error.message, '选中方案')
  })
})
