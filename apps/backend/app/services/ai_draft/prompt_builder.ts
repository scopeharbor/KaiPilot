/**
 * ai-draft-generation / T036 —— 生成输入构造器（design D2「分步模块化草案」前置）。
 *
 * 职责（tasks 2.1）：把版本化、branch=ready 的 `ConfirmedProjectContext`
 * 映射为「确定性蓝图 + 显式事实覆盖层」，并为真实模型路径构造分步生成提示语。
 *
 * 红线（spec「禁止覆盖显式事实」）：
 *   - `parsedIntent.projectName` / `objectives` 一旦存在，必须作为 explicit 事实进入草案，
 *     禁止用模型推断/默认值覆盖；
 *   - `resolvedFields`（用户显式回答的澄清项）优先级高于 `assumptions`（系统默认假设），
 *     二者都高于 `parsedIntent.timeline`（自然语言解析）与蓝图兜底日期。
 *
 * 本文件不做任何 DB 写入，也不实例化 Adapter；只做纯函数式的输入整形。
 */

import type {
  AiMarkerSource,
  ClarificationField,
  ClarificationValue,
  ConfirmedProjectContext,
  Marked,
  ProjectDraftStructuredStrategy,
  ProjectType,
} from '@aiproj/types'
import { DRAFT_BLUEPRINTS, type DraftBlueprint } from './fixtures.ts'
import type { PromptSet } from '../ai_m0/prompts.ts'
import { buildGroundingManifest } from './grounding_manifest.ts'
import {
  DRAFT_ID_CONVENTION_GUIDE,
  DRAFT_MARKER_CONTRACT_GUIDE,
  DRAFT_MODULE_GUIDE_ORDER,
  DRAFT_MODULE_STRUCTURE_GUIDES,
  DRAFT_TASK_STATUS_GUIDE,
} from './stage_schema_guide.ts'

/** 单个高影响事实的来源与是否需要人工确认（供服务层设置 charter marker）。 */
export interface DraftFactValue<T> {
  value: T
  source: AiMarkerSource
  needsConfirmation: boolean
}

/**
 * 显式事实覆盖层：仅承载「必须保留、不得被模型覆盖」的用户事实。
 * null 表示上下文未提供该事实，草案沿用蓝图兜底（保持 inferred marker）。
 */
export interface DraftFactOverlay {
  title: DraftFactValue<string> | null
  objectives: DraftFactValue<string[]> | null
  startDate: DraftFactValue<string> | null
}

