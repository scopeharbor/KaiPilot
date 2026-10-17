/**
 * 项目理解层（2026-09-27）：拆解之前先把「项目要解决什么、成功长什么样、要建设哪些能力」讲清楚。
 *
 * 流程：起草 → 自我审查修订（第二次调用，按清单挑错并输出修订版）。两次调用都是全新对话，
 * 只注入项目主干记忆（用户原话、已确认问答、起止、团队），不带任何生成产物。
 * 产物在就绪页给用户确认 / 编辑；确认后作为后续每次模型调用的主干记忆，
 * 能力地图直接决定 WBS 一级分支。
 */

import type { ConfirmedProjectContext, ProjectPlanUnderstanding } from '@aiproj/types'
import type { PromptSet } from '../ai_m0/prompts.ts'
import { tryParseJson } from '../ai_m0/recovery.ts'
import { buildSpine } from './draft_memory.ts'

type JsonObject = Record<string, unknown>

export type UnderstandingCall = (args: {
  prompt: PromptSet
  promptName: 'draft.understanding' | 'draft.understanding.review'
  sentence: string
}) => Promise<string>

const UNDERSTANDING_SHAPE = `输出一个 JSON 对象（不要 Markdown），字段：
{
  "problemStatement": "要解决的问题：谁、在什么场景、遇到什么具体困难、造成什么后果（80–200 字）",
  "successPicture": "项目结束时可观察、可验证的成功画面，包含已确认的量化指标（80–200 字）",
  "currentState": "现状：已有什么系统/流程/资源，缺什么（50–150 字；不知道的写『未知，需确认』）",
  "stakeholders": ["干系人（角色或部门，不写人名）"],
  "businessFlows": [{"id":"flow-1","name":"端到端业务流程名","steps":["步骤1","步骤2","…（3–8 步）"]}],
  "capabilities": [{"id":"cap-1","name":"要建设/交付的能力（名词短语）","purpose":"这项能力解决问题的哪一部分","deliverables":["可验收的交付物"],"dependsOn":["cap-x"]}],
  "constraints": ["硬约束：日期、预算、合规、技术栈、人员等"],
  "assumptions": [{"id":"as-1","statement":"为继续规划而做的假设","impact":"假设不成立时影响什么"}],
  "openQuestions": ["确实影响计划、但目前无法从信息中得出的问题"],
  "suggestedTeam": [{"role":"常见岗位名（如 后端开发、测试）","headcount":2,"reason":"为什么需要这么多人"}]
}
suggestedTeam 只在 spine 没有 teamRoster（用户没给团队或选择「先按角色估算」）时给出；按范围与工期估算，能在工期内完成且不过度配置；
有 teamRoster 时输出空数组。`

const DRAFT_RULES = `【要求】
1. 只根据 spine 中的用户原话、已确认问答与事实推理；不得编造用户没说过的量化指标、系统名、人名。
2. capabilities 是后续 WBS 的一级分支：按「业务能力 / 交付对象」划分，互不重叠、合起来覆盖用户要的全部成果（MECE）；
   一般 4–10 项；项目管理、质量保障、上线切换等横向工作也各列为一项能力；dependsOn 只写真实前置。
3. 每项能力的 deliverables 必须是可以验收的具体产物（文档、系统功能、完成的活动记录），不写「完成 XX」这种空话。
4. 凡是用户没确认、但计划必须依赖的信息，写成 assumptions（并写影响）；真正无法假设的写 openQuestions（最多 5 条）。
5. 全部用简体中文。团队成员一律用 spine 中的代号或角色，不写人名。`

const REVIEW_CHECKLIST = `【审查清单】逐项检查草稿，发现问题直接改正：
- problemStatement 是否具体到「谁 / 什么场景 / 什么困难 / 什么后果」，而不是复述项目名？
- successPicture 是否可观察、可验证，且包含 spine 中全部已确认的量化指标？是否出现了用户没给出的数字（有则删除或改为假设）？
- capabilities 是否 MECE：有无重叠、有无遗漏用户原话里提到的成果、有无把阶段（如「测试」）和能力混在一起却缺了对应能力的交付？
- 每项能力是否都有可验收的 deliverables？dependsOn 是否只引用存在的能力 id，且没有循环？
- businessFlows 是否是端到端的真实业务路径（从触发到结果），而不是项目阶段？
- 计划依赖却未确认的信息是否都进了 assumptions？openQuestions 是否都是真正影响计划的问题？
输出修订后的完整 JSON（结构同草稿），不要输出审查意见本身。`

const MERGE_RULE =
  '【两份草稿】draftA、draftB 是独立起草的两份理解：逐项比较，问题陈述取更具体的、能力地图取覆盖更全且不重叠的、假设与开放问题合并去重，输出一份最佳版本。'

function systemPrompt(step: string): string {
  return [
    `你是资深项目经理兼业务分析师，正在为一个新项目做「项目理解」（${step}）。`,
    '这份理解会交给用户确认，随后作为整个项目拆解的依据，所以宁可写明假设，也不要编造。',
    '仅返回 JSON。',
    UNDERSTANDING_SHAPE,
    DRAFT_RULES,
  ].join('\n')
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = 600): string {
  // 理解内容直接展示给用户：模型偶尔引用输入结构名（「spine 中……」），换成用户能懂的说法。
  return typeof value === 'string'
    ? value
        .replace(/\bspine\b/giu, '已确认信息')
        .trim()
        .slice(0, max)
    : ''
}

function strList(value: unknown, max = 200, limit = 20): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => str(item, max))
    .filter(Boolean)
    .slice(0, limit)
}

