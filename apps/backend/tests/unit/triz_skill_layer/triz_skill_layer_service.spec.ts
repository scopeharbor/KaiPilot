/**
 * TRIZ Skill Layer Service 测试
 * 覆盖 manifest resolver, stage binding, route preview, handoff preview。
 */
import { test } from '@japa/runner'
import {
  buildTrizDestinationCatalog,
  computeAllStageBindings,
  sortTrizRouteDecisions,
  computeTrizRouteActionId,
  normalizeTrizSkillLayerIdempotencyKey,
  validateHandoffStaleState,
  TRIZ_SKILL_DESTINATION_KEYS,
  LOGICAL_STAGE_KEYS,
  isTrizSkillLayerSensitiveField,
  isL3Excluded,
} from '@aiproj/types'

test.group('TrizSkillLayerService - Catalog', () => {
  test('catalog is complete with 13 destinations', ({ assert }) => {
    const catalog = buildTrizDestinationCatalog()
    assert.equal(catalog.length, 13)
    for (const key of TRIZ_SKILL_DESTINATION_KEYS) {
      assert.isTrue(
        catalog.some((e) => e.destinationKey === key),
        `missing key: ${key}`,
      )
    }
  })

  test('every catalog entry has stage bindings and permissions', ({ assert }) => {
    const catalog = buildTrizDestinationCatalog()
    for (const entry of catalog) {
      assert.isTrue(
        entry.defaultStageBindings.length > 0,
        `${entry.destinationKey} has no stage bindings`,
      )
      assert.isTrue(
        entry.defaultRequiredPermissions.length > 0,
        `${entry.destinationKey} has no permissions`,
      )
      assert.isNotEmpty(entry.name)
      assert.isNotEmpty(entry.description)
    }
  })
})

test.group('TrizSkillLayerService - Stage Binding', () => {
  const catalog = buildTrizDestinationCatalog()
  const allKeys = new Set(TRIZ_SKILL_DESTINATION_KEYS)
  const perms = new Set(catalog.flatMap((e) => e.defaultRequiredPermissions))

  test('all 7 stages are bound', ({ assert }) => {
    const bindings = computeAllStageBindings(catalog, allKeys, perms, new Set())
    assert.equal(bindings.length, 7)
    for (const stage of LOGICAL_STAGE_KEYS) {
      assert.isTrue(
        bindings.some((b) => b.stage === stage),
        `missing binding for stage: ${stage}`,
      )
    }
  })

  test('requirements_parsing recommends contradiction discovery', ({ assert }) => {
    const bindings = computeAllStageBindings(catalog, allKeys, perms, new Set())
    const reqBinding = bindings.find((b) => b.stage === 'requirements_parsing')!
    assert.isTrue(reqBinding.recommendedDestinations.includes('contradiction_discovery'))
  })

  test('solution_design recommends matrix and IFR', ({ assert }) => {
    const bindings = computeAllStageBindings(catalog, allKeys, perms, new Set())
    const solBinding = bindings.find((b) => b.stage === 'solution_design')!
    assert.isTrue(solBinding.recommendedDestinations.includes('contradiction_matrix'))
    assert.isTrue(solBinding.recommendedDestinations.includes('ifr_visualization'))
  })

  test('monitoring_review recommends evolution trend', ({ assert }) => {
    const bindings = computeAllStageBindings(catalog, allKeys, perms, new Set())
    const monBinding = bindings.find((b) => b.stage === 'monitoring_review')!
    assert.isTrue(monBinding.recommendedDestinations.includes('evolution_trend_analysis'))
  })

  test('stage binding is deterministic', ({ assert }) => {
    const b1 = computeAllStageBindings(catalog, allKeys, perms, new Set())
    const b2 = computeAllStageBindings(catalog, allKeys, perms, new Set())
    assert.deepEqual(b1, b2)
  })

  test('missing permissions produce warning', ({ assert }) => {
    const bindings = computeAllStageBindings(catalog, allKeys, new Set(), new Set())
    for (const b of bindings) {
      if (b.recommendedDestinations.length === 0) {
        assert.isTrue(b.warnings.length > 0)
      }
    }
  })
})

