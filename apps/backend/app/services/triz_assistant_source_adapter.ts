import db from '@adonisjs/lucid/services/db'
import { AI_TRIZ_ASSISTANT_SOURCE_KINDS } from '@aiproj/types'
import type {
  AiTrizAssistantSourceKind,
  AiTrizAssistantSourceSummary,
  AiTrizAssistantWarningCode,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function simpleHash8(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}

function now(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// 来源摘要接口
// ---------------------------------------------------------------------------

export interface AssistantSourceAdapterResult {
  readonly summary: AiTrizAssistantSourceSummary | null
  readonly warning: { code: AiTrizAssistantWarningCode; message: string } | null
}

// ---------------------------------------------------------------------------
// 只读来源适配器（§4.1–§4.5）
// ---------------------------------------------------------------------------

/**
 * 矛盾模型来源适配器。
 */
async function collectContradictionRefs(
  _organizationId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const rows = await db
      .from('contradictions')
      .where('project_id', projectId)
      .select('id', 'title', 'type', 'status')
    if (rows.length === 0) {
      return { summary: null, warning: null }
    }
    const ids = rows.map((r) => `contra-${r.id}`).join(',')
    const hash = simpleHash8(`contradictions:${projectId}:${ids}`)
    return {
      summary: {
        sourceKind: 'contradiction',
        sourceRef: `contradiction_refs:${projectId}`,
        sourceHash: hash,
        lowSensitivitySummary: `项目下 ${rows.length} 个矛盾（技术 ${rows.filter((r) => r.type === 'technical').length} / 物理 ${rows.filter((r) => r.type === 'physical').length}）`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: [
          'contradiction_matrix',
          'technical_contradiction_analyzer',
          'physical_contradiction_analyzer',
        ],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '矛盾数据读取失败' },
    }
  }
}

async function collectContradictionMatrixRef(
  _orgId: number,
  _projectId: number,
): Promise<AssistantSourceAdapterResult> {
  // 矛盾矩阵是纯计算视图，无独立表
  return {
    summary: {
      sourceKind: 'contradiction_matrix',
      sourceRef: 'contradiction_matrix:metaview',
      sourceHash: simpleHash8('matrix:metaview'),
      lowSensitivitySummary: '矛盾矩阵交叉视图（可用）',
      freshness: { lastUpdatedAt: now(), isStale: false },
      routeHints: ['contradiction_matrix'],
      warnings: [],
    },
    warning: null,
  }
}

async function collectTechnicalContradictionAnalysisRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_technical_contradiction_analysis_runs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'technical_contradiction_analysis',
        sourceRef: `tech_analyzer_runs:${projectId}`,
        sourceHash: simpleHash8(`tech_analyzer:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 次技术矛盾分析运行`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['technical_contradiction_analyzer'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '技术矛盾分析数据读取失败' },
    }
  }
}

async function collectPhysicalContradictionAnalysisRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_physical_contradiction_analysis_runs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'physical_contradiction_analysis',
        sourceRef: `phys_analyzer_runs:${projectId}`,
        sourceHash: simpleHash8(`phys_analyzer:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 次物理矛盾分析运行`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['physical_contradiction_analyzer'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '物理矛盾分析数据读取失败' },
    }
  }
}

async function collectIfrRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_ifr_analysis_runs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'ifr_snapshot',
        sourceRef: `ifr_runs:${projectId}`,
        sourceHash: simpleHash8(`ifr:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 次 IFR 分析运行`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['ifr_visualization'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: 'IFR 数据读取失败' },
    }
  }
}

async function collectFunctionAnalysisRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_function_analysis_runs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'function_analysis_snapshot',
        sourceRef: `fa_runs:${projectId}`,
        sourceHash: simpleHash8(`fa:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 次功能分析运行`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['function_analysis_diagram'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '功能分析数据读取失败' },
    }
  }
}

async function collectResourceAnalysisRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_resource_analysis_runs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'resource_analysis',
        sourceRef: `res_runs:${projectId}`,
        sourceHash: simpleHash8(`resource:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 次资源分析运行`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['resource_analyzer'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '资源分析数据读取失败' },
    }
  }
}

async function collectEvolutionTrendRefs(
  _orgId: number,
  projectId: number,
  evolutionTrendAvailable: boolean,
): Promise<AssistantSourceAdapterResult> {
  if (!evolutionTrendAvailable) {
    return {
      summary: null,
      warning: { code: 'FEATURE_FLAG_DISABLED', message: '进化趋势分析模块暂不可用' },
    }
  }
  try {
    const count = await db
      .from('triz_evolution_trend_analysis_runs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'evolution_trend_run',
        sourceRef: `evo_runs:${projectId}`,
        sourceHash: simpleHash8(`evo:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 次进化趋势分析运行`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['evolution_trend_analysis'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '进化趋势分析数据读取失败' },
    }
  }
}

async function collectRecommendationRationaleRefs(
  _orgId: number,
): Promise<AssistantSourceAdapterResult> {
  // 推荐理由由前端审查面直接呈现，助手只给导航提示
  return {
    summary: {
      sourceKind: 'recommendation_rationale',
      sourceRef: 'rationale:metaview',
      sourceHash: simpleHash8('rationale:metaview'),
      lowSensitivitySummary: 'TRIZ 推荐理由（可用）',
      freshness: { lastUpdatedAt: now(), isStale: false },
      routeHints: ['recommendation_rationale'],
      warnings: [],
    },
    warning: null,
  }
}

async function collectInnovationWorkbenchRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_innovation_schemes')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'innovation_workbench_scheme',
        sourceRef: `wb_schemes:${projectId}`,
        sourceHash: simpleHash8(`wb:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 个创新方案`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['innovation_workbench'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '创新工作台数据读取失败' },
    }
  }
}

