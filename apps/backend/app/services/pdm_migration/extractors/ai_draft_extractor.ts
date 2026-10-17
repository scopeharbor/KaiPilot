/**
 * v2-pdm-migration-compatibility —— AI Draft Extractor（Section 4.4 / Section 6）。
 *
 * 抽取 AI 草案 session/version/status、generated_* JSON、assumptions、clarification history。
 * 红线：迁移草案不得自动创建正式项目。
 */
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import type { CanonicalProjectEntity, CanonicalDraftSnapshot } from '../types.js'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import AiProjectDraftEvent from '#models/ai_project_draft_event'
import AiProjectDraftConfirmation from '#models/ai_project_draft_confirmation'

export class AiDraftExtractor {
  /**
   * 抽取单个草案的 canonical 快照。
   */
  async extract(draftId: number, organizationId: number): Promise<CanonicalDraftSnapshot | null> {
    const draft = await AiProjectDraft.query()
      .where('id', draftId)
      .where('organization_id', organizationId)
      .first()

    if (!draft) return null

    const fields: Record<string, unknown> = {
      id: draft.id,
      draftUid: draft.draftUid,
      organizationId: draft.organizationId,
      userId: draft.userId,
      projectType: draft.projectType,
      status: draft.status,
      schemaVersion: draft.schemaVersion,
      currentVersion: draft.currentVersion,
      projectId: draft.projectId,
      structuredStrategy: draft.structuredStrategy,
      consistency: draft.consistency,
    }

    const sourceHash = createHash('sha256')
      .update(JSON.stringify(fields, Object.keys(fields).sort()), 'utf-8')
      .digest('hex')
      .slice(0, 16)

    const now = DateTime.now().toISO()
    const draftEntity: CanonicalProjectEntity = {
      sourceTable: 'ai_project_drafts',
      sourceId: draft.id,
      sourceHash,
      organizationId: draft.organizationId,
      fields,
      extensions: {
        fallbackUsed: draft.fallbackUsed,
        provider: draft.provider,
        model: draft.model,
        usingRealAdapter: draft.usingRealAdapter,
      },
      deletedAt: null,
      createdAt: draft.createdAt?.toISO?.() ?? now,
      updatedAt: draft.updatedAt?.toISO?.() ?? null,
    }

    // 版本
    const versions = await AiProjectDraftVersion.query().where('draft_id', draft.id)
    const versionEntities = versions.map((v) => {
      const vFields: Record<string, unknown> = {
        id: v.id,
        draftId: v.draftId,
        version: v.version,
        origin: v.origin,
        status: v.status,
      }
      const vHash = createHash('sha256')
        .update(JSON.stringify(vFields, Object.keys(vFields).sort()), 'utf-8')
        .digest('hex')
        .slice(0, 16)
      return {
        sourceTable: 'ai_project_draft_versions',
        sourceId: v.id,
        sourceHash: vHash,
        organizationId: draft.organizationId,
        fields: vFields,
        extensions: { draft: v.draft, meta: v.meta, validation: v.validation },
        deletedAt: null,
        createdAt: v.createdAt?.toISO?.() ?? now,
        updatedAt: null,
      } as CanonicalProjectEntity
    })

    // 事件
    const events = await AiProjectDraftEvent.query().where('draft_id', draft.id)
    const eventEntities = events.map((e) => ({
      sourceTable: 'ai_project_draft_events',
      sourceId: e.id,
      sourceHash: 'event',
      organizationId: draft.organizationId,
      fields: {
        id: e.id,
        draftId: (e as any).draftId,
        eventType: (e as any).eventType,
        level: (e as any).level,
      },
      extensions: {},
      deletedAt: null,
      createdAt: (e as any).createdAt?.toISO?.() ?? now,
      updatedAt: null,
    })) as CanonicalProjectEntity[]

    // 确认
    const confirmations = await AiProjectDraftConfirmation.query().where('draft_id', draft.id)
    const confEntities = confirmations.map((c) => ({
      sourceTable: 'ai_project_draft_confirmations',
      sourceId: c.id,
      sourceHash: 'conf',
      organizationId: draft.organizationId,
      fields: {
        id: c.id,
        draftId: (c as any).draftId,
        confirmed: (c as any).confirmed,
        version: (c as any).version,
      },
      extensions: {},
      deletedAt: null,
      createdAt: (c as any).createdAt?.toISO?.() ?? now,
      updatedAt: null,
    })) as CanonicalProjectEntity[]

    return {
      kind: 'draft',
      organizationId: draft.organizationId,
      draftId: draft.id,
      draft: draftEntity,
      versions: versionEntities,
      events: eventEntities,
      confirmations: confEntities,
      extractedAt: now,
    }
  }

  /**
   * 抽取某组织下所有草案。
   */
  async extractByOrganization(organizationId: number): Promise<CanonicalDraftSnapshot[]> {
    const drafts = await AiProjectDraft.query().where('organization_id', organizationId)
    const results: CanonicalDraftSnapshot[] = []
    for (const draft of drafts) {
      const snap = await this.extract(draft.id, organizationId)
      if (snap) results.push(snap)
    }
    return results
  }
}