/** 生成输入：确定性蓝图（已叠加显式事实的值）+ 覆盖层（供服务层设置正确 marker）。 */
export interface DraftGenerationInput {
  projectType: ProjectType
  blueprint: DraftBlueprint
  overlay: DraftFactOverlay
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function safePromptValue(value: unknown): string {
  return String(value ?? '')
    .replace(/(?:bearer\s+)?sk-[a-z0-9_-]{8,}|authorization\s*[:=]\s*[^\s]+/giu, '[REDACTED]')
    .slice(0, 600)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 把澄清值强制成 ISO date 字符串；非法/非日期返回 null。 */
function asDateString(value: ClarificationValue | undefined): string | null {
  if (typeof value === 'string' && ISO_DATE.test(value.trim())) return value.trim()
  return null
}

/** 读取一个澄清字段的 Marked 值（resolvedFields 优先于 assumptions）。 */
function readField(
  context: ConfirmedProjectContext,
  field: ClarificationField,
): { marked: Marked<Exclude<ClarificationValue, null>>; origin: 'resolved' | 'assumption' } | null {
  const resolved = context.resolvedFields[field]
  if (resolved) return { marked: resolved, origin: 'resolved' }
  const assumption = context.assumptions[field]
  if (assumption) return { marked: assumption, origin: 'assumption' }
  return null
}

export class ProjectDraftPromptBuilder {
  /**
   * 从确认上下文构造生成输入。显式事实优先级：
   *   projectName/objectives（NL 显式实体）→ explicit；
   *   startDate：resolvedFields（沿用其 marker.source）> assumptions（default）>
   *   parsedIntent.timeline（inferred）> 蓝图兜底（返回 null，保持 inferred）。
   */
  buildGenerationInput(context: ConfirmedProjectContext): DraftGenerationInput {
    const projectType = context.parsedIntent.projectType
    const blueprint = clone(DRAFT_BLUEPRINTS[projectType])

    // —— 标题：显式项目名优先 ——
    let title: DraftFactValue<string> | null = null
    const projectName = context.parsedIntent.projectName?.trim()
    if (projectName) {
      title = { value: projectName, source: 'explicit', needsConfirmation: false }
      blueprint.title = projectName
    }

    // —— 目标：显式目标优先 ——
    let objectives: DraftFactValue<string[]> | null = null
    if (context.parsedIntent.objectives.length > 0) {
      const list = context.parsedIntent.objectives.map((o) => o.trim()).filter(Boolean)
      if (list.length > 0) {
        objectives = { value: list, source: 'explicit', needsConfirmation: false }
        blueprint.objectives = list
      }
    }

    // —— 开始日期：resolved > assumption > timeline > 蓝图兜底 ——
    let startDate: DraftFactValue<string> | null = null
    const startField = readField(context, 'startDate')
    if (startField) {
      const iso = asDateString(startField.marked.value)
      if (iso) {
        const source = startField.marked.marker.source
        startDate = {
          value: iso,
          source,
          // 显式事实无需确认；默认/推断的日期是高影响字段，强制需确认。
          needsConfirmation: source === 'explicit' ? false : true,
        }
        blueprint.startDate = iso
      }
    }
    if (!startDate) {
      const timelineStart = asDateString(context.parsedIntent.timeline.startDate ?? undefined)
      if (timelineStart) {
        startDate = { value: timelineStart, source: 'inferred', needsConfirmation: true }
        blueprint.startDate = timelineStart
      }
    }

    return { projectType, blueprint, overlay: { title, objectives, startDate } }
  }

  /**
   * 为真实模型路径构造分步生成提示语（design D2）。
   * 系统提示覆盖 9 大模块与 AIMarker 契约；用户提示注入序列化上下文与「保留显式事实」硬约束。
   * 注意：V1 生产默认走确定性引擎，本提示语供注入式真实生成器（或后续接入的生产 Adapter）使用。
   */
  buildPromptSet(
    context: ConfirmedProjectContext,
    strategy: ProjectDraftStructuredStrategy,
  ): PromptSet {
    const systemPrompt = SYSTEM_PROMPT
    const explicitFacts = this.describeExplicitFacts(context)
    const adaptiveFacts = (context.adaptiveLedger?.entries ?? [])
      .filter((entry) => entry.status === 'answered')
      .slice(-30)
      .map((entry) => ({
        topic: safePromptValue(entry.topic),
        answer: safePromptValue(entry.answer),
      }))
    const knownUnknowns = (context.knownUnknowns ?? []).slice(-20).map((item) => ({
      topic: safePromptValue(item.topic),
      impact: safePromptValue(item.impact),
      owner: item.owner ? safePromptValue(item.owner) : null,
      targetDecisionDate: item.targetDecisionDate ?? null,
    }))
    const manifest = buildGroundingManifest(context)
    let tail = ''
    if (strategy === 'prompt') {
      tail =
        '\n\n【输出要求】仅输出符合上述 9 模块结构的严格 JSON 对象，不要写多余文本；每个推断字段都要带 AIMarker。'
    } else if (strategy === 'native') {
      tail = '\n\n【输出要求】按 response_format=json_schema 约束返回；缺任何 marker 都会校验失败。'
    } else {
      tail =
        '\n\n【输出要求】通过 submit_ai_project_draft 工具返回；arguments 即完整草案 JSON；缺任何 marker 判失败。'
    }
    const userPrompt =
      `【Grounding Manifest】${JSON.stringify({ version: manifest.version, projectType: manifest.projectType, facts: manifest.facts })}\n` +
      `【项目类型】${context.parsedIntent.projectType}\n` +
      `【必须保留的显式事实】${explicitFacts || '（无显式事实，全部字段为 AI 推断）'}\n` +
      `【自适应澄清已确认事实】${JSON.stringify(adaptiveFacts)}\n` +
      `【明确尚未决定事项】${JSON.stringify(knownUnknowns)}\n` +
      `【硬约束】上述显式事实与自适应澄清答案必须保留并标为 explicit，禁止用模型推断值覆盖。尚未决定事项必须转成明确的 assumption、decision-needed 或 risk（含影响/负责人/日期，如有），严禁虚构具体数值。` +
      tail
    return { systemPrompt, userPrompt }
  }

  /** 序列化显式事实清单（供提示语与调试；不含潜在 PII 的原始输入正文）。 */
  private describeExplicitFacts(context: ConfirmedProjectContext): string {
    const parts: string[] = []
    const name = context.parsedIntent.projectName?.trim()
    if (name) parts.push(`项目名称=${name}`)
    if (context.parsedIntent.objectives.length > 0) {
      parts.push(`目标=${context.parsedIntent.objectives.join('、')}`)
    }
    const start = readField(context, 'startDate')
    if (start && start.marked.marker.source === 'explicit') {
      const iso = asDateString(start.marked.value)
      if (iso) parts.push(`开始日期=${iso}`)
    }
    return parts.join('；')
  }
}

// 模块结构/契约文案与分阶段路径共用同一事实来源（stage_schema_guide.ts），改契约只改一处。
const SYSTEM_PROMPT = `你是「开项 OpenXiang」的项目规划助手。基于已确认的项目上下文，生成一份完整、结构化的项目草案，覆盖 9 大模块：
${DRAFT_MODULE_GUIDE_ORDER.map((key, index) => `${index + 1}) ${DRAFT_MODULE_STRUCTURE_GUIDES[key]}`).join('\n')}

${DRAFT_MARKER_CONTRACT_GUIDE}
${DRAFT_ID_CONVENTION_GUIDE}
${DRAFT_TASK_STATUS_GUIDE}
【禁止】不要输出解释、不要写「以下是...」、不要用 markdown 代码块，直接给结构化数据。`
