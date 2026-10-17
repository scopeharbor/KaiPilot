/**
 * @aiproj/types — V3 Copilot 澄清与假设 fixtures（六态，全部离线确定性，零网络零 provider）
 * v3-copilot-clarification-and-assumptions —— 任务 2.12。
 *
 * 六态：critical 阻断 / recommended 用默认 / optional 跳过 / 到达轮数上界 /
 * 权限缺失致缺口 / 多轮部分回答。
 */
import {
  makeClarificationAssumption,
  type ClarificationAssumptionRecord,
  type ClarificationDefaultValue,
  type ClarificationSlotState,
  type ClarificationTier,
  type RegisteredClarificationField,
} from './copilot-clarification.js'
import type { CopilotAssumptionEntry } from './copilot-shared-contracts.js'

// ── 基础素材：注册字段目录（destination = 'project-intake'，既有 13 字段的三档代表形态）──

export const CLARIFICATION_FIXTURE_CATALOG_VERSION = 'copilot-clarification-fixtures-v1'

function field(input: {
  fieldId: string
  tier: ClarificationTier
  title: string
  description: string
  domains: readonly { domain: string; severity: 'high' | 'medium' | 'low' }[]
  questionType: 'text' | 'single_choice' | 'multi_choice' | 'number' | 'date'
  quickOptions?: readonly { label: string; value: string | number; recommended?: boolean }[]
  defaultValue?: ClarificationDefaultValue
}): RegisteredClarificationField {
  return {
    fieldId: input.fieldId,
    destination: 'project-intake',
    tier: input.tier,
    title: input.title,
    description: input.description,
    impactScope: input.domains.map((d) => ({ domain: d.domain, severity: d.severity })),
    questionType: input.questionType,
    quickOptions: input.quickOptions ?? [],
    ...(input.defaultValue ? { defaultValue: input.defaultValue } : {}),
  }
}

export const CLARIFICATION_FIXTURE_FIELDS: readonly RegisteredClarificationField[] = [
  field({
    fieldId: 'projectGoal',
    tier: 'critical',
    title: '这个项目最重要的目标是什么？',
    description: '目标决定项目范围、成功标准与任务优先级。',
    domains: [
      { domain: '项目范围', severity: 'high' },
      { domain: '成功标准', severity: 'high' },
    ],
    questionType: 'text',
  }),
  field({
    fieldId: 'startDate',
    tier: 'critical',
    title: '项目计划从哪一天开始？',
    description: '已有工期或截止约束时，开始日期是排程的必要锚点。',
    domains: [
      { domain: '排期', severity: 'high' },
      { domain: '里程碑', severity: 'high' },
    ],
    questionType: 'date',
  }),
  field({
    fieldId: 'teamSize',
    tier: 'recommended',
    title: '预计有多少人参与项目？',
    description: '团队规模会影响任务并行度和工期可行性。',
    domains: [
      { domain: '工期可行性', severity: 'high' },
      { domain: '任务分配', severity: 'high' },
      { domain: '沟通成本', severity: 'medium' },
    ],
    questionType: 'single_choice',
    quickOptions: [
      { label: '1–2 人', value: 2 },
      { label: '3–5 人', value: 4, recommended: true },
      { label: '6–10 人', value: 8 },
      { label: '10 人以上', value: 12 },
    ],
    defaultValue: {
      value: 4,
      sourceStrength: 'catalog_median',
      reason: '按常见中小型项目团队取 3–5 人中位值。',
    },
  }),
  field({
    fieldId: 'techStack',
    tier: 'recommended',
    title: '技术栈有既定要求吗？',
    description: '技术约束会影响任务拆分、人员技能与交付风险。',
    domains: [
      { domain: '技术方案', severity: 'medium' },
      { domain: '人员技能', severity: 'medium' },
    ],
    questionType: 'text',
    defaultValue: {
      value: '由团队按现有能力选择',
      sourceStrength: 'project_history',
      reason: '未提供强制技术约束，保留团队选择空间。',
    },
  }),
  field({
    fieldId: 'integration',
    tier: 'optional',
    title: '需要与哪些现有系统集成？',
    description: '集成要求会增加接口、联调和验收工作。',
    domains: [{ domain: '系统边界', severity: 'low' }],
    questionType: 'text',
  }),
  field({
    fieldId: 'designPreference',
    tier: 'optional',
    title: '有偏好的视觉或交互风格吗？',
    description: '设计偏好会影响原型方向，但不阻塞项目计划。',
    domains: [{ domain: '设计方向', severity: 'low' }],
    questionType: 'text',
  }),
]

// ── 六态素材 ──

/** 态 1：critical 阻断——startDate（critical）未补齐，不得产出变更动作。 */
export const CLARIFICATION_FIXTURE_CRITICAL_GAP: readonly ClarificationSlotState[] = [
  { fieldId: 'projectGoal', state: 'answered' },
  { fieldId: 'startDate', state: 'asked_pending' },
  { fieldId: 'teamSize', state: 'filled_with_default' },
  { fieldId: 'techStack', state: 'filled_with_default' },
  { fieldId: 'integration', state: 'skipped' },
  { fieldId: 'designPreference', state: 'skipped' },
]