/** 宽松归一 + 最低完整性校验（问题陈述与至少 1 项能力）；不合格返回 null。 */
export function normalizePlanUnderstanding(
  raw: unknown,
  confirmedByUser = false,
): ProjectPlanUnderstanding | null {
  if (!isObject(raw)) return null
  const capabilities = (Array.isArray(raw.capabilities) ? raw.capabilities : [])
    .filter(isObject)
    .slice(0, 16)
    .map((item, index) => ({
      id: str(item.id, 20) || `cap-${index + 1}`,
      name: str(item.name, 60),
      purpose: str(item.purpose, 300),
      deliverables: strList(item.deliverables, 160, 12),
      dependsOn: strList(item.dependsOn, 20, 10),
    }))
    .filter((item) => item.name)
  const ids = new Set(capabilities.map((item) => item.id))
  for (const item of capabilities) {
    item.dependsOn = item.dependsOn.filter((id) => ids.has(id) && id !== item.id)
  }
  const understanding: ProjectPlanUnderstanding = {
    version: '1.0',
    problemStatement: str(raw.problemStatement, 800),
    successPicture: str(raw.successPicture, 800),
    currentState: str(raw.currentState, 600),
    stakeholders: strList(raw.stakeholders, 60, 12),
    businessFlows: (Array.isArray(raw.businessFlows) ? raw.businessFlows : [])
      .filter(isObject)
      .slice(0, 8)
      .map((flow, index) => ({
        id: str(flow.id, 20) || `flow-${index + 1}`,
        name: str(flow.name, 60),
        steps: strList(flow.steps, 120, 10),
      }))
      .filter((flow) => flow.name && flow.steps.length > 0),
    capabilities,
    constraints: strList(raw.constraints, 200, 12),
    assumptions: (Array.isArray(raw.assumptions) ? raw.assumptions : [])
      .filter(isObject)
      .slice(0, 12)
      .map((item, index) => ({
        id: str(item.id, 20) || `as-${index + 1}`,
        statement: str(item.statement, 300),
        impact: str(item.impact, 300),
      }))
      .filter((item) => item.statement),
    openQuestions: strList(raw.openQuestions, 200, 5),
    confirmedByUser,
  }
  const answered = (Array.isArray(raw.answeredQuestions) ? raw.answeredQuestions : [])
    .filter(isObject)
    .slice(0, 10)
    .map((item) => ({ question: str(item.question, 200), answer: str(item.answer, 600) }))
    .filter((item) => item.question && item.answer)
  if (answered.length > 0) understanding.answeredQuestions = answered
  const team = (Array.isArray(raw.suggestedTeam) ? raw.suggestedTeam : [])
    .filter(isObject)
    .slice(0, 12)
    .map((item) => ({
      role: str(item.role, 20),
      headcount: Math.max(1, Math.min(20, Math.round(Number(item.headcount) || 1))),
      reason: str(item.reason, 120),
    }))
    .filter((item) => item.role)
  if (team.length > 0) understanding.suggestedTeam = team
  if (!understanding.problemStatement || understanding.capabilities.length === 0) return null
  return understanding
}

function parse(raw: string): ProjectPlanUnderstanding | null {
  const parsed = tryParseJson(raw)
  return parsed.ok ? normalizePlanUnderstanding(parsed.value) : null
}

/**
 * 起草 + 自我审查修订。起草最多重试 2 次；审查失败时退回起草版（审查只能让结果更好，不能让流程失败）。
 */
export async function generatePlanUnderstanding(args: {
  context: ConfirmedProjectContext
  call: UnderstandingCall
  now?: Date
  /** 独立起草的候选份数（默认 2），审查时合成。 */
  candidates?: number
}): Promise<ProjectPlanUnderstanding> {
  const spine = buildSpine({
    context: { ...args.context, planUnderstanding: undefined },
    aggregate: {},
    now: args.now,
    includeUserRequest: true,
  })
  // 多候选：两份独立起草并行（各自最多重试 2 次），审查时取长补短合成一份。
  const draftOnce = async (_: unknown, index: number): Promise<ProjectPlanUnderstanding | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const parsed = parse(
          await args.call({
            promptName: 'draft.understanding',
            // 候选并行起草：步骤名带上编号，实时输出面板里才分得清是哪一份。
            sentence: `起草项目理解（候选 ${String.fromCharCode(65 + index)}）`,
            prompt: { systemPrompt: systemPrompt('起草'), userPrompt: JSON.stringify({ spine }) },
          }),
        )
        if (parsed) return parsed
      } catch {
        // 本次调用失败：继续重试。
      }
    }
    return null
  }
  const settled = await Promise.all(
    Array.from({ length: Math.max(1, args.candidates ?? 2) }, draftOnce),
  )
  const drafts = settled.filter((item): item is ProjectPlanUnderstanding => item !== null)
  if (drafts.length === 0) throw new Error('PLAN_UNDERSTANDING_INVALID')

  try {
    const reviewed = await args.call({
      promptName: 'draft.understanding.review',
      sentence: '审查并修订项目理解',
      prompt: {
        systemPrompt: [
          systemPrompt('自我审查与修订'),
          REVIEW_CHECKLIST,
          drafts.length > 1 ? MERGE_RULE : '',
        ].join('\n'),
        userPrompt: JSON.stringify(
          drafts.length > 1
            ? { spine, draftA: drafts[0], draftB: drafts[1] }
            : { spine, draft: drafts[0] },
        ),
      },
    })
    return parse(reviewed) ?? drafts[0]!
  } catch {
    return drafts[0]!
  }
}