async function collectDecisionLogRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_decision_logs')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'decision_log',
        sourceRef: `decisions:${projectId}`,
        sourceHash: simpleHash8(`decisions:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 条决策记录`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['decision_center'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '决策日志数据读取失败' },
    }
  }
}

async function collectClarificationCardRefs(
  _orgId: number,
  projectId: number,
): Promise<AssistantSourceAdapterResult> {
  try {
    const count = await db
      .from('triz_clarification_cards')
      .where('project_id', projectId)
      .count('* as total')
      .first()
    const total = Number(count?.total ?? 0)
    if (total === 0) {
      return { summary: null, warning: null }
    }
    return {
      summary: {
        sourceKind: 'clarification_card',
        sourceRef: `clarifications:${projectId}`,
        sourceHash: simpleHash8(`clar:${projectId}:${total}`),
        lowSensitivitySummary: `${total} 张澄清卡片`,
        freshness: { lastUpdatedAt: now(), isStale: false },
        routeHints: ['clarification_cards'],
        warnings: [],
      },
      warning: null,
    }
  } catch {
    return {
      summary: null,
      warning: { code: 'SOURCE_UNAVAILABLE', message: '澄清卡片数据读取失败' },
    }
  }
}

async function collectCompilerTrizArtifactRef(
  _orgId: number,
  _projectId: number,
): Promise<AssistantSourceAdapterResult> {
  // Compiler artifact 由 Compiler 服务解析，助手只给导航提示
  return {
    summary: {
      sourceKind: 'compiler_triz_artifact',
      sourceRef: 'compiler:metaview',
      sourceHash: simpleHash8('compiler:metaview'),
      lowSensitivitySummary: 'Compiler TRIZ 分析产物（如有）',
      freshness: { lastUpdatedAt: now(), isStale: false },
      routeHints: ['draft_preview'],
      warnings: [],
    },
    warning: null,
  }
}

async function collectDraftLayerRef(
  _orgId: number,
  _projectId: number,
): Promise<AssistantSourceAdapterResult> {
  // Draft Layer 由 Draft 服务管理，助手只给导航提示
  return {
    summary: {
      sourceKind: 'draft_layer',
      sourceRef: 'draft:metaview',
      sourceHash: simpleHash8('draft:metaview'),
      lowSensitivitySummary: 'Draft Layer 就绪状态（如项目有草稿）',
      freshness: { lastUpdatedAt: now(), isStale: false },
      routeHints: ['draft_preview'],
      warnings: [],
    },
    warning: null,
  }
}

async function collectKnowledgeSummaryRef(
  _orgId: number,
  _projectId: number,
  knowledgeBaseAvailable: boolean,
): Promise<AssistantSourceAdapterResult> {
  if (!knowledgeBaseAvailable) {
    return { summary: null, warning: null }
  }
  return {
    summary: {
      sourceKind: 'knowledge_summary',
      sourceRef: 'knowledge:metaview',
      sourceHash: simpleHash8('knowledge:metaview'),
      lowSensitivitySummary: '知识库摘要（可用）',
      freshness: { lastUpdatedAt: now(), isStale: false },
      routeHints: [],
      warnings: [],
    },
    warning: null,
  }
}

async function collectSkillSummaryRef(
  _orgId: number,
  _projectId: number,
  skillSystemAvailable: boolean,
): Promise<AssistantSourceAdapterResult> {
  if (!skillSystemAvailable) {
    return { summary: null, warning: null }
  }
  return {
    summary: {
      sourceKind: 'skill_summary',
      sourceRef: 'skill:metaview',
      sourceHash: simpleHash8('skill:metaview'),
      lowSensitivitySummary: 'Skill System 摘要（可用）',
      freshness: { lastUpdatedAt: now(), isStale: false },
      routeHints: [],
      warnings: [],
    },
    warning: null,
  }
}

// ---------------------------------------------------------------------------
// 来源适配器注册表（§4.2–§4.4）
// ---------------------------------------------------------------------------

/** 可选能力门：未启用的上游模块由适配器降级为空结果 + 警告。 */
interface SourceAdapterFlags {
  evolutionTrendAvailable?: boolean
  knowledgeBaseAvailable?: boolean
  skillSystemAvailable?: boolean
}

type SourceAdapterFn = (
  organizationId: number,
  projectId: number,
  flags?: SourceAdapterFlags,
) => Promise<AssistantSourceAdapterResult>