/** 态 2：recommended 用默认——critical 已补齐，recommended 走默认值路径。 */
export const CLARIFICATION_FIXTURE_RECOMMENDED_DEFAULT: readonly ClarificationSlotState[] = [
  { fieldId: 'projectGoal', state: 'answered' },
  { fieldId: 'startDate', state: 'answered' },
  { fieldId: 'teamSize', state: 'filled_with_default' },
  { fieldId: 'techStack', state: 'filled_with_default' },
  { fieldId: 'integration', state: 'skipped' },
  { fieldId: 'designPreference', state: 'skipped' },
]

/** 态 3：optional 跳过——optional 槽位跳过且不产生假设条目。 */
export const CLARIFICATION_FIXTURE_OPTIONAL_SKIPPED: readonly ClarificationSlotState[] = [
  { fieldId: 'projectGoal', state: 'answered' },
  { fieldId: 'startDate', state: 'answered' },
  { fieldId: 'teamSize', state: 'answered' },
  { fieldId: 'techStack', state: 'answered' },
  { fieldId: 'integration', state: 'skipped' },
  { fieldId: 'designPreference', state: 'skipped' },
]

/** 态 4：到达轮数上界——roundsElapsed = 3 = 上界，必须给两条出路。 */
export const CLARIFICATION_FIXTURE_ROUND_BOUND = {
  roundsElapsed: 3,
  maxRounds: 3,
} as const

/** 态 5：权限缺失致缺口——blocked 槽位（actor 不可访问，文案只能通用能力受限）。 */
export const CLARIFICATION_FIXTURE_PERMISSION_GAP: readonly ClarificationSlotState[] = [
  { fieldId: 'projectGoal', state: 'answered' },
  { fieldId: 'startDate', state: 'answered' },
  { fieldId: 'teamSize', state: 'blocked' },
  { fieldId: 'techStack', state: 'blocked' },
  { fieldId: 'integration', state: 'skipped' },
  { fieldId: 'designPreference', state: 'skipped' },
]

/** 态 6：多轮部分回答——部分槽位已答，跨轮保持，不重复询问已答项。 */
export const CLARIFICATION_FIXTURE_PARTIAL_ANSWERS: readonly ClarificationSlotState[] = [
  { fieldId: 'projectGoal', state: 'answered' },
  { fieldId: 'startDate', state: 'asked_pending' },
  { fieldId: 'teamSize', state: 'answered' },
  { fieldId: 'techStack', state: 'filled_with_default' },
  { fieldId: 'integration', state: 'unasked' },
  { fieldId: 'designPreference', state: 'unasked' },
]

// ── 假设条目素材（经构造器派生，稳定 ID）──

export const CLARIFICATION_FIXTURE_ASSUMPTION_RECORDS: readonly ClarificationAssumptionRecord[] = [
  makeClarificationAssumption({
    fieldId: 'teamSize',
    statement: '未明确团队规模，使用默认值 3–5 人（中位数 4 人）。',
    sourceStrength: 'catalog_median',
    substitutionReason: '按常见中小型项目团队取 3–5 人中位值。',
  }),
  makeClarificationAssumption({
    fieldId: 'techStack',
    statement: '未明确技术栈，保留团队按现有能力选择的默认。',
    sourceStrength: 'project_history',
    substitutionReason: '未提供强制技术约束，保留团队选择空间。',
  }),
]

export const CLARIFICATION_FIXTURE_ASSUMPTION_ENTRIES: readonly CopilotAssumptionEntry[] =
  CLARIFICATION_FIXTURE_ASSUMPTION_RECORDS.map((record) => record.entry)

// ── 确定性输入元组素材 ──

export const CLARIFICATION_FIXTURE_DETERMINISM_INPUT_A = {
  normalizedInput: '帮我拆一下首页设计任务',
  slotStates: {
    projectGoal: 'answered',
    startDate: 'answered',
    teamSize: 'filled_with_default',
    techStack: 'filled_with_default',
    integration: 'skipped',
    designPreference: 'skipped',
  },
  sourceHash: 'a1b2c3d4',
  catalogVersion: CLARIFICATION_FIXTURE_CATALOG_VERSION,
} as const

/** 键序与 A 不同但内容等价（确定性 hash 在键序变化下不变）。 */
export const CLARIFICATION_FIXTURE_DETERMINISM_INPUT_B = {
  catalogVersion: CLARIFICATION_FIXTURE_CATALOG_VERSION,
  sourceHash: 'a1b2c3d4',
  slotStates: {
    designPreference: 'skipped',
    integration: 'skipped',
    techStack: 'filled_with_default',
    teamSize: 'filled_with_default',
    startDate: 'answered',
    projectGoal: 'answered',
  },
  normalizedInput: '帮我拆一下首页设计任务',
} as const
