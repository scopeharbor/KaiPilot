/**
 * v3-skill-knowledge-authoring —— SkillKnowledgeAuthoringService（D2/D3/D4/D5/D6/D10）。
 *
 * 组织级知识包创作、preview/diff、人审 commit 与 AI 辅助 advisory 草稿。
 * 所有查询强制 `where organization_id`（组织隔离红线）。
 * commit 走 Registry 既有 `update` 边界（D3），不直接写 compiler_skills。
 * commit 仅对 draft 状态 Skill（D4）。
 * AI 辅助产 advisory 草稿，人审 commit 为唯一转正门（D5）。
 */
import { inject } from '@adonisjs/core'
import CompilerSkill from '#models/compiler_skill'
import SkillKnowledgeDraft from '#models/skill_knowledge_draft'
import SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  assembleBundle,
  validateBundleStructure,
  diffBundles,
  generateFixtureAiAssistSections,
  type AuthoringDraft,
  type AuthoringPreview,
  type KnowledgeSection,
  type AiAssistHint,
} from '@aiproj/types'

/** commit 非法状态错误码。 */
export const SKILL_KNOWLEDGE_COMMIT_INVALID_STATE = 'SKILL_KNOWLEDGE_COMMIT_INVALID_STATE'

export class DraftNotFoundError extends Error {
  constructor(skillId: number) {
    super(`No pending draft found for skill ${skillId}`)
    this.name = 'DraftNotFoundError'
  }
}

export class DraftNotPendingError extends Error {
  constructor(id: number, status: string) {
    super(`Draft ${id} is not pending (status: ${status})`)
    this.name = 'DraftNotPendingError'
  }
}

export class SkillNotInDraftStateError extends Error {
  constructor(skillId: number, status: string) {
    super(
      `Skill ${skillId} is not in draft state (status: ${status}). ` +
        `Commit knowledge only allowed for draft skills. Return to draft first.`,
    )
    this.name = 'SkillNotInDraftStateError'
  }
}

export class SkillKnowledgeAuthoringError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'SkillKnowledgeAuthoringError'
  }
}

@inject()
export default class SkillKnowledgeAuthoringService {
  constructor(
    private readonly registry: SkillRegistryService,
    private readonly audit: AuditService,
    // sourceProvider retained for future four-layer wiring (D6)
  ) {}

  // ── 读草稿 ─────────────────────────────────────────────────

  /**
   * 获取当前 pending 草稿（只读，不写审计）。
   */
  async getDraft(
    organizationId: number,
    skillId: number,
    _actorId: number,
  ): Promise<AuthoringDraft | null> {
    await this.getOwnedSkill(organizationId, skillId)
    const draft = await SkillKnowledgeDraft.pendingForSkill(organizationId, skillId)

    if (!draft) {
      return null
    }

    return this.toAuthoringDraft(draft)
  }

  // ── 草稿 CRUD ─────────────────────────────────────────────────

