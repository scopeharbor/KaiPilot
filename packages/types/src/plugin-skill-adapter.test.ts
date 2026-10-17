import { describe, expect, it } from 'vitest'
import {
  PLUGIN_SEAM_COMPILER_CONTRIBUTION,
  PLUGIN_SEAM_SKILL_BUNDLE,
  validateCompilerContributionPayload,
  validatePluginContributionPayload,
  validateSkillBundlePayload,
} from './plugin-skill-adapter.js'
import { PLUGIN_SEAM_TEMPLATE_PACK, PILOT_TEMPLATE_PACK_PAYLOAD } from './plugin-template-pack.js'
import { NEGATIVE_TEMPLATE_PACK_FIXTURES } from './plugin-template-pack-fixtures.js'
import {
  fixtureNonAdvisoryCompilerPayload,
  fixtureParallelActivationPayload,
  fixtureParallelStateMachinePayload,
  fixtureSecretDetectedPayload,
  fixtureSecretKeyPayload,
  fixtureStageInvariantViolationPayload,
  fixtureValidCompilerContributionPayload,
  fixtureValidSkillBundlePayload,
} from './plugin-skill-adapter-fixtures.js'

describe('plugin-skill-adapter payload validation and parallel recreation blocking', () => {
  it('validates legal skill-bundle payload', () => {
    const res = validateSkillBundlePayload(fixtureValidSkillBundlePayload, '1.0.0')
    expect(res.valid).toBe(true)
    expect(res.findings).toHaveLength(0)
    expect(res.normalizedPayload).toEqual(fixtureValidSkillBundlePayload)

    // Through dispatch
    const resDispatch = validatePluginContributionPayload(
      PLUGIN_SEAM_SKILL_BUNDLE,
      fixtureValidSkillBundlePayload,
      '1.0.0',
    )
    expect(resDispatch.valid).toBe(true)
  })

  it('validates legal compiler-contribution payload', () => {
    const res = validateCompilerContributionPayload(
      fixtureValidCompilerContributionPayload,
      '1.0.0',
    )
    expect(res.valid).toBe(true)
    expect(res.findings).toHaveLength(0)
    expect(res.normalizedPayload).toEqual(fixtureValidCompilerContributionPayload)

    // Through dispatch
    const resDispatch = validatePluginContributionPayload(
      PLUGIN_SEAM_COMPILER_CONTRIBUTION,
      fixtureValidCompilerContributionPayload,
      '1.0.0',
    )
    expect(resDispatch.valid).toBe(true)
  })

  it('blocks parallel state machine recreation', () => {
    const res = validateSkillBundlePayload(fixtureParallelStateMachinePayload, '1.0.0')
    expect(res.valid).toBe(false)
    const codes = res.findings.map((f) => f.code)
    expect(codes).toContain('plugin-skill-adapter-parallel-state-machine')
  })

  it('blocks parallel activation algorithm recreation', () => {
    const res = validateSkillBundlePayload(fixtureParallelActivationPayload, '1.0.0')
    expect(res.valid).toBe(false)
    const codes = res.findings.map((f) => f.code)
    expect(codes).toContain('plugin-skill-adapter-parallel-activation-algorithm')
  })

  it('blocks stage invariant violations in compiler contribution', () => {
    const res = validateCompilerContributionPayload(fixtureStageInvariantViolationPayload, '1.0.0')
    expect(res.valid).toBe(false)
    const codes = res.findings.map((f) => f.code)
    expect(codes).toContain('plugin-skill-adapter-stage-invariant-violation')
  })

  it('blocks non-advisory compiler contribution declaration', () => {
    const res = validateCompilerContributionPayload(fixtureNonAdvisoryCompilerPayload, '1.0.0')
    expect(res.valid).toBe(false)
    const codes = res.findings.map((f) => f.code)
    expect(codes).toContain('plugin-skill-adapter-missing-advisory-flag')
  })

  it('blocks secret and token material in payloads', () => {
    // Secret in value
    const resValue = validateSkillBundlePayload(fixtureSecretDetectedPayload, '1.0.0')
    expect(resValue.valid).toBe(false)
    expect(resValue.findings.some((f) => f.code === 'plugin-skill-adapter-secret-detected')).toBe(
      true,
    )

    // Secret in key
    const resKey = validateSkillBundlePayload(fixtureSecretKeyPayload, '1.0.0')
    expect(resKey.valid).toBe(false)
    expect(resKey.findings.some((f) => f.code === 'plugin-skill-adapter-secret-detected')).toBe(
      true,
    )
  })

  it('rejects unallowed unknown fields (closed field set)', () => {
    const res = validateSkillBundlePayload({
      ...fixtureValidSkillBundlePayload,
      extraRandomField: 'unexpected',
    })
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-skill-adapter-unallowed-field')).toBe(true)
  })

  it('rejects incompatible seam versions', () => {
    const res = validateSkillBundlePayload(fixtureValidSkillBundlePayload, '2.0.0')
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'plugin-skill-adapter-incompatible-seam-version'),
    ).toBe(true)
  })

  it('validates legal template-pack payload through dispatch', () => {
    const res = validatePluginContributionPayload(
      PLUGIN_SEAM_TEMPLATE_PACK,
      PILOT_TEMPLATE_PACK_PAYLOAD,
      '1.0.0',
    )
    expect(res.valid).toBe(true)
    expect(res.findings).toHaveLength(0)
    expect(res.normalizedPayload).toBeDefined()
  })

  it('rejects invalid template-pack payload through dispatch', () => {
    const res = validatePluginContributionPayload(
      PLUGIN_SEAM_TEMPLATE_PACK,
      NEGATIVE_TEMPLATE_PACK_FIXTURES.invalidIdPrefix,
      '1.0.0',
    )
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-template-pack-invalid-id-prefix')).toBe(true)
  })

  it('rejects unknown seam key in dispatch', () => {
    const res = validatePluginContributionPayload('unknown.seam-key', {})
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'plugin-skill-adapter-unknown-seam')).toBe(true)
  })
})