test.group('TrizSkillLayerService - Route Preview', () => {
  test('computeTrizRouteActionId is deterministic', ({ assert }) => {
    const id1 = computeTrizRouteActionId('contradiction_discovery', 'req', 'skill/1', 'key-001')
    const id2 = computeTrizRouteActionId('contradiction_discovery', 'req', 'skill/1', 'key-001')
    assert.equal(id1, id2)
  })

  test('normalizeTrizSkillLayerIdempotencyKey handles edge cases', ({ assert }) => {
    assert.equal(normalizeTrizSkillLayerIdempotencyKey('  abc  '), 'abc')
    assert.equal(normalizeTrizSkillLayerIdempotencyKey('abc\x00def'), 'abcdef')
    assert.isAtMost(normalizeTrizSkillLayerIdempotencyKey('a'.repeat(300)).length, 256)
  })

  test('sortTrizRouteDecisions sorts by score desc and key asc', ({ assert }) => {
    const routes = [
      { destinationKey: 'z', deterministicScore: 50 } as any,
      { destinationKey: 'a', deterministicScore: 90 } as any,
      { destinationKey: 'b', deterministicScore: 90 } as any,
    ]
    const sorted = sortTrizRouteDecisions(routes as any)
    assert.equal(sorted[0].destinationKey, 'a')
    assert.equal(sorted[1].destinationKey, 'b')
    assert.equal(sorted[2].destinationKey, 'z')
  })
})

test.group('TrizSkillLayerService - Handoff Preview', () => {
  test('validateHandoffStaleState passes when no current hashes', ({ assert }) => {
    const result = validateHandoffStaleState({ contradiction: 'abc' })
    assert.isTrue(result.valid)
    assert.isFalse(result.stale)
  })

  test('validateHandoffStaleState detects stale', ({ assert }) => {
    const result = validateHandoffStaleState({ contradiction: 'abc' }, { contradiction: 'def' })
    assert.isFalse(result.valid)
    assert.isTrue(result.stale)
    assert.include(result.warnings, 'TRIZ_SL_STALE_SOURCE_HASH')
  })

  test('validateHandoffStaleState passes when hashes match', ({ assert }) => {
    const result = validateHandoffStaleState(
      { contradiction: 'abc', matrix: 'xyz' },
      { contradiction: 'abc', matrix: 'xyz' },
    )
    assert.isTrue(result.valid)
    assert.isFalse(result.stale)
  })
})

test.group('TrizSkillLayerService - Redaction & L3', () => {
  test('sensitive fields are detected', ({ assert }) => {
    // prompt/model_output/token/secret/authorization/raw_payload/full_path 都被检测
    assert.isTrue(isTrizSkillLayerSensitiveField('prompt'))
    assert.isTrue(isTrizSkillLayerSensitiveField('model_output'))
    assert.isTrue(isTrizSkillLayerSensitiveField('token'))
    assert.isTrue(isTrizSkillLayerSensitiveField('secret'))
    assert.isTrue(isTrizSkillLayerSensitiveField('Authorization'))
    assert.isTrue(isTrizSkillLayerSensitiveField('raw_evidence'))
    assert.isTrue(isTrizSkillLayerSensitiveField('full_path'))
    // 安全字段不检测
    assert.isFalse(isTrizSkillLayerSensitiveField('name'))
    assert.isFalse(isTrizSkillLayerSensitiveField('sourceHash'))
  })

  test('L3 is excluded in production', ({ assert }) => {
    assert.isTrue(isL3Excluded('L3', 'production'))
    assert.isFalse(isL3Excluded('L3', 'eval'))
    assert.isFalse(isL3Excluded('L2', 'production'))
    assert.isFalse(isL3Excluded(undefined, 'production'))
  })
})
