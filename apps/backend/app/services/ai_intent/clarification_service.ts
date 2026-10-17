import { createHash } from 'node:crypto'
import {
  AI_INTENT_SCHEMA_VERSION,
  CORE_CLARIFICATION_FIELDS,
  type AiMarker,
  type AnalyzeProjectIntentResponse,
  type ClarificationAnswer,
  type ClarificationAnswers,
  type ClarificationCard,
  type ClarificationCategory,
  type ClarificationCustomInput,
  type ClarificationField,
  type ClarificationQuestionType,
  type ClarificationPhase,
  type ClarificationValue,
  type ConfirmedProjectContext,
  type Marked,
  type ParsedIntent,
} from '@aiproj/types'
import { ValidationException } from '../../exceptions/api_exception.js'
import IntentParserService from './intent_parser_service.js'
import { CARD_CATALOG, makeCardId } from './catalog.js'
import QuestionPlanChecker from './question_plan_checker.js'
import { selectQuestionPacks, type SelectedQuestionPack } from './question_packs.js'

const CATEGORY_RANK: Record<ClarificationCategory, number> = {
  critical: 0,
  recommended: 1,
  optional: 2,
}

const SENSITIVE_COMPLIANCE_PATTERN = /支付|身份|身份证|医疗|病历|健康|金融|银行卡/u
const METHODOLOGY_PATTERN = /scrum|kanban|敏捷|瀑布|混合模式/iu
const QUALITY_PATTERN = /验收|质量标准|测试覆盖|可用性|性能指标/u
const COMMUNICATION_PATTERN = /日报|周报|每天同步|每周同步|双周同步|站会/u
const INTEGRATION_PATTERN = /集成|对接|接口|api/iu
const COMPLIANCE_PATTERN = /合规|隐私|安全|等保|gdpr|个人信息/iu
const DESIGN_PATTERN = /设计风格|视觉风格|极简|现代|活泼|专业风格/u
const HOSTING_PATTERN = /部署|托管|云服务器|自有服务器|serverless|私有化/iu
const THIRD_PARTY_PATTERN = /第三方|短信服务|邮件服务|地图服务|支付服务/u
const CORE_PAIN_PATTERN = /痛点|问题|低效|重复|缓慢|不透明|返工|遗漏|协作困难/u
const SUCCESS_METRIC_PATTERN = /成功指标|目标值|提升\s*\d|降低\s*\d|减少\s*\d|\d+%|sla|slo|验收/iu
const SCOPE_PATTERN = /首期|第一期|mvp|原型|范围|不包含|暂不|分阶段/u
const SECURITY_PATTERN = /安全|权限|审计|敏感|隐私|身份|支付|医疗|金融|等保|gdpr/iu
const PERFORMANCE_PATTERN = /性能|并发|延迟|吞吐|峰值|sla|slo|实时|高可用|容灾/iu
const MIGRATION_PATTERN = /迁移|历史数据|旧系统|既有系统|导入|切换/iu
const ROLLOUT_PATTERN = /上线|推广|试点|灰度|培训|采用率|全员/iu

const CORE_FIELD_SET = new Set<ClarificationField>(CORE_CLARIFICATION_FIELDS)

type ResolvedFields = ConfirmedProjectContext['resolvedFields']
type Assumptions = ConfirmedProjectContext['assumptions']

const PROJECT_TYPE_FIELD_EXCLUSIONS: Partial<
  Record<ParsedIntent['projectType'], Set<ClarificationField>>
> = {
  event: new Set(['techStack', 'integration', 'designPreference', 'hosting']),
}

function marker(source: AiMarker['source'], reason: string, confidence: number): AiMarker {
  return {
    source,
    reason,
    confidence,
    needsConfirmation: source !== 'explicit',
  }
}

function marked(
  value: Exclude<ClarificationValue, null>,
  source: AiMarker['source'],
  reason: string,
  confidence: number,
): Marked<Exclude<ClarificationValue, null>> {
  return { value, marker: marker(source, reason, confidence) }
}

