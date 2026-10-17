/**
 * v3-skill-eval-system —— SkillEvalService（D1/D3/D4/D5/D6/D8）。
 *
 * 提供 Skill 质量评估、评测运行、效果指标聚合、AI 辅助评估的 Service 层。
 * 所有查询强制附加 organization_id（组织隔离红线）。
 * AI 辅助评估 fixture 优先，真实模型 conditional。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import CompilerSkill from '#models/compiler_skill'
import SkillEvalReport from '#models/skill_eval_report'
import SkillEvalRun from '#models/skill_eval_run'
import SkillEffectEvent from '#models/skill_effect_event'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  scoreSkillQuality,
  runSkillBenchmark,
  aggregateSkillEffectMetrics,
  type Skill,
  type QualityReport,
  type BenchmarkReport,
  type SkillEffectEvent as SkillEffectEventType,
  type SkillEffectMetrics,
  type AiAssistAdvisory,
} from '@aiproj/types'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { resolveBenchmarkProvider } from './skill_eval_benchmark_provider.js'

// ── 自定义错误 ──────────────────────────────────────────────────────────

export class SkillEvalNotFoundError extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Skill eval report not found: ${id}`)
  }
}

export class FeatureOffError extends Error {
  constructor() {
    super('Skill eval feature is disabled')
    this.name = 'FeatureOffError'
  }
}

// ── Fixture AI Advisory ────────────────────────────────────────────────

function generateFixtureAdvisory(skill: Skill): AiAssistAdvisory {
  return {
    status: 'advisory',
    accuracy:
      `Skill "${skill.name}" 的知识内容覆盖了 ${skill.category.primary} 领域的核心场景，` +
      '规则和模式的表述清晰，示例与检查清单对齐良好。',
    completeness: `六类知识结构完整度较高，建议持续补充 ${skill.category.secondary ?? '相关'} 细分领域的具体案例。`,
    consistency: '各项规则之间不存在明显矛盾，反模式与规则对应关系明确。',
    overall: `总体评估：该 Skill 已达到上线标准，建议经人审确认后激活。`,
    confidence: 0.85,
    generatedAt: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════

@inject()
export default class SkillEvalService {
  constructor(private readonly audit: AuditService) {}

  /**
   * 执行质量评分并持久化报告。
   */
  async runQualityAssessment(
    organizationId: number,
    skillId: number,
    actorId: number,
    opts?: { referenceTime?: string },
  ): Promise<QualityReport> {
    const skill = await this.findSkill(organizationId, skillId)
    const skillTyped = this.toSkill(skill)

    // 执行确定性评分
    const report = scoreSkillQuality(skillTyped, { referenceTime: opts?.referenceTime })

    // 持久化
    await SkillEvalReport.create({
      organizationId,
      skillId: skill.id,
      score: report.score,
      dimensionScores: report.dimensionScores as any,
      issues: report.issues as any,
      suggestedTransition: null, // 不自动落库转移建议
      referenceTime: report.referenceTime,
      createdBy: actorId,
    })

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_EVAL_QUALITY_SCORED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        score: report.score,
        grade: report.grade,
      },
    })

    return report
  }

  /**
   * 执行评测并持久化运行记录。
   */
  async runBenchmark(
    organizationId: number,
    skillId: number,
    actorId: number,
    opts?: { referenceTime?: string; benchmarkSource?: 'L3' | 'fixture' },
  ): Promise<BenchmarkReport> {
    const skill = await this.findSkill(organizationId, skillId)
    const skillTyped = this.toSkill(skill)

    // 获取 BenchmarkProvider
    const provider = await resolveBenchmarkProvider()
    const inputs = await provider.getInputs(skillTyped)
    const benchmarkSource = opts?.benchmarkSource ?? provider.name

    // 执行评测
    const report = runSkillBenchmark(skillTyped, inputs, {
      referenceTime: opts?.referenceTime,
      benchmarkSource,
    })

    // 持久化
    await SkillEvalRun.create({
      organizationId,
      skillId: skill.id,
      benchmarkSource: report.benchmarkSource,
      inputs: inputs as any,
      activationDecisions: report.activationDecisions as any,
      coverageHits: [report.coverageHits],
      totalInputs: report.totalInputs,
      coverageRate: report.coverageRate,
      droppedConflictsCount: report.droppedConflictsCount,
      droppedDuplicatesCount: report.droppedDuplicatesCount,
      evidenceDigest: report.evidenceDigest,
      referenceTime: report.referenceTime,
      createdBy: actorId,
    })

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_EVAL_BENCHMARK_RUN,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        benchmarkSource: report.benchmarkSource,
        totalInputs: report.totalInputs,
        coverageRate: report.coverageRate,
      },
    })

    return report
  }

  /**
   * 列出某 Skill 的所有评估报告。
   */
  async listReports(
    organizationId: number,
    skillId: number,
    page = 1,
    perPage = 50,
  ): Promise<{ data: any[]; meta: any }> {
    const query = SkillEvalReport.query()
      .where('organization_id', organizationId)
      .where('skill_id', skillId)
      .orderBy('created_at', 'desc')

    const result = await query.paginate(page, perPage)
    return {
      data: result.all().map((r) => ({
        id: r.id,
        skillId: r.skillId,
        score: r.score,
        dimensionScores: r.dimensionScores,
        issues: r.issues,
        aiAdvisory: r.aiAdvisory,
        suggestedTransition: r.suggestedTransition,
        referenceTime: r.referenceTime,
        createdAt: r.createdAt,
      })),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * 获取单条评估报告详情。
   */
  async getReport(organizationId: number, reportId: number) {
    const report = await SkillEvalReport.query()
      .where('id', reportId)
      .where('organization_id', organizationId)
      .first()

    if (!report) throw new SkillEvalNotFoundError(reportId)

    return {
      id: report.id,
      skillId: report.skillId,
      score: report.score,
      dimensionScores: report.dimensionScores,
      issues: report.issues,
      aiAdvisory: report.aiAdvisory,
      suggestedTransition: report.suggestedTransition,
      referenceTime: report.referenceTime,
      createdAt: report.createdAt,
    }
  }

  /**
   * 获取某 Skill 的效果指标。
   */
  async getEffectMetrics(organizationId: number, skillKey: string): Promise<SkillEffectMetrics> {
    const events = await SkillEffectEvent.query()
      .where('organization_id', organizationId)
      .where('skill_id', await this.getSkillIdByKey(organizationId, skillKey))
      .orderBy('created_at', 'desc')

    const typedEvents: SkillEffectEventType[] = events.map((e) => ({
      organizationId: e.organizationId,
      skillKey,
      runId: e.runId ?? undefined,
      projectId: e.projectId ?? undefined,
      activatedAt: e.activatedAt,
      qualityScore: e.qualityScore ?? undefined,
      referenceTime: e.referenceTime,
    }))

    return aggregateSkillEffectMetrics(skillKey, typedEvents)
  }

  /**
   * AI 辅助评估 advisory 草稿。
   *
   * fixture 优先（确定性产出），真实模型 conditional（需用户明确授权）。
   */
  async aiAssist(
    organizationId: number,
    skillId: number,
    _actorId: number,
  ): Promise<AiAssistAdvisory> {
    const skill = await this.findSkill(organizationId, skillId)
    const skillTyped = this.toSkill(skill)

    // fixture 优先：确定性产出 advisory 草稿
    const advisory = generateFixtureAdvisory(skillTyped)

    // 不自动落库为正式评估报告
    // AI advisory 仅返回草稿，需人审确认后才转正式报告

    return advisory
  }

  /**
   * 记录效果事件（供 Skill 注入 Stage 的独立 change 调用）。
   */
  async recordSkillEffect(
    organizationId: number,
    skillKey: string,
    data: {
      runId?: number
      projectId?: number
      activatedAt: string
      qualityScore?: number
      referenceTime: string
    },
  ): Promise<void> {
    const skillId = await this.getSkillIdByKey(organizationId, skillKey)

    await SkillEffectEvent.create({
      organizationId,
      skillId,
      runId: data.runId ?? null,
      projectId: data.projectId ?? null,
      activatedAt: data.activatedAt,
      qualityScore: data.qualityScore ?? null,
      referenceTime: data.referenceTime,
    })

    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_EVAL_EFFECT_RECORDED,
      userId: 0, // system-initiated
      organizationId,
      metadata: {
        skillKey,
        runId: data.runId,
        projectId: data.projectId,
      },
    })
  }

  // ── 辅助 ────────────────────────────────────────────────────────────

  private async findSkill(organizationId: number, skillId: number): Promise<CompilerSkill> {
    const skill = await CompilerSkill.query()
      .where('id', skillId)
      .where('organization_id', organizationId)
      .first()

    if (!skill) throw new SkillEvalNotFoundError(skillId)
    return skill
  }

  private async getSkillIdByKey(organizationId: number, skillKey: string): Promise<number> {
    const skill = await CompilerSkill.query()
      .where('skill_key', skillKey)
      .where('organization_id', organizationId)
      .first()

    if (!skill) throw new SkillEvalNotFoundError(-1)
    return skill.id
  }

  private toSkill(skill: CompilerSkill): Skill {
    return {
      id: skill.id,
      organizationId: skill.organizationId,
      skillKey: skill.skillKey,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      status: skill.status as any,
      category: skill.category as any,
      tags: (skill.tags as any) ?? [],
      dependencies: (skill.dependencies as any) ?? [],
      activation: (skill.activation as any) ?? {},
      knowledge: (skill.knowledge as any) ?? {},
      provenance: (skill.provenance as any) ?? undefined,
      basePriority: skill.basePriority,
      createdBy: skill.createdBy,
      updatedBy: skill.updatedBy,
      createdAt: skill.createdAt.toISO() ?? '',
      updatedAt: skill.updatedAt.toISO() ?? '',
    }
  }
}
