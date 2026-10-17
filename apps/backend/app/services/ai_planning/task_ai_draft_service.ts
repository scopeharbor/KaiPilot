/**
 * 看板「在此列新建任务」的 AI 补全（2026-09-28）。
 *
 * 用户在列里用一句话描述要做的事，模型结合项目背景（周期、WBS 工作包、团队角色、已有任务）
 * 补成一张可执行的任务卡：名称、说明、工期、优先级、所属工作包、负责角色、完成标准、执行步骤。
 * 任务要小（0.5–2 个工作日）；描述的事超过这个量时给出拆分建议（每项半天到一天）。
 *
 * 只产出草稿，不落库（AI 只建议、不自动执行）：用户在卡片上核对、修改后点「确认创建」才建任务。
 */
import type { TaskPriority } from '#services/task_status_machine'
import { todayAnchor } from '#services/ai_intent/core_information_needs'
import { formatIsoDate } from '#services/gantt_working_calendar'
import { generateWithPlanningTools, type TextGateway } from './planning_toolbox.js'

export interface TaskAiDraftContext {
  description: string
  projectName: string
  projectStart: string | null
  projectEnd: string | null
  /** 可归属的 WBS 工作包（非任务节点）。 */
  workPackages: Array<{ id: number; code: string | null; name: string }>
  /** 本项目任务里出现过的负责角色。 */
  roles: string[]
  /** 已有任务名（避免重复）。 */
  existingTaskNames: string[]
}

export interface TaskAiDraftSplitItem {
  name: string
  durationDays: number
  doneCriteria: string[]
  steps: string[]
}

export interface TaskAiDraft {
  name: string
  description: string
  /** 工作日；0.5 表示半天。 */
  durationDays: number
  priority: TaskPriority
  wbsNodeId: number | null
  roleHint: string | null
  doneCriteria: string[]
  steps: string[]
  /** 描述的事太大时的拆分建议（为空表示一张卡就够）。 */
  split: TaskAiDraftSplitItem[]
  /** 模型对用户的简短说明（如「这件事超过 2 天，建议拆成 3 张卡」）。 */
  note: string | null
}

const PRIORITIES: readonly TaskPriority[] = ['lowest', 'low', 'medium', 'high', 'highest']

const SYSTEM = [
  '你在帮项目成员把一句话变成一张可以直接开工的任务卡。用简体中文，只输出 JSON，不要多余文字。',
  '格式：{"name":"…","description":"…","durationDays":1,"priority":"medium","wbsNodeId":null,"roleHint":null,',
  '"doneCriteria":["…"],"steps":["…"],"split":[],"note":null}',
  '规则：',
  '- name：「动词 + 对象 + 结果」，40 字以内，看名字就知道要做什么、做完交出什么；',
  '- 任务要小：durationDays 取 0.5、1、1.5 或 2（工作日）。一个人半天到两天做得完；',
  '- 如果描述的事超过 2 天：name / steps 写第一张卡，同时在 split 里给出拆分后的全部小卡（2–8 张，每张 0.5–1 天，',
  '  各带 2–4 个步骤和 1–3 条可检验的完成标准（doneCriteria），顺序即先后，第一张就是 name 那张，不要放占位卡），',
  '  并在 note 里用一句话说明为什么拆；不超过 2 天时 split 为空数组；',
  '- steps：3–6 步，每步是一个能打勾的具体动作（半天内做得完），按先后排；',
  '- doneCriteria：2–4 条可检验的完成标准（能拿数字、文件或演示来验收）；',
  '- description：两三句话说明为什么做、做什么、交付什么；',
  '- priority：lowest / low / medium / high / highest；没有明显紧急程度就用 medium；',
  '- wbsNodeId：只能从给定工作包里选最相关的 id，都不相关就填 null；',
  '- roleHint：只能从给定角色里选负责角色，没有合适的填 null；',
  '- 不要编造项目里没有提到的系统、人员或日期；和已有任务重复时在 note 里提醒。',
  '- 如果给了 previous（上一版草稿）和 instruction（用户的修改意见）：在 previous 基础上按意见改，',
  '  只改用户提到的地方，其余保持不变；用户要求拆细 / 合并时相应调整 split；note 里一句话说明改了什么。',
].join('\n')