function categoryFor(field: ClarificationField, parsedIntent: ParsedIntent, rawInput: string) {
  if (CORE_FIELD_SET.has(field)) return 'critical'
  if (field === 'startDate') {
    return parsedIntent.timeline.durationDays !== null || parsedIntent.timeline.deadline !== null
      ? 'critical'
      : 'recommended'
  }
  if (field === 'teamSize' && parsedIntent.deliverables.length > 3) {
    return 'critical'
  }
  if (field === 'compliance' && SENSITIVE_COMPLIANCE_PATTERN.test(rawInput)) {
    return 'recommended'
  }
  return CARD_CATALOG[field].defaultCategory
}

function evidenceSentence(rawInput: string, pattern: RegExp): string | null {
  const segments = rawInput
    .split(/[。！？!?；;\n]/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const matched = segments.find((segment) => pattern.test(segment))
  return matched ? matched.slice(0, 220) : null
}

function successMetricEvidence(rawInput: string): string | null {
  const sentenceSegments = rawInput
    .split(/[。！？!?；;\n]/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const commaSegments = rawInput
    .split(/[。！？!?；;\n，,]/u)
    .map((segment) => segment.trim())
    .filter(Boolean)

  const allCandidates = Array.from(new Set([...sentenceSegments, ...commaSegments])).filter(
    (segment) => segment.length > 0 && SUCCESS_METRIC_PATTERN.test(segment),
  )

  const score = (segment: string) => {
    let value = 0
    if (/成功指标|验收要求|验收标准|质量目标|目标值|指标要求/u.test(segment)) value += 10
    if (
      /≥|<=|>=|≤|\d+(?:\.\d+)?\s*%|p\d+|成功率|命中率|达成率|达标率|可用性|响应时间|\d+\s*(?:毫秒|秒|分钟|小时|天)/iu.test(
        segment,
      )
    ) {
      value += 8
    }
    if (/\bsla\b|\bslo\b/iu.test(segment)) {
      if (/sla\s*(?:≥|>=|<=|≤|:|：|>|<|\d|命中率|达标率|达成率)/iu.test(segment)) {
        value += 5
      } else {
        value += 1
      }
    }
    if (/范围(?:包含|包括|涵盖)|不包含|明确排除|暂不包含|暂不考虑|排除/u.test(segment)) {
      value -= 15
    } else if (/范围|包含|暂不|mvp|首期/u.test(segment)) {
      value -= 8
    }
    return value
  }

  const scored = allCandidates
    .map((segment) => ({ segment, score: score(segment) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  const matched = scored[0]?.segment
  return matched ? matched.slice(0, 220) : null
}

function isRelevantField(field: ClarificationField, parsedIntent: ParsedIntent): boolean {
  return !PROJECT_TYPE_FIELD_EXCLUSIONS[parsedIntent.projectType]?.has(field)
}

function explicitFields(parsedIntent: ParsedIntent, rawInput: string): ResolvedFields {
  const fields: ResolvedFields = {}
  const firstRole = parsedIntent.entities.find((entity) => entity.type === 'role')
  const teamSize = parsedIntent.entities.find((entity) => entity.type === 'team_size')
  const technologies = parsedIntent.entities
    .filter((entity) => entity.type === 'technology')
    .map((entity) => String(entity.value))

  if (parsedIntent.objectives[0]) {
    fields.projectGoal = marked(
      parsedIntent.objectives[0],
      'explicit',
      '来自用户输入中的目标表述。',
      0.96,
    )
  }
  const corePain = evidenceSentence(rawInput, CORE_PAIN_PATTERN)
  if (corePain) {
    fields.corePain = marked(corePain, 'explicit', '来自用户输入中的问题或痛点表述。', 0.9)
  }
  if (firstRole) {
    fields.targetUser = marked(firstRole.value, 'explicit', '来自用户输入中的目标角色。', 0.94)
  }
  const successMetrics = successMetricEvidence(rawInput)
  if (successMetrics) {
    fields.successMetrics = marked(
      successMetrics,
      'explicit',
      '来自用户输入中的指标或验收表述。',
      0.9,
    )
  }
  const scopeBoundary = evidenceSentence(rawInput, SCOPE_PATTERN)
  if (scopeBoundary) {
    fields.scopeBoundary = marked(scopeBoundary, 'explicit', '来自用户输入中的范围边界表述。', 0.9)
  }
  if (parsedIntent.timeline.startDate) {
    fields.startDate = marked(
      parsedIntent.timeline.startDate,
      'explicit',
      '来自用户输入中的开始日期。',
      0.99,
    )
  }
  if (teamSize) {
    fields.teamSize = marked(teamSize.value, 'explicit', '来自用户输入中的团队人数。', 0.99)
  }
  if (technologies.length > 0) {
    fields.techStack = marked(technologies, 'explicit', '来自用户输入中的技术栈要求。', 0.99)
  }
  if (METHODOLOGY_PATTERN.test(rawInput)) {
    fields.methodology = marked(
      rawInput.match(METHODOLOGY_PATTERN)?.[0] ?? '已指定',
      'explicit',
      '来自用户输入中的推进方式。',
      0.94,
    )
  }
  if (QUALITY_PATTERN.test(rawInput)) {
    fields.qualityStandard = marked(
      evidenceSentence(rawInput, QUALITY_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到质量或验收要求。',
      0.9,
    )
  }
  if (COMMUNICATION_PATTERN.test(rawInput)) {
    fields.communicationFreq = marked(
      rawInput.match(COMMUNICATION_PATTERN)?.[0] ?? '已指定',
      'explicit',
      '识别到沟通频率。',
      0.9,
    )
  }
  if (INTEGRATION_PATTERN.test(rawInput)) {
    fields.integration = marked(
      evidenceSentence(rawInput, INTEGRATION_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到系统集成要求。',
      0.88,
    )
  }
  if (COMPLIANCE_PATTERN.test(rawInput)) {
    fields.compliance = marked(
      evidenceSentence(rawInput, COMPLIANCE_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到合规或安全要求。',
      0.9,
    )
  }
  if (DESIGN_PATTERN.test(rawInput)) {
    fields.designPreference = marked(
      evidenceSentence(rawInput, DESIGN_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到设计偏好。',
      0.88,
    )
  }
  if (HOSTING_PATTERN.test(rawInput)) {
    fields.hosting = marked(
      evidenceSentence(rawInput, HOSTING_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到部署或托管要求。',
      0.88,
    )
  }
  if (THIRD_PARTY_PATTERN.test(rawInput)) {
    fields.thirdPartyServices = marked(
      evidenceSentence(rawInput, THIRD_PARTY_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到第三方服务要求。',
      0.88,
    )
  }
  if (SECURITY_PATTERN.test(rawInput)) {
    fields.securityControls = marked(
      evidenceSentence(rawInput, SECURITY_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到安全控制要求。',
      0.9,
    )
  }
  if (PERFORMANCE_PATTERN.test(rawInput)) {
    fields.performanceTarget = marked(
      evidenceSentence(rawInput, PERFORMANCE_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到性能或服务级别要求。',
      0.9,
    )
  }
  if (MIGRATION_PATTERN.test(rawInput)) {
    fields.migrationScope = marked(
      evidenceSentence(rawInput, MIGRATION_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到迁移或切换要求。',
      0.88,
    )
  }
  if (ROLLOUT_PATTERN.test(rawInput)) {
    fields.rolloutStrategy = marked(
      evidenceSentence(rawInput, ROLLOUT_PATTERN) ?? rawInput.slice(0, 220),
      'explicit',
      '识别到上线或推广要求。',
      0.88,
    )
  }
  return fields
}

function isNonNullValue(value: ClarificationValue): value is Exclude<ClarificationValue, null> {
  return value !== null && value !== ''
}

function customInputFor(
  questionType: ClarificationQuestionType,
  field: ClarificationField,
): ClarificationCustomInput {
  const placeholders: Record<ClarificationQuestionType, string> = {
    single_choice: '也可以输入一个更贴近你们实际情况的选项',
    multi_choice: '可以输入多个自定义选项，用逗号分隔',
    number: '请输入数字',
    date: '请选择或输入日期',
    text: '请输入补充说明',
  }
  return {
    enabled: true,
    label: '自定义输入',
    placeholder: placeholders[questionType],
    description: `如果以上选项不适合，可以直接补充 ${field} 的真实情况。`,
  }
}

export default class ClarificationService {
  constructor(
    private readonly parser = new IntentParserService(),
    private readonly planChecker = new QuestionPlanChecker(),
  ) {}

  assertQuestionPlanRevision(
    rawInput: string,
    answers: ClarificationAnswers,
    revision: string,
  ): void {
    const candidates = Object.entries(answers).filter(([, answer]) => Boolean(answer?.cardId))
    const matchesPreviousPlan = candidates.some(([fieldValue, answer]) => {
      const previousAnswers = { ...answers }
      delete previousAnswers[fieldValue as ClarificationField]
      const previous = this.analyze(rawInput, previousAnswers)
      return (
        previous.questionPlanRevision === revision && previous.activeCard?.cardId === answer?.cardId
      )
    })
    if (!matchesPreviousPlan) {
      throw new ValidationException('QUESTION_PLAN_STALE：问题计划已更新，请重新载入当前问题')
    }
  }

  analyze(rawInput: string, answers: ClarificationAnswers = {}): AnalyzeProjectIntentResponse {
    const parsedIntent = this.parser.parse(rawInput)
    const parsedSuggestions = explicitFields(parsedIntent, rawInput)
    const resolvedFields: ResolvedFields = {}
    for (const [fieldValue, value] of Object.entries(parsedSuggestions)) {
      const field = fieldValue as ClarificationField
      if (!CORE_FIELD_SET.has(field) && value) resolvedFields[field] = value
    }

    // 回退映射：当 successMetrics 建议值缺失或命中 scope 文本时，用 resolvedFields.qualityStandard 回填
    const currentMetricsValue = parsedSuggestions.successMetrics?.value
    const isMissingOrScope =
      !currentMetricsValue ||
      (typeof currentMetricsValue === 'string' &&
        (/范围(?:包含|包括|涵盖)|不包含|明确排除|暂不/u.test(currentMetricsValue) ||
          (/范围|包含/u.test(currentMetricsValue) && !/≥|≤|\d+%/u.test(currentMetricsValue))))

    if (isMissingOrScope && resolvedFields.qualityStandard?.value) {
      parsedSuggestions.successMetrics = marked(
        resolvedFields.qualityStandard.value,
        resolvedFields.qualityStandard.marker.source,
        '从已识别的质量或验收标准回填指标建议。',
        resolvedFields.qualityStandard.marker.confidence,
      )
    }
    const assumptions: Assumptions = {}
    const unansweredOptionalFields: ClarificationField[] = []

    for (const [fieldValue, answerValue] of Object.entries(answers)) {
      const field = fieldValue as ClarificationField
      const answer = answerValue as ClarificationAnswer | undefined
      if (!answer || answer.field !== field || !(field in CARD_CATALOG)) {
        throw new ValidationException(`澄清回答字段 ${fieldValue} 无效`)
      }
      this.applyAnswer(
        field,
        answer,
        categoryFor(field, parsedIntent, rawInput),
        resolvedFields,
        assumptions,
        unansweredOptionalFields,
      )
    }

    const unansweredCore = CORE_CLARIFICATION_FIELDS.filter((field) => answers[field] === undefined)
    const selectedPacks =
      unansweredCore.length === 0 ? selectQuestionPacks(rawInput, parsedIntent) : []
    let phase: ClarificationPhase = 'ready'
    let cards: ClarificationCard[] = []

    if (unansweredCore.length > 0) {
      phase = 'core'
      cards = unansweredCore.map((field) =>
        this.buildCard(
          field,
          'critical',
          'core',
          null,
          [],
          parsedSuggestions[field]?.value ?? null,
        ),
      )
    } else {
      const fieldToPack = new Map<ClarificationField, SelectedQuestionPack>()
      for (const pack of selectedPacks) {
        for (const field of pack.fields) {
          if (!fieldToPack.has(field)) fieldToPack.set(field, pack)
        }
      }
      const conditionalFields = [...fieldToPack.keys()]
        .filter((field) => isRelevantField(field, parsedIntent))
        .filter((field) => resolvedFields[field] === undefined && answers[field] === undefined)
      if (conditionalFields.length > 0) {
        phase = 'conditional'
        cards = conditionalFields.map((field) => {
          const pack = fieldToPack.get(field)!
          return this.buildCard(
            field,
            categoryFor(field, parsedIntent, rawInput),
            'conditional',
            pack.id,
            [pack.evidence],
            parsedSuggestions[field]?.value ?? null,
          )
        })
      }
    }

    cards.sort((left, right) => {
      if (phase === 'core') {
        return (
          CORE_CLARIFICATION_FIELDS.indexOf(
            left.field as (typeof CORE_CLARIFICATION_FIELDS)[number],
          ) -
          CORE_CLARIFICATION_FIELDS.indexOf(
            right.field as (typeof CORE_CLARIFICATION_FIELDS)[number],
          )
        )
      }
      return (
        CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category] ||
        right.impactScope.length - left.impactScope.length ||
        left.confidence - right.confidence ||
        left.field.localeCompare(right.field)
      )
    })

    const packRequiredIds = Object.fromEntries(
      selectedPacks.map((pack) => [
        pack.id,
        cards.filter((card) => card.packId === pack.id).map((card) => card.cardId),
      ]),
    )
    const coverage = this.planChecker.check({
      cards,
      requiredIds: cards.map((card) => card.cardId),
      answeredFields: Object.keys(answers) as ClarificationField[],
      selectedPackIds: selectedPacks.map((pack) => pack.id),
      packRequiredIds,
    })
    if (!coverage.valid) {
      throw new ValidationException(`澄清问题计划校验失败：${coverage.reasonCodes.join(',')}`)
    }

    const unresolvedCriticalFields = cards
      .filter((card) => card.category === 'critical')
      .map((card) => card.field)
    const confirmedContext: ConfirmedProjectContext = {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      rawInput,
      parsedIntent,
      resolvedFields,
      assumptions,
      unresolvedCriticalFields,
      unansweredOptionalFields,
    }

    return {
      parsedIntent,
      cards,
      confirmedContext,
      branch: cards.length > 0 ? 'clarify' : 'ready',
      summary: {
        critical: cards.filter((card) => card.category === 'critical').length,
        recommended: cards.filter((card) => card.category === 'recommended').length,
        optional: cards.filter((card) => card.category === 'optional').length,
      },
      phase,
      activeCard: cards[0] ?? null,
      remainingCount: cards.length,
      completedCount: Object.keys(answers).length,
      totalCount: Object.keys(answers).length + cards.length,
      questionPlanRevision: createHash('sha256')
        .update(
          JSON.stringify({
            schemaVersion: AI_INTENT_SCHEMA_VERSION,
            rawInputHash: createHash('sha256').update(rawInput).digest('hex'),
            phase,
            answeredFields: Object.keys(answers).sort(),
            cardIds: cards.map((card) => card.cardId),
            selectedPackIds: selectedPacks.map((pack) => pack.id),
          }),
        )
        .digest('hex')
        .slice(0, 24),
      coverage,
    }
  }

  private buildCard(
    field: ClarificationField,
    category: ClarificationCategory,
    source: 'core' | 'conditional',
    packId: string | null,
    triggerEvidence: string[],
    suggestedValue: ClarificationValue,
  ): ClarificationCard {
    const definition = CARD_CATALOG[field]
    return {
      ...definition,
      cardId: makeCardId(field, category),
      category,
      confidence: definition.defaultConfidence,
      reasoning: definition.defaultReasoning,
      allowSkip: category !== 'critical',
      isRequired: category === 'critical',
      customInput: customInputFor(definition.questionType, field),
      phase: source,
      source,
      packId,
      triggerEvidence,
      suggestedValue,
    }
  }

  private applyAnswer(
    field: ClarificationField,
    answer: ClarificationAnswer,
    category: ClarificationCategory,
    resolvedFields: ResolvedFields,
    assumptions: Assumptions,
    unansweredOptionalFields: ClarificationField[],
  ): void {
    const definition = CARD_CATALOG[field]
    if (answer.action === 'answer') {
      if (!isNonNullValue(answer.value)) {
        throw new ValidationException(`${field} 的自定义回答不能为空`)
      }
      resolvedFields[field] = marked(answer.value, 'explicit', '来自用户澄清回答。', 1)
      return
    }

    if (category === 'critical') {
      throw new ValidationException(`关键问题 ${field} 必须由用户明确回答`)
    }

    if (answer.action === 'default' || category === 'recommended') {
      if (!definition.defaultValue) {
        throw new ValidationException(`${field} 没有可采用的安全默认值`)
      }
      const defaultValue = definition.defaultValue
      const resolved = {
        value: defaultValue.value,
        marker: { ...defaultValue.marker },
      }
      resolvedFields[field] = resolved
      assumptions[field] = resolved
      return
    }

    unansweredOptionalFields.push(field)
  }
}
