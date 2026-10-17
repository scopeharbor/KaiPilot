// 矛盾求解卡组共用文案与常量（v3-triz-contradiction-copilot W5 · tasks 5.3/5.4/5.5）。
//
// 三个恒定原则：
// 1. **诚实披露**：`ai` / `rule` 两条路径的徽标文案必须明确区分，规则匹配 MUST NOT 冒充模型推理；
// 2. **零术语门槛**：用户可见文案一律取知识包的现代管理语汇（`displayName`），不出现古典机械术语；
// 3. **可追溯**：来源章节标注（RL-10）与降级原因原因文案都有唯一来源，不散落在组件里。
import type { TrizInterventionTarget, TrizMappingPath } from '@/lib/api/triz-copilot'

// ---------------------------------------------------------------------------
// 结果路径徽标（RL-07 / spec「确定性回退与路径诚实披露」第 4 条）
// ---------------------------------------------------------------------------

export interface TrizPathBadgeCopy {
  /** 徽标短文案 */
  label: string
  /** 诚实披露副文案 */
  detail: string
}

export const TRIZ_PATH_BADGES: Readonly<Record<TrizMappingPath, TrizPathBadgeCopy>> = {
  ai: {
    label: '模型推理',
    detail: '本次映射由大模型结合项目上下文推理得出，结果仍需人工审查。',
  },
  rule: {
    label: '规则匹配',
    detail: '本次映射由确定性规则底座（知识包参数对匹配）得出，未调用任何模型。',
  },
}

// ---------------------------------------------------------------------------
// 确定性回退原因（后端 `fallbackReasons` 枚举 → 中文说明）
// ---------------------------------------------------------------------------

export const TRIZ_FALLBACK_REASON_LABELS: Readonly<Record<string, string>> = {
  MODEL_DISABLED: '真实模型未启用，已走确定性规则底座（零 Token）',
  NO_AI_TRIGGER: '当前账号无模型调用权限，已走确定性规则底座',
  BUDGET_EXHAUSTED: '本次分析的模型预算已用尽，已交出中间成果',
  MODEL_UNAVAILABLE: '模型服务暂不可用，已走确定性规则底座',
  MODEL_FAILED: '模型调用失败，已走确定性规则底座',
  MODEL_TIMEOUT: '模型调用超时，已走确定性规则底座',
  MODEL_OUTPUT_INVALID: '模型输出未通过结构校验，已回落规则底座',
}

export function trizFallbackReasonText(reason: string): string {
  return TRIZ_FALLBACK_REASON_LABELS[reason] ?? `已降级（${reason}）`
}

// ---------------------------------------------------------------------------
// 澄清快捷选项胶囊（D7：追问上限 2 轮 + 快捷选项降低多轮问答疲劳）
// ---------------------------------------------------------------------------

/**
 * 澄清追问的快捷选项：用大白话把常见取舍关系说清，点击即作为一条澄清回答提交。
 * 选项只表达「谁和谁对立」，不出现参数编号与 TRIZ 术语（spec 词汇条）。
 */
export const TRIZ_CLARIFICATION_OPTIONS: readonly string[] = [
  '我想改善进度，但质量会跟着变差',
  '我想提高质量，但工期会被拖长',
  '我想压缩成本，但范围会缩水',
  '我想加人赶工，但协调复杂度会上升',
]

// ---------------------------------------------------------------------------
// 落库目标（三类，spec「人工确认落库」第 4 条）
// ---------------------------------------------------------------------------

export const TRIZ_TARGET_CHOICES: ReadonlyArray<{
  target: TrizInterventionTarget
  label: string
  hint: string
}> = [
  { target: 'task', label: '落库为项目任务', hint: '在项目 WBS 下新建一条任务' },
  { target: 'risk', label: '落库为风险条目', hint: '登记到项目风险登记册' },
  { target: 'change_request', label: '落库为变更请求', hint: '提交一条变更请求走审批' },
]

/** 差异预览里的实体字段中文标签（未知字段回落原键名，不隐藏信息）。 */
export const TRIZ_INTERVENTION_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: '任务名称',
  title: '标题',
  description: '描述',
  status: '状态',
  priority: '优先级',
  taskType: '任务类型',
  startDate: '开始日期',
  endDate: '结束日期',
  milestoneId: '关联里程碑',
  category: '风险分类',
  probability: '发生概率',
  impact: '影响程度',
  score: '风险分值',
  riskLevel: '风险等级',
  relatedTaskId: '关联任务',
  crCode: '变更编号',
  changeType: '变更类型',
}

export function trizInterventionFieldLabel(key: string): string {
  return TRIZ_INTERVENTION_FIELD_LABELS[key] ?? key
}

// ---------------------------------------------------------------------------
// 图表馆矛盾矩阵跳转（spec「映射依据可查看与可改判」第 4 条）
// ---------------------------------------------------------------------------

/**
 * 图表馆 TRIZ 分馆矛盾矩阵深链（w7-chart-gallery-triz-wing 注册该 chartId）。
 * 目标未注册时图表馆有中性回退（目录页 + 预告），跳转本身不阻断。
 */
export function trizContradictionMatrixHref(
  projectId: number,
  improvingParameter: number,
  worseningParameter: number,
): string {
  const query = new URLSearchParams({
    improving: String(improvingParameter),
    worsening: String(worseningParameter),
  })
  return `/next/projects/${projectId}/charts/triz-contradiction-matrix?${query.toString()}`
}
