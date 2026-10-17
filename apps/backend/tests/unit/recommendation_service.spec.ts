import { test } from '@japa/runner'
import RecommendationService from '#services/recommendation/recommendation_service'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import {
  computePriority,
  computeDedupeKey,
  computeInputSignature,
  computeEvidenceHash,
} from '#services/recommendation/scoring'
import { assertTransition, getValidTransitions } from '#services/recommendation/status_machine'

const PM_ROLE = 'project_manager' as const

// ---------------------------------------------------------------------------
// Scoring & Status Machine Unit Tests
// ---------------------------------------------------------------------------

test.group('Recommendation scoring', () => {
  test('computePriority returns deterministic scores', ({ assert }) => {
    const p1 = computePriority({
      severity: 'critical',
      urgency: 10,
      impactScope: 'project',
      confidence: 'high',
    })
    const p2 = computePriority({
      severity: 'critical',
      urgency: 10,
      impactScope: 'project',
      confidence: 'high',
    })
    assert.equal(p1, p2)
    assert.isAbove(p1, 100)
  })

  test('computePriority: critical > info', ({ assert }) => {
    const crit = computePriority({
      severity: 'critical',
      urgency: 5,
      impactScope: 'task',
      confidence: 'medium',
    })
    const info = computePriority({
      severity: 'info',
      urgency: 1,
      impactScope: 'risk',
      confidence: 'low',
    })
    assert.isAbove(crit, info)
  })

  test('computeDedupeKey: same inputs produce same key', ({ assert }) => {
    const k1 = computeDedupeKey('risk', 'risk-123', 'task', 1)
    const k2 = computeDedupeKey('risk', 'risk-123', 'task', 1)
    assert.equal(k1, k2)
  })

  test('computeDedupeKey: different sources produce different keys', ({ assert }) => {
    const k1 = computeDedupeKey('risk', 'r1', 'task', 1)
    const k2 = computeDedupeKey('resource', 'r1', 'task', 1)
    assert.notEqual(k1, k2)
  })

  test('computeInputSignature is deterministic', ({ assert }) => {
    const s1 = computeInputSignature({
      sourceType: 'risk',
      sourceId: 'r1',
      dedupeKey: 'risk-r1',
      severity: 'high',
      priority: 80,
    })
    const s2 = computeInputSignature({
      sourceType: 'risk',
      sourceId: 'r1',
      dedupeKey: 'risk-r1',
      severity: 'high',
      priority: 80,
    })
    assert.equal(s1, s2)
  })

  test('computeEvidenceHash is deterministic', ({ assert }) => {
    const h1 = computeEvidenceHash([{ entityType: 'task', entityId: 1, summaryHash: 'abc' }])
    const h2 = computeEvidenceHash([{ entityType: 'task', entityId: 1, summaryHash: 'abc' }])
    assert.equal(h1, h2)
  })
})

test.group('Recommendation status machine', () => {
  test('assertTransition: valid transition does not throw', ({ assert }) => {
    assert.doesNotThrow(() => assertTransition('new', 'reviewing'))
    assert.doesNotThrow(() => assertTransition('new', 'accepted'))
    assert.doesNotThrow(() => assertTransition('converted', 'expired'))
  })

  test('assertTransition: invalid transition throws', ({ assert }) => {
    assert.throws(() => assertTransition('accepted', 'new'))
    assert.throws(() => assertTransition('converted', 'accepted'))
  })

  test('getValidTransitions returns correct list', ({ assert }) => {
    const newTrans = getValidTransitions('new')
    assert.includeMembers(newTrans, ['reviewing', 'accepted', 'dismissed'])

    const convertedTrans = getValidTransitions('converted')
    assert.deepEqual(convertedTrans, ['expired'])
  })
})

// ---------------------------------------------------------------------------
// Service Integration Tests
// ---------------------------------------------------------------------------

test.group('RecommendationService', (group) => {
  useAuthDatabase(group)

  function makeService() {
    const mockAudit = { log: async () => {} }
    return new RecommendationService(mockAudit as any)
  }

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rec-svc') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, PM_ROLE as any)
    return { owner, org, project }
  }

  test('refresh with limited sources', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const service = makeService()

    const result = await service.refreshProjectRecommendations({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
      sources: ['resource'],
    })

    assert.isNotNull(result.data)
    assert.isNotNull(result.warnings)
    assert.isNumber(result.created)

    const keys = Object.keys(result)
    assert.isTrue(keys.includes('data'))
    assert.isTrue(keys.includes('warnings'))
    assert.isTrue(keys.includes('created'))
    assert.isTrue(keys.includes('merged'))
  })

  test('refresh returns warnings', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const service = makeService()

    const result = await service.refreshProjectRecommendations({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    assert.isArray(result.warnings)
  })

  test('refresh without risk view still works', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const service = makeService()

    const result = await service.refreshProjectRecommendations({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: false,
      hasResourceView: false,
      hasChangeImpactView: false,
    })

    assert.isArray(result.data)
  })

  test('list returns paginated results', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const service = makeService()

    await service.refreshProjectRecommendations({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    const listResult = await service.list({
      projectId: Number(project.id),
      organizationId: Number(org.id),
      page: 1,
      perPage: 10,
    })

    const listKeys = Object.keys(listResult)
    assert.isTrue(listKeys.includes('data'))
    assert.isTrue(listKeys.includes('meta'))
    assert.isTrue(listKeys.includes('summary'))
    assert.isArray(listResult.data)
    assert.isAbove(listResult.meta.totalPages, 0)
  })

  test('getSummary returns correct shape', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const service = makeService()

    await service.refreshProjectRecommendations({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      hasRiskView: true,
      hasResourceView: true,
      hasChangeImpactView: true,
    })

    const summary = await service.getSummary(Number(org.id), Number(project.id))
    const summaryKeys = Object.keys(summary)
    assert.isTrue(summaryKeys.includes('totalCount'))
    assert.isTrue(summaryKeys.includes('criticalCount'))
    assert.isTrue(summaryKeys.includes('highCount'))
    assert.isTrue(summaryKeys.includes('newCount'))
    assert.isNumber(summary.totalCount)
  })

  test('getById with non-existent id throws', async ({ assert }) => {
    const { org, project } = await setupProject()
    const service = makeService()

    try {
      await service.getById(99999, Number(org.id), Number(project.id))
      assert.fail('should have thrown')
    } catch (err: any) {
      assert.equal(err.message, 'RESOURCE_NOT_FOUND')
    }
  })
})
