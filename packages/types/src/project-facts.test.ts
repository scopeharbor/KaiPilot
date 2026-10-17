import { describe, expect, it } from 'vitest'
import {
  PROJECT_INVESTMENT_TYPES,
  PROJECT_INVESTMENT_TYPE_VALUES,
  PROJECT_INVESTMENT_TYPE_DEFAULT,
  PROJECT_PORTFOLIO_FACT_SOURCES,
  PROJECT_PORTFOLIO_FACT_SOURCE_VALUES,
  PROJECT_PORTFOLIO_FACT_SOURCE_DEFAULT,
  PROJECT_CUSTOM_FIELD_DEFAULT_MAX_DEPTH,
  PROJECT_CUSTOM_FIELD_DEFAULT_MAX_KEYS,
  PROJECT_CUSTOM_FIELD_DEFAULT_MAX_SERIALIZED_CHARS,
  PROJECT_CUSTOM_FIELD_MAX_DEPTH_JSON,
  PROJECT_CUSTOM_FIELD_MAX_KEYS_JSON,
  PROJECT_CUSTOM_FIELD_MAX_SERIALIZED_CHARS,
  validateBoundedProjectCustomFields,
  makeLowSensitiveProjectFactAuditSummary,
  isProjectInvestmentType,
  isProjectPortfolioFactSource,
  type ProjectInvestmentType,
  type ProjectPortfolioFactSource,
  type ProjectFactDto,
  type ProjectFactUpdates,
  type ProjectCustomFields,
  type BoundedCustomFieldsCheck,
  PROJECT_FACT_UPDATEABLE_KEYS,
} from './project-facts.js'
import { makeProjectFactDto, flattenProjectCustomFields } from './project-facts.js'

describe('project-facts contract', () => {
  it('keeps enum/source values stable', () => {
    expect(PROJECT_INVESTMENT_TYPES).toEqual({
      STRATEGIC: 'strategic',
      COMPLIANCE: 'compliance',
      OPERATIONS: 'operations',
      INNOVATION: 'innovation',
      OTHER: 'other',
    })
    expect(PROJECT_PORTFOLIO_FACT_SOURCES).toEqual({
      MANUAL: 'manual',
      IMPORTED: 'imported',
      DERIVED_SNAPSHOT: 'derived_snapshot',
      UNKNOWN: 'unknown',
    })
    expect(PROJECT_INVESTMENT_TYPE_DEFAULT).toBe('other')
    expect(PROJECT_PORTFOLIO_FACT_SOURCE_DEFAULT).toBe('unknown')
  })

  it('preserves null-vs-zero forecast semantics', () => {
    expect(makeProjectFactDto()).toMatchObject({
      forecastCostCents: null,
      portfolioFactUpdatedAt: null,
    })
    const dto = makeProjectFactDto({ forecastCostCents: 0 })
    expect(dto.forecastCostCents).toBe(0)
  })

  it('accepts bounded safe custom fields', () => {
    const check = validateBoundedProjectCustomFields({
      kpi: 'alpha',
      team: { owner: 'eve', tier: { level: 2 } },
    })
    expect(check.ok).toBe(true)
  })

  it('rejects root arrays as custom root', () => {
    const check = validateBoundedProjectCustomFields(['a'])
    expect(check.ok).toBe(false)
    expect(check.violations).toContain('rootArrayNotAllowed')
  })

  it('rejects oversized depth/key-count/serialized payloads', () => {
    const deep: ProjectCustomFields = {}
    let cursor = deep
    for (let i = 0; i < PROJECT_CUSTOM_FIELD_DEFAULT_MAX_DEPTH + 2; i += 1) {
      cursor[`n${i}`] = {}
      cursor = cursor[`n${i}`] as never
    }
    expect(validateBoundedProjectCustomFields(deep).violations).toContain('depthExceeded')

    const manyKeys: ProjectCustomFields = {}
    for (let i = 0; i < PROJECT_CUSTOM_FIELD_DEFAULT_MAX_KEYS + 1; i += 1) {
      manyKeys[`k${i}`] = i
    }
    expect(validateBoundedProjectCustomFields(manyKeys).violations).toContain('keyCountExceeded')

    const oversized: ProjectCustomFields = {
      data: 'x'.repeat(PROJECT_CUSTOM_FIELD_DEFAULT_MAX_SERIALIZED_CHARS),
    }
    const check = validateBoundedProjectCustomFields(oversized)
    expect(check.ok).toBe(false)
    expect(check.violations.some((v) => v.startsWith('serializedBytesExceeded'))).toBe(true)
  })

  it('rejects executable / secret-like / sql / html / prompt-like keys and values', () => {
    const unsafe = validateBoundedProjectCustomFields({
      onclick: 'alert(1)',
      token: 'sk-live-secret',
      rawSql: 'select * from users',
      html: '<script>fetch("/x")</script>',
      promptDump: 'Here is a 5000 token model text...',
    })
    expect(unsafe.ok).toBe(false)
    expect(unsafe.violations.some((v) => v.startsWith('unsafeKey'))).toBe(true)
    expect(unsafe.violations.some((v) => v.startsWith('secretLikeValue'))).toBe(true)
    expect(unsafe.violations.some((v) => v.startsWith('rawSqlValue'))).toBe(true)
    expect(unsafe.violations.some((v) => v.startsWith('htmlScriptValue'))).toBe(true)
    expect(unsafe.violations.some((v) => v.startsWith('promptModelDumpValue'))).toBe(true)
  })

  it('builds a low-sensitive audit summary without full custom fields', () => {
    const summary = makeLowSensitiveProjectFactAuditSummary({
      investmentType: 'strategic',
      portfolioFactSource: 'manual',
      portfolioFactUpdatedAt: '2026-08-01T00:00:00.000Z',
      changedKeys: ['departmentKey', 'forecastCostCents'],
    })
    expect(summary.changed).toEqual(['departmentKey', 'forecastCostCents'])
    expect(summary.portfolioFactSource).toBe('manual')
    expect(summary.portfolioFactUpdatedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(summary.has('customFields')).toBe(false)
  })
})
