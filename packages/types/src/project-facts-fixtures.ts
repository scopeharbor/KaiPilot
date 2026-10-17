// @aiproj/types - V3 project fact fixtures.
// v3-database-schema-expansion: real but bounded facts for PMO portfolio follow-ups.
import {
  PROJECT_INVESTMENT_TYPES,
  PROJECT_PORTFOLIO_FACT_SOURCES,
  type ProjectFactDto,
  type ProjectInvestmentType,
  type ProjectPortfolioFactSource,
  type ProjectCustomFields,
  validateBoundedProjectCustomFields,
} from './project-facts.js'
import { makeProjectFactDto } from './project-facts.js'

export const V3_PROJECT_FACT_FIXTURE = {
  projectId: 1001,
  departmentKey: 'eng',
  departmentName: 'Engineering',
  businessLine: 'platform',
  investmentType: PROJECT_INVESTMENT_TYPES.STRATEGIC,
  strategyTheme: 'ai-native',
  programKey: 'pgm-ai-01',
  forecastCostCents: 4_200_000,
  forecastEndDate: '2027-06-30',
  customFields: {
    owner: 'eve',
    kpi: 'velocity',
    tier: { level: 'gold', region: 'cn' },
  },
  portfolioFactSource: PROJECT_PORTFOLIO_FACT_SOURCES.IMPORTED,
  portfolioFactUpdatedAt: '2026-08-01T00:00:00.000Z',
} satisfies ProjectFactDto

export const V3_PROJECT_FACT_BOUNDED_CUSTOM_COLLAPSED_FIXTURE: {
  dto: ProjectFactDto
  boundary: {
    ok: boolean
  }
} = {
  dto: makeProjectFactDto({ projectId: 42, customFactFields: { rank: 'a', nested: { v: 1 } } }),
  boundary: { ok: true },
}

export const V3_PROJECT_FACT_UNBOUNDED_FIXTURES: Array<{
  label: string
  payload: unknown
  expectOk: boolean
}> = [
  { label: 'rootArray', payload: [1], expectOk: false },
  { label: 'depth', payload: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }, expectOk: false },
  { label: 'secretLike', payload: { token: 'sk_cn_secret' }, expectOk: false },
  { label: 'rawSql', payload: { q: 'select 1' }, expectOk: false },
  { label: 'htmlScript', payload: { h: '<img onerror=x>' }, expectOk: false },
]

export function projectFactFixtureDto(
  input: ProjectFactDto = V3_PROJECT_FACT_FIXTURE,
): ProjectFactDto {
  return makeProjectFactDto(input)
}

void validateBoundedProjectCustomFields
void (null as unknown as ProjectInvestmentType)
void (null as unknown as ProjectPortfolioFactSource)
void (null as unknown as ProjectCustomFields)
