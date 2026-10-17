import { createHash } from 'node:crypto'
import type {
  ClarificationField,
  ClarificationValue,
  ConfirmedProjectContext,
  GroundingManifestFact,
  ProjectDraftGroundingManifest,
} from '@aiproj/types'
import { CARD_CATALOG } from '#services/ai_intent/catalog'

const MAX_FACTS = 32
const MAX_VALUE_LENGTH = 120
const SECRET_PATTERN =
  /(?:sk-[a-z0-9_-]{12,}|authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|api[_-]?key\s*[:=])/gi

function normalize(value: unknown): string {
  const text = Array.isArray(value) ? value.join('、') : String(value ?? '')
  return text
    .normalize('NFKC')
    .replace(SECRET_PATTERN, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_VALUE_LENGTH)
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/**
 * 所有 ClarificationField 的显式类别映射（编译期完整，禁止 fallback 到 deliverable）。
 * deliverable 类别只用于 parsedIntent.deliverables 本身。
 */
export const CLARIFICATION_FIELD_CATEGORY: Record<
  ClarificationField,
  GroundingManifestFact['category']
> = {
  projectGoal: 'business_concept',
  corePain: 'business_concept',
  targetUser: 'role',
  successMetrics: 'metric',
  scopeBoundary: 'in_scope',
  startDate: 'date',
  teamSize: 'role',
  techStack: 'business_concept',
  methodology: 'business_concept',
  qualityStandard: 'metric',
  communicationFreq: 'business_concept',
  integration: 'in_scope',
  compliance: 'in_scope',
  designPreference: 'business_concept',
  hosting: 'in_scope',
  thirdPartyServices: 'in_scope',
  securityControls: 'in_scope',
  performanceTarget: 'metric',
  migrationScope: 'in_scope',
  rolloutStrategy: 'business_concept',
  agentRisk: 'business_concept',
  agentDependency: 'business_concept',
  agentAcceptance: 'metric',
  agentStakeholder: 'role',
  agentConstraint: 'business_concept',
} as const satisfies Record<ClarificationField, GroundingManifestFact['category']>

function asCategory(field: ClarificationField): GroundingManifestFact['category'] {
  return CLARIFICATION_FIELD_CATEGORY[field]
}

function humanizeClarificationValue(
  field: ClarificationField,
  value: ClarificationValue,
): ClarificationValue {
  if (Array.isArray(value)) {
    return value.map((item) => humanizeClarificationValue(field, item) as string)
  }
  const option = CARD_CATALOG[field]?.quickOptions.find((item) => item.value === value)
  return option?.label ?? value
}

function isActionableConfirmedFact(value: ClarificationValue): boolean {
  const text = normalize(value)
  // 「先按角色估算」之类是让 AI 估算的指令而不是事实，不应要求草案原样写出（实测被补进章程范围）。
  return !/(?:由团队|按现有能力|暂不确定|尚未确定|后续再定|待确认|按角色估算|先按角色|你来建议|按行业常见)/.test(
    text,
  )
}

function pushFact(
  target: GroundingManifestFact[],
  input: {
    category: GroundingManifestFact['category']
    value: ClarificationValue | string
    source: GroundingManifestFact['source']
    required: boolean
  },
) {
  if (target.length >= MAX_FACTS) return
  const normalizedValue = normalize(input.value)
  if (!normalizedValue) return
  const duplicate = target.some(
    (fact) => fact.category === input.category && fact.normalizedValue === normalizedValue,
  )
  if (duplicate) return
  const ordinal = target.filter((fact) => fact.category === input.category).length + 1
  const id = `${input.category}:${ordinal}`
  target.push({
    id,
    category: input.category,
    normalizedValue,
    source: input.source,
    required: input.required,
    hash: stableHash(`${id}:${input.source}:${normalizedValue}`),
  })
}

/** 从权威确认上下文生成稳定 manifest；不会复制完整 rawInput。 */
export function buildGroundingManifest(
  context: ConfirmedProjectContext,
): ProjectDraftGroundingManifest {
  const facts: GroundingManifestFact[] = []
  pushFact(facts, {
    category: 'domain',
    value: context.parsedIntent.projectType,
    source: 'parsed',
    required: true,
  })

  for (const entity of context.parsedIntent.entities) {
    if (entity.type !== 'role') continue
    pushFact(facts, { category: 'role', value: entity.value, source: 'parsed', required: true })
  }
  for (const deliverable of context.parsedIntent.deliverables) {
    pushFact(facts, {
      category: 'deliverable',
      value: deliverable,
      source: 'parsed',
      required: true,
    })
  }
  for (const objective of context.parsedIntent.objectives) {
    pushFact(facts, {
      category: /\d/.test(objective) ? 'metric' : 'business_concept',
      value: objective,
      source: 'parsed',
      required: true,
    })
  }
  for (const date of [
    context.parsedIntent.timeline.startDate,
    context.parsedIntent.timeline.deadline,
  ]) {
    if (date) pushFact(facts, { category: 'date', value: date, source: 'parsed', required: true })
  }

  const appendFields = (
    fields: ConfirmedProjectContext['resolvedFields'],
    source: GroundingManifestFact['source'],
  ) => {
    for (const [field, marked] of Object.entries(fields)) {
      if (!marked) continue
      if (field === 'scopeBoundary' && typeof marked.value === 'string') {
        const [included, ...excludedParts] = marked.value.split(/(?:不包含|不包括|排除|不做)/)
        pushFact(facts, {
          category: 'in_scope',
          value: included ?? marked.value,
          source,
          required: source === 'confirmed',
        })
        if (excludedParts.length > 0) {
          pushFact(facts, {
            category: 'out_of_scope',
            value: excludedParts.join('、'),
            source,
            required: true,
          })
        }
        continue
      }
      pushFact(facts, {
        category: asCategory(field as ClarificationField),
        value: humanizeClarificationValue(field as ClarificationField, marked.value),
        source,
        required: source === 'confirmed' && isActionableConfirmedFact(marked.value),
      })
    }
  }
  appendFields(context.resolvedFields, 'confirmed')
  appendFields(context.assumptions, 'assumption')

  const canonical = JSON.stringify({
    version: '1.0',
    projectType: context.parsedIntent.projectType,
    facts,
  })
  return {
    version: '1.0',
    projectType: context.parsedIntent.projectType,
    facts,
    hash: stableHash(canonical),
    truncated: facts.length >= MAX_FACTS,
  }
}
