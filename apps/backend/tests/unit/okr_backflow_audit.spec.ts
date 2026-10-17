/**
 * OKR Backflow 审计低敏测试（v3-okr-progress-backflow 3.9）。
 *
 * 验证：
 *   - suggestion / source snapshot 不包含任务备注、证据文本
 *   - 不包含 prompts、model output、tokens
 *   - 不包含 Authorization headers、API keys
 *   - 不包含跨组织数据
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import OkrProgressBackflowService from '#services/okr_progress_backflow_service'
import OkrPolicy from '#policies/okr_policy'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrProgressBackflowSuggestion from '#models/okr_progress_backflow_suggestion'
import OkrProgressBackflowSourceSnapshot from '#models/okr_progress_backflow_source_snapshot'
import { createOrganization, createUser, uniqueEmail } from '../functional/auth/_helpers.js'
import testUtils from '@adonisjs/core/services/test_utils'

const SENSITIVE_PATTERNS = [
  'Authorization',
  'Bearer',
  'x-api-key',
  'api_key',
  'apiKey',
  'password',
  'token',
  'secret',
  'prompt',
  'model_output',
  'modelOutput',
]

test.group('OKR Backflow Audit', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  let service: OkrProgressBackflowService
  let ownerUser: any
  let org: any

  group.each.setup(async () => {
    const rbac = new RbacService()
    const orgPolicy = new OrganizationPolicy(rbac)
    const policy = new OkrPolicy(rbac, orgPolicy)
    service = new OkrProgressBackflowService(policy)

    const owner = await createUser({ email: uniqueEmail('audit-bf') })
    org = await createOrganization(owner)
    ownerUser = owner
  })

  async function seedAuditFixture(orgId: number) {
    const cycle = await OkrCycle.create({
      organizationId: orgId,
      title: '2026 Q3',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    const obj = await OkrObjective.create({
      organizationId: orgId,
      cycleId: cycle.id,
      title: 'Audit Objective',
      scope: 'organization',
      status: 'active',
      weight: 1,
      progress: 0,
      confidence: 'medium',
      metricVersion: '1.0.0',
    })
    const kr = await OkrKeyResult.create({
      organizationId: orgId,
      objectiveId: obj.id,
      title: 'Audit KR',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 40,
      weight: 100,
      status: 'active',
      confidence: 'medium',
    })
    return { cycle, obj, kr }
  }

  // ── Suggestion DTO ────────────────────────────────────────────────────

  test('recalculate Suggestion DTO 不暴露敏感字段', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    const suggestion = await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    const json = JSON.stringify(suggestion)
    for (const pat of SENSITIVE_PATTERNS) {
      assert.notInclude(json, pat, `Suggestion DTO 不应包含 "${pat}"`)
    }
  })

  test('Suggestion DTO 不包含任务备注/证据文本', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    const suggestion = await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    // contribution 中不应暴露业务明文
    for (const c of (suggestion as any).contributions ?? []) {
      const srcJson = JSON.stringify(c)
      assert.notInclude(srcJson, 'note')
      assert.notInclude(srcJson, 'description')
      assert.notInclude(srcJson, 'evidence')
      assert.notInclude(srcJson, 'comment')
    }
  })

  test('persisted suggestion 数据库行不含明文敏感列', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    const rows = await OkrProgressBackflowSuggestion.query()
      .where('organization_id', org.id)
      .where('key_result_id', kr.id)

    assert.isAtLeast(rows.length, 1)
    const row = rows[0]

    // contributions_json 和 warnings_json 中不含明文敏感数据
    const contribStr = row.contributionsJson ?? ''
    for (const pat of SENSITIVE_PATTERNS) {
      assert.notInclude(contribStr, pat)
    }

    const warningsStr = row.warningsJson ?? ''
    for (const pat of SENSITIVE_PATTERNS) {
      assert.notInclude(warningsStr, pat)
    }
  })

  test('source snapshot 不记录业务明文', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    const snapshots = await OkrProgressBackflowSourceSnapshot.query().where(
      'organization_id',
      org.id,
    )

    for (const snap of snapshots) {
      const json = JSON.stringify(snap)
      for (const pat of SENSITIVE_PATTERNS) {
        assert.notInclude(json, pat, `Source snapshot 不应包含 "${pat}"`)
      }
      // 不记录源 title
      assert.notInclude(json, 'title')
      assert.notInclude(json, 'description')
    }
  })

  test('suggestion hash 不包含可逆推明文', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    const suggestion = await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    // hash 本身不应包含原始任务文本
    const hash = suggestion.suggestionHash
    for (const pat of SENSITIVE_PATTERNS) {
      assert.notInclude(hash.toLowerCase(), pat.toLowerCase())
    }
  })

  test('跨组织数据不泄漏到 suggestion DTO', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    const suggestion = await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    // 所有 contribution 的 source.organizationId 应等于本组织 id
    for (const c of (suggestion as any).contributions ?? []) {
      if (c.source?.organizationId) {
        assert.equal(c.source.organizationId, org.id)
      }
    }
  })

  test('listSuggestions 不泄露跨组织数据', async ({ assert }) => {
    const { kr } = await seedAuditFixture(org.id)
    await service.recalculateKeyResult(org.id, kr.id, ownerUser)

    const result = await service.listSuggestions(org.id, {}, ownerUser)
    for (const s of result.data) {
      assert.equal(s.organizationId, org.id)
      for (const c of (s as any).contributions ?? []) {
        if (c.source?.organizationId) {
          assert.equal(c.source.organizationId, org.id)
        }
      }
    }
  })
})
