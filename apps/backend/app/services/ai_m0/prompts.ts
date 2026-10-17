/**
 * ai-structured-output-poc / M0 —— 三策略提示语（P/N/T）。
 *
 * spec 硬约束「三种约束策略对照实验」：
 *   - P `prompt`：仅提示要求 JSON，不用任何 native 约束（对照基线）；
 *   - N `native`：使用 Provider 的 response_format=json_schema，SDK 侧强约束；
 *   - T `tool`：使用 function/tool calling，强 tool_choice。
 *
 * 三种策略共享 system prompt（术语、AIMarker 契约、必填字段清单），
 * 只在 user prompt 的「输出要求」段落分叉。这样后续换 Provider 时，
 * 仅需在 Adapter 层替换 API 形态，Prompt 主体不用重写（spec「Provider 切换只换 Adapter」）。
 */

import type { AiM0Strategy } from '@aiproj/types'

export interface PromptSet {
  systemPrompt: string
  userPrompt: string
}

const SYSTEM_PROMPT = `你是「开项 OpenXiang」的项目规划助手。收到一句话简体中文项目描述后，请生成一份完整草案，包含 4 大块：
1) charter（项目章程）：title / vision / scope / successCriteria(数组) / startDate / endDate；
2) wbs（工作分解结构）：至少 1 个顶层节点，节点带 outlineCode 与递归 children；
3) tasks（任务）：至少 1 条，与 wbs 叶子节点关联；
4) acceptanceCriteria（验收标准）：至少 1 条。

【AIMarker 契约】所有推断字段必须挂上 marker：{ confidence: 0..1, source: "inferred"|"explicit"|"default", reason: 简体中文一句话解释, needsConfirmation: 高风险时=true }。
【高风险字段强制 needsConfirmation=true】：durationDays、startDate、endDate、依赖 lagDays。
【状态取值仅限】：not_started / in_progress / completed / blocked / on_hold / cancelled。
【依赖类型仅限】：FS / SS / FF / SF。
【输出语言】所有 name / description / reason 用简体中文。
【禁止】不要输出解释、不要写「以下是...」、不要用 markdown 代码块，直接给结构化数据。`

/**
 * 三种策略的 user prompt。
 * - 策略 P 直接要求「输出严格 JSON，不允许任何前后缀」；
 * - 策略 N 说明「响应会被 json_schema 约束」，无需自己写结构描述；
 * - 策略 T 说明「结果通过工具调用返回」，只提醒必填字段与 AIMarker。
 */
export function buildStrategyPrompt(input: {
  sentence: string
  strategy: AiM0Strategy
}): PromptSet {
  const { sentence, strategy } = input
  const base = `【项目一句话】${sentence.trim()}`
  let tail = ''
  if (strategy === 'prompt') {
    tail = `\n\n【输出要求】仅输出符合上述结构的严格 JSON 对象，不要写多余文本；未知字段不要遗漏，用 default source 兜底但仍需 AIMarker。`
  } else if (strategy === 'native') {
    tail = `\n\n【输出要求】按 response_format=json_schema 约束返回；每个 marker 都不能缺，缺失会导致校验失败。`
  } else {
    tail = `\n\n【输出要求】通过 submit_ai_project_draft 工具返回；arguments 就是完整草案 JSON；缺任何 marker 都判失败。`
  }
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: base + tail,
  }
}