function strings(value: unknown, max: number, len = 120): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, len))
    .slice(0, max)
}

function halfDays(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, Math.round(n * 2) / 2))
}

/** 把模型输出规整成可用的草稿；缺的字段用保守默认值补。 */
export function normalizeTaskAiDraft(raw: unknown, context: TaskAiDraftContext): TaskAiDraft {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const packageIds = new Set(context.workPackages.map((item) => item.id))
  const wbsNodeId = Number(record.wbsNodeId)
  const roleHint = typeof record.roleHint === 'string' ? record.roleHint.trim() : ''
  const split = (Array.isArray(record.split) ? record.split : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: String(item.name ?? '')
        .trim()
        .slice(0, 60),
      durationDays: halfDays(item.durationDays, 1, 0.5, 2),
      doneCriteria: strings(item.doneCriteria, 3),
      steps: strings(item.steps, 6),
    }))
    // 丢掉模型凑数的占位卡（实测出现「（占位）无」）
    .filter((item) => item.name && !/占位|^[（(]?无[）)]?$|^无$/u.test(item.name))
    .slice(0, 8)
  const name =
    String(record.name ?? '')
      .trim()
      .slice(0, 60) || context.description.slice(0, 40)
  const durationDays = halfDays(record.durationDays, 1, 0.5, 2)
  const steps = strings(record.steps, 6)
  const doneCriteria = strings(record.doneCriteria, 4)
  // 「拆成 N 张卡」只建 split 里的卡：模型有时把第一张（主卡）单列、不放进 split（实测），补到最前面
  if (split.length >= 2 && !split.some((item) => item.name === name)) {
    split.unshift({ name, durationDays: Math.min(durationDays, 1), doneCriteria, steps })
  }
  return {
    name,
    description: String(record.description ?? '')
      .trim()
      .slice(0, 1_000),
    durationDays,
    priority: PRIORITIES.includes(record.priority as TaskPriority)
      ? (record.priority as TaskPriority)
      : 'medium',
    wbsNodeId: packageIds.has(wbsNodeId) ? wbsNodeId : null,
    roleHint: roleHint && context.roles.includes(roleHint) ? roleHint : null,
    doneCriteria,
    steps,
    split: split.length >= 2 ? split : [],
    note:
      typeof record.note === 'string' && record.note.trim()
        ? record.note.trim().slice(0, 300)
        : null,
  }
}

export async function draftTaskWithAi(args: {
  gateway: TextGateway
  context: TaskAiDraftContext
  /** 互动调整：上一版草稿 + 用户的修改意见（2026-09-29）。 */
  refine?: { previous: unknown; instruction: string } | null
  now: Date
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
}): Promise<TaskAiDraft> {
  const { context } = args
  const userPrompt = JSON.stringify({
    today: formatIsoDate(todayAnchor(args.now)),
    request: context.description.slice(0, 2_000),
    project: {
      name: context.projectName,
      start: context.projectStart,
      end: context.projectEnd,
    },
    workPackages: context.workPackages
      .slice(0, 80)
      .map((item) => ({ id: item.id, code: item.code, name: item.name })),
    roles: context.roles.slice(0, 20),
    existingTasks: context.existingTaskNames.slice(0, 60),
    ...(args.refine
      ? { previous: args.refine.previous, instruction: args.refine.instruction.slice(0, 500) }
      : {}),
  })
  const result = await generateWithPlanningTools({
    gateway: args.gateway,
    systemPrompt: SYSTEM,
    userPrompt,
    sentence: '补全任务卡',
    promptName: 'task.ai_draft',
    now: args.now,
    maxRounds: 2,
    maxOutputTokens: 6_000,
    temperature: 0.3,
    ...(args.onText ? { onText: args.onText } : {}),
    ...(args.onReasoning ? { onReasoning: args.onReasoning } : {}),
  })
  if (!result.answer) throw new Error('模型没有给出可用的任务卡')
  return normalizeTaskAiDraft(result.answer, context)
}