  /**
   * 创建 pending 草稿（D2：单 pending 约束，D8：需 author 权限）。
   */
  async createDraft(
    organizationId: number,
    skillId: number,
    sections: KnowledgeSection[],
    actorId: number,
  ): Promise<AuthoringDraft> {
    // 获取 Skill（验证组织归属 + 存在性）
    const skill = await this.getOwnedSkill(organizationId, skillId)

    // 单 pending 约束：检查已有 pending 草稿
    const existing = await SkillKnowledgeDraft.pendingForSkill(organizationId, skillId)
    if (existing) {
      throw new SkillKnowledgeAuthoringError(
        `Skill ${skillId} already has a pending draft (id: ${existing.id}). Discard or commit it first.`,
        'DRAFT_ALREADY_PENDING',
      )
    }

    const draft = await SkillKnowledgeDraft.create({
      organizationId,
      skillId,
      sections: sections as any,
      baseVersion: skill.version,
      status: 'pending',
      aiAssisted: false,
      createdBy: actorId,
      updatedBy: actorId,
    })

    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_KNOWLEDGE_DRAFT_SAVED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        sectionCount: sections.length,
        aiAssisted: false,
        actorId,
        organizationId,
      },
    })

    return this.toAuthoringDraft(draft)
  }

  /**
   * 更新 pending 草稿（D2：仅 pending 可编辑，committed/discarded 终态不可编辑）。
   */
  async updateDraft(
    organizationId: number,
    skillId: number,
    sections: KnowledgeSection[],
    actorId: number,
  ): Promise<AuthoringDraft> {
    const draft = await this.getOwnedPendingDraft(organizationId, skillId)

    draft.sections = sections as any
    draft.updatedBy = actorId
    await draft.save()

    const skill = await this.getOwnedSkill(organizationId, skillId)

    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_KNOWLEDGE_DRAFT_SAVED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        sectionCount: sections.length,
        aiAssisted: draft.aiAssisted,
        actorId,
        organizationId,
      },
    })

    return this.toAuthoringDraft(draft)
  }

  /**
   * 丢弃草稿（D2：置 discarded 终态）。
   */
  async discardDraft(organizationId: number, skillId: number, actorId: number): Promise<void> {
    const draft = await this.getOwnedPendingDraft(organizationId, skillId)

    draft.status = 'discarded'
    draft.updatedBy = actorId
    await draft.save()

    const skill = await this.getOwnedSkill(organizationId, skillId)

    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_KNOWLEDGE_DRAFT_SAVED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        sectionCount: 0,
        aiAssisted: draft.aiAssisted,
        actorId,
        organizationId,
      },
    })
  }

  // ── Preview（只读） ────────────────────────────────────────────

  /**
   * 预览草稿（D2/D3：只读组装+校验+diff，不写 Skill，不写草稿状态）。
   */
  async previewDraft(
    organizationId: number,
    skillId: number,
    actorId: number,
  ): Promise<AuthoringPreview> {
    const skill = await this.getOwnedSkill(organizationId, skillId)
    const draft = await SkillKnowledgeDraft.pendingForSkill(organizationId, skillId)

    // 从当前 Skill.knowledge 中提取 base sections
    const rawKnowledge = skill.knowledge ?? {}
    const baseSections = this.bundleToSections(rawKnowledge)

    // 草稿 sections
    const draftSections: KnowledgeSection[] = draft ? ((draft.sections as any) ?? []) : []

    // 组装
    const bundle = assembleBundle(draftSections)

    // 校验
    const issues = validateBundleStructure(draftSections)

    // diff
    const diff = diffBundles(baseSections, draftSections)

    // 写 preview 审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_KNOWLEDGE_PREVIEWED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        sectionCount: draftSections.length,
        aiAssisted: draft?.aiAssisted ?? false,
        actorId,
        organizationId,
      },
    })

    return { bundle, issues, diff }
  }

  // ── Commit（受治理写回） ──────────────────────────────────────

  /**
   * commit 草稿写回 Skill.knowledge（D3/D4）。
   *
   * - 走 Registry `update` 边界（不直接写 compiler_skills）
   * - 仅 draft 状态 Skill 可 commit（D4）
   * - 草稿置 committed 终态
   */
  async commitDraft(
    organizationId: number,
    skillId: number,
    actorId: number,
  ): Promise<AuthoringDraft> {
    const skill = await this.getOwnedSkill(organizationId, skillId)
    const draft = await this.getOwnedPendingDraft(organizationId, skillId)

    // D4：仅 draft 状态 Skill
    if (skill.status !== 'draft') {
      throw new SkillNotInDraftStateError(skillId, skill.status)
    }

    // 组装 bundle
    const sections = (draft.sections as KnowledgeSection[]) ?? []
    const bundle = assembleBundle(sections)

    // D3：经 Registry update 写回
    await this.registry.update(
      organizationId,
      skillId,
      { knowledge: bundle as Record<string, unknown> },
      actorId,
    )

    // 草稿置 committed
    draft.status = 'committed'
    draft.updatedBy = actorId
    await draft.save()

    // 写 commit 审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_KNOWLEDGE_COMMITTED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        sectionCount: sections.length,
        aiAssisted: draft.aiAssisted,
        actorId,
        organizationId,
        baseVersion: draft.baseVersion,
        resultingVersion: skill.version,
      },
    })

    return this.toAuthoringDraft(draft)
  }

  // ── AI 辅助 ───────────────────────────────────────────────────

  /**
   * AI 辅助生成 advisory 草稿（D5：不自动 commit，不自动写 Skill）。
   *
   * 默认 FixtureAiAssistAdapter（确定性），真实模型替换需用户授权。
   */
  async aiAssist(
    organizationId: number,
    skillId: number,
    hint: AiAssistHint,
    actorId: number,
  ): Promise<AuthoringDraft> {
    const skill = await this.getOwnedSkill(organizationId, skillId)

    // 调 fixture AI 适配器（确定性，零模型）
    const result = generateFixtureAiAssistSections(hint)

    // 创建单 pending 草稿
    const existing = await SkillKnowledgeDraft.pendingForSkill(organizationId, skillId)
    if (existing) {
      throw new SkillKnowledgeAuthoringError(
        `Skill ${skillId} already has a pending draft (id: ${existing.id}). Discard or commit it first.`,
        'DRAFT_ALREADY_PENDING',
      )
    }

    const draft = await SkillKnowledgeDraft.create({
      organizationId,
      skillId,
      sections: result.sections as any,
      baseVersion: skill.version,
      status: 'pending',
      aiAssisted: true,
      createdBy: actorId,
      updatedBy: actorId,
    })

    // 写 ai_assisted 审计（D5：不自动 commit）
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_KNOWLEDGE_AI_ASSISTED,
      userId: actorId,
      organizationId,
      metadata: {
        skillKey: skill.skillKey,
        version: skill.version,
        sectionCount: result.sections.length,
        aiAssisted: true,
        actorId,
        organizationId,
      },
    })

    return this.toAuthoringDraft(draft)
  }

  // ── 内部工具 ──────────────────────────────────────────────────

  /**
   * 获取 Skill 并按组织归属验证。
   */
  private async getOwnedSkill(organizationId: number, skillId: number): Promise<CompilerSkill> {
    const skill = await CompilerSkill.query()
      .where('id', skillId)
      .where('organization_id', organizationId)
      .first()

    if (!skill) {
      throw new SkillKnowledgeAuthoringError(
        `Skill ${skillId} not found in organization ${organizationId}`,
        'RESOURCE_NOT_FOUND',
      )
    }

    return skill
  }

  /**
   * 获取并验证 pending 草稿。
   */
  private async getOwnedPendingDraft(
    organizationId: number,
    skillId: number,
  ): Promise<SkillKnowledgeDraft> {
    const draft = await SkillKnowledgeDraft.pendingForSkill(organizationId, skillId)

    if (!draft) {
      throw new DraftNotFoundError(skillId)
    }

    return draft
  }

  /**
   * Model → AuthoringDraft DTO 转换。
   */
  private toAuthoringDraft(model: SkillKnowledgeDraft): AuthoringDraft {
    return {
      skillId: model.skillId,
      sections: (model.sections as any) ?? [],
      baseVersion: model.baseVersion,
      aiAssisted: model.aiAssisted,
      status: model.status,
      createdBy: model.createdBy,
      updatedBy: model.updatedBy,
      createdAt: model.createdAt?.toISO() ?? '',
      updatedAt: model.updatedAt?.toISO() ?? '',
    }
  }

  /**
   * 从 KnowledgeBundle 中提取 sections 用于 diff（不完整的 section 提取）。
   */
  private bundleToSections(bundle: Record<string, unknown>): KnowledgeSection[] {
    const sections: KnowledgeSection[] = []
    const kinds: string[] = [
      'rules',
      'patterns',
      'antiPatterns',
      'examples',
      'checklists',
      'rubric',
    ]

    for (const kind of kinds) {
      const arr = bundle[kind]
      if (Array.isArray(arr)) {
        for (const [i, element] of arr.entries()) {
          sections.push({
            id: `base-${kind}-${i}`,
            kind: kind as any,
            title: `[Base] ${kind} #${i + 1}`,
            content: element as Record<string, unknown>,
            sourceRefs: [{ manual: true }],
            status: 'reviewed',
          })
        }
      }
    }

    return sections
  }
}