const SOURCE_ADAPTERS: Record<AiTrizAssistantSourceKind, { fn: SourceAdapterFn }> = {
  contradiction: {
    fn: (o, p) => collectContradictionRefs(o, p),
  },
  contradiction_matrix: {
    fn: (o, p) => collectContradictionMatrixRef(o, p),
  },
  technical_contradiction_analysis: {
    fn: (o, p) => collectTechnicalContradictionAnalysisRefs(o, p),
  },
  physical_contradiction_analysis: {
    fn: (o, p) => collectPhysicalContradictionAnalysisRefs(o, p),
  },
  ifr_snapshot: {
    fn: (o, p) => collectIfrRefs(o, p),
  },
  function_analysis_snapshot: {
    fn: (o, p) => collectFunctionAnalysisRefs(o, p),
  },
  resource_analysis: {
    fn: (o, p) => collectResourceAnalysisRefs(o, p),
  },
  evolution_trend_run: {
    fn: (o, p, f) => collectEvolutionTrendRefs(o, p, f?.evolutionTrendAvailable ?? false),
  },
  recommendation_rationale: {
    fn: (o, _p) => collectRecommendationRationaleRefs(o),
  },
  innovation_workbench_scheme: {
    fn: (o, p) => collectInnovationWorkbenchRefs(o, p),
  },
  decision_log: {
    fn: (o, p) => collectDecisionLogRefs(o, p),
  },
  clarification_card: {
    fn: (o, p) => collectClarificationCardRefs(o, p),
  },
  compiler_triz_artifact: {
    fn: (o, p) => collectCompilerTrizArtifactRef(o, p),
  },
  draft_layer: {
    fn: (o, p) => collectDraftLayerRef(o, p),
  },
  knowledge_summary: {
    fn: (o, p, f) => collectKnowledgeSummaryRef(o, p, f?.knowledgeBaseAvailable ?? false),
  },
  skill_summary: {
    fn: (o, p, f) => collectSkillSummaryRef(o, p, f?.skillSystemAvailable ?? false),
  },
}

export default class TrizAssistantSourceAdapter {
  async collect(
    organizationId: number,
    projectId: number,
    sourceKinds: AiTrizAssistantSourceKind[],
    featureFlags?: {
      evolutionTrendAvailable?: boolean
      knowledgeBaseAvailable?: boolean
      skillSystemAvailable?: boolean
    },
  ): Promise<{
    summaries: AiTrizAssistantSourceSummary[]
    warnings: { code: AiTrizAssistantWarningCode; message: string }[]
  }> {
    const summaries: AiTrizAssistantSourceSummary[] = []
    const warnings: { code: AiTrizAssistantWarningCode; message: string }[] = []

    for (const kind of sourceKinds) {
      const adapter = SOURCE_ADAPTERS[kind]
      if (!adapter) continue
      try {
        const result = await adapter.fn(organizationId, projectId, featureFlags)
        if (result.summary) summaries.push(result.summary)
        if (result.warning) warnings.push(result.warning)
      } catch {
        warnings.push({ code: 'SOURCE_UNAVAILABLE', message: `来源 ${kind} 收集失败` })
      }
    }

    return { summaries, warnings }
  }

  /**
   * null-safe warning mapping（§4.10 P1）：
   * 对于因 owning change 未 apply/archive 而不可用的来源，
   * 返回带 degrade 原因的低敏 warning，不抛异常。
   */
  getNullSafeWarning(
    sourceKind: AiTrizAssistantSourceKind,
    reason: string,
  ): { code: AiTrizAssistantWarningCode; message: string } {
    return {
      code: 'SOURCE_UNAVAILABLE',
      message: `来源 ${sourceKind} 不可用：${reason}`,
    }
  }

  /**
   * 批量检查哪些来源因为表不存在/模块未部署而不可用。
   */
  async probeAvailableKinds(
    organizationId: number,
    projectId: number,
  ): Promise<{
    available: AiTrizAssistantSourceKind[]
    unavailable: AiTrizAssistantSourceKind[]
    warnings: { code: AiTrizAssistantWarningCode; message: string }[]
  }> {
    const allKinds = [...AI_TRIZ_ASSISTANT_SOURCE_KINDS] as AiTrizAssistantSourceKind[]
    const available: AiTrizAssistantSourceKind[] = []
    const unavailable: AiTrizAssistantSourceKind[] = []
    const warnings: { code: AiTrizAssistantWarningCode; message: string }[] = []

    const { summaries, warnings: collectWarnings } = await this.collect(
      organizationId,
      projectId,
      allKinds,
    )
    warnings.push(...collectWarnings)
    for (const kind of allKinds) {
      if (summaries.some((s) => s.sourceKind === kind)) {
        available.push(kind)
      } else {
        unavailable.push(kind)
        warnings.push({
          code: 'SOURCE_UNAVAILABLE',
          message: `来源 ${kind} 当前无可用数据`,
        })
      }
    }

    return { available, unavailable, warnings }
  }
}

// 重新导入常量（避免循环引用）
// (imported inline at bottom — AI_TRIZ_ASSISTANT_SOURCE_KINDS from @aiproj/types)
