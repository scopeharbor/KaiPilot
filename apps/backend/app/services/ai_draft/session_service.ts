/**
 * ai-draft-generation / T036·T037 —— 草案会话持久化编排（design D1/D4）。
 *
 * 只写草案区表（ai_project_drafts / _versions / _events / _confirmations），
 * 绝不写正式业务表（红线）。组织隔离经 `TenantScope.forOrganization` + user 归属。
 *
 * 事件持久化天然支持 Last-Event-ID 幂等恢复：按 (draft_id, sequence) 唯一，
 * 重连时读 sequence > cursor 的事件重放即可，不产生副作用（tasks 3.5）。
 */

import { randomUUID } from 'node:crypto'
import type {
  DraftValidationReport,
  ProjectDraftDetail,
  ProjectDraftFailureDetail,
  ProjectDraftPipelineCheckpoint,
  ProjectDraftStageCheckpoint,
  ProjectDraftSessionStatus,
  ProjectDraftStreamEvent,
  ProjectType,
} from '@aiproj/types'
import { PROJECT_DRAFT_SCHEMA_VERSION } from '@aiproj/types'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import AiProjectDraftEvent from '#models/ai_project_draft_event'
import TenantScope from '#services/tenant_scope'
import type { GenerateDraftResult } from './generation_service.ts'
import { buildDraftStreamEvents } from './events.ts'

export interface CreateFromGenerationArgs {
  organizationId: number
  userId: number
  projectType: ProjectType
  result: GenerateDraftResult
  validation: DraftValidationReport | null
}

export interface PendingCreationArgs {
  organizationId: number
  userId: number
  projectType: ProjectType
}

export interface DraftSessionWithEvents {
  session: AiProjectDraft
  events: ProjectDraftStreamEvent[]
}

function buildCheckpointFromMeta(
  meta: GenerateDraftResult['meta'],
): ProjectDraftPipelineCheckpoint | null {
  if (!meta) return null
  const completedStages: ProjectDraftStageCheckpoint[] = []
  let failedStage: ProjectDraftStageCheckpoint | null = null

  if (meta.stages) {
    for (const st of meta.stages) {
      const isFailed = st.status === 'failed' || st.stage === meta.failure?.stage
      const ck: ProjectDraftStageCheckpoint = {
        version: '1.0',
        stage: st.stage,
        status: isFailed ? 'failed' : 'completed',
        artifact: null,
        artifactHash: st.artifactHash,
        manifestHash: meta.groundingManifest?.hash ?? '',
        catalogVersion: '1.0',
        guideVersion: '1.0',
        schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
        provider: meta.provider,
        model: meta.model,
        strategy: meta.structuredStrategy,
        attemptCount: st.attemptCount,
        errorCodes:
          st.errorCodes.length > 0
            ? st.errorCodes
            : meta.failure?.reasonCode
              ? [meta.failure.reasonCode]
              : [],
        spentMs: 0,
        parseErrorKinds: [],
        validationResult: meta.failure?.errors
          ? {
              ok: !isFailed,
              errors: meta.failure.errors.map((e) => ({
                path: e.path ?? '(root)',
                message: e.message,
              })),
            }
          : null,
      }
      if (isFailed) {
        failedStage = ck
      } else {
        completedStages.push(ck)
      }
    }
  }

  return {
    version: '1.0',
    contextHash: meta.groundingManifest?.hash ?? '',
    completedStages,
    failedStage,
    spentMs: 0,
    spentChars: 0,
  }
}

export default class ProjectDraftSessionService {
  /** 预分配会话行：status = drafting, currentVersion = 0, 无版本记录。 */
  async createPending(args: PendingCreationArgs): Promise<AiProjectDraft> {
    const draftUid = randomUUID()
    const session = await AiProjectDraft.create({
      draftUid,
      organizationId: args.organizationId,
      userId: args.userId,
      projectType: args.projectType,
      status: 'drafting',
      schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
      currentVersion: 0,
      structuredStrategy: 'prompt',
      consistency: 'strict',
      fallbackUsed: false,
      provider: 'mock',
      model: 'mock',
      usingRealAdapter: false,
      projectId: null,
    })
    return session
  }

  /** 完成生成：建版本 1、回填元数据、置 reviewing/error。 */
  async completeGeneration(
    session: AiProjectDraft,
    args: { result: GenerateDraftResult; validation: DraftValidationReport | null },
  ): Promise<void> {
    const { result } = args
    const completed = result.status === 'completed' && result.draft !== null
    const status: ProjectDraftSessionStatus = completed ? 'reviewing' : 'error'

    if (completed) {
      await AiProjectDraftVersion.create({
        draftId: session.id,
        version: 1,
        origin: 'generated',
        status: 'active',
        draft: result.draft!,
        meta: result.meta,
        validation: args.validation,
      })
    } else if (!session.generationCheckpoint && result.meta) {
      session.generationCheckpoint = buildCheckpointFromMeta(result.meta)
    }

    session.currentVersion = completed ? 1 : 0
    session.status = status
    session.structuredStrategy = result.meta.structuredStrategy
    session.consistency = result.consistency
    session.fallbackUsed = result.meta.fallbackUsed
    session.provider = result.meta.provider
    session.model = result.meta.model
    session.usingRealAdapter = result.meta.usingRealAdapter
    await session.save()
  }

  /**
   * 单条事件持久化。语义事件使用单调递增 sequence。心跳只用于当前连接保活，
   * 不进入恢复事件表，也不推进 Last-Event-ID cursor。返回分配的 sequence。
   */
  async appendEvent(session: AiProjectDraft, event: ProjectDraftStreamEvent): Promise<number> {
    if (event.type === 'draft.heartbeat') {
      return event.sequence
    }

    const lastSeq = await this.maxSequence(session.id)
    const sequence = lastSeq + 1
    const payload = { ...event, sequence }

    await AiProjectDraftEvent.create({
      draftId: session.id,
      sequence,
      version: event.version,
      type: event.type,
      payload,
    })

    // 调用方随后会把同一个对象交给实时 runner；必须使用数据库实际分配的
    // sequence，不能继续发送构造时的占位值。
    event.sequence = sequence
    return sequence
  }

  /** 首次生成：建会话 + 版本1（成功时）+ 事件序列。 */
  async createFromGeneration(args: CreateFromGenerationArgs): Promise<DraftSessionWithEvents> {
    const { result } = args
    const draftUid = randomUUID()
    const completed = result.status === 'completed' && result.draft !== null
    const status: ProjectDraftSessionStatus = completed ? 'reviewing' : 'error'

    const session = await AiProjectDraft.create({
      draftUid,
      organizationId: args.organizationId,
      userId: args.userId,
      projectType: args.projectType,
      status,
      schemaVersion: result.meta.schemaVersion,
      currentVersion: 1,
      structuredStrategy: result.meta.structuredStrategy,
      consistency: result.consistency,
      fallbackUsed: result.meta.fallbackUsed,
      provider: result.meta.provider,
      model: result.meta.model,
      usingRealAdapter: result.meta.usingRealAdapter,
      projectId: null,
      generationCheckpoint: !completed && result.meta ? buildCheckpointFromMeta(result.meta) : null,
    })

    if (completed) {
      await AiProjectDraftVersion.create({
        draftId: session.id,
        version: 1,
        origin: 'generated',
        status: 'active',
        draft: result.draft!,
        meta: result.meta,
        validation: args.validation,
      })
    }

    const events = buildDraftStreamEvents({
      draftUid,
      version: 1,
      projectType: args.projectType,
      result,
      validation: args.validation,
    })
    await this.persistEvents(session.id, events)

    return { session, events }
  }

  /**
   * 流式重试完成：版本 +1、supersede 旧 active、会话字段复位。
   * 事件已由流式路径逐条 appendEvent 持久化，本方法不再重建/续接事件序列
   * （否则会整批重复落库）。
   */
  async completeRetryGeneration(
    session: AiProjectDraft,
    args: { result: GenerateDraftResult; validation: DraftValidationReport | null },
  ): Promise<void> {
    const { result } = args
    const completed = result.status === 'completed' && result.draft !== null
    const nextVersion = session.currentVersion + 1

    if (completed) {
      await AiProjectDraftVersion.query()
        .where('draft_id', session.id)
        .where('status', 'active')
        .update({ status: 'superseded' })
      await AiProjectDraftVersion.create({
        draftId: session.id,
        version: nextVersion,
        origin: 'generated',
        status: 'active',
        draft: result.draft!,
        meta: result.meta,
        validation: args.validation,
      })
    } else if (!session.generationCheckpoint && result.meta) {
      session.generationCheckpoint = buildCheckpointFromMeta(result.meta)
    }

    session.currentVersion = nextVersion
    session.status = completed ? 'reviewing' : 'error'
    session.consistency = result.consistency
    session.structuredStrategy = result.meta.structuredStrategy
    session.fallbackUsed = result.meta.fallbackUsed
    session.usingRealAdapter = result.meta.usingRealAdapter
    await session.save()
  }

  /** 保存为草稿：状态置 saved（不写正式表）。 */
  async save(session: AiProjectDraft): Promise<AiProjectDraft> {
    session.status = 'saved'
    await session.save()
    return session
  }

  /** 拒绝：状态置 rejected，活动版本标记 rejected（保留上下文，可重试）。 */
  async reject(session: AiProjectDraft): Promise<AiProjectDraft> {
    session.status = 'rejected'
    await session.save()
    await AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .update({ status: 'rejected' })
    return session
  }

  async setStatus(session: AiProjectDraft, status: ProjectDraftSessionStatus): Promise<void> {
    session.status = status
    await session.save()
  }

  /** 保存生成阶段断点（低敏：已验证产物 + 预算/版本元数据）。 */
  async saveCheckpoint(
    session: AiProjectDraft,
    checkpoint: ProjectDraftPipelineCheckpoint,
  ): Promise<void> {
    session.generationCheckpoint = checkpoint
    await session.save()
  }

  /** 读取最近一次生成断点；无则 null。 */
  async loadCheckpoint(session: AiProjectDraft): Promise<ProjectDraftPipelineCheckpoint | null> {
    return session.generationCheckpoint ?? null
  }

  /** 判断是否为孤儿生成中会话：drafting 状态、无活跃 runner、无有效版本。 */
  async isOrphanSession(session: AiProjectDraft): Promise<boolean> {
    if (session.status !== 'drafting') return false
    const version = await this.activeVersion(session)
    return version === null
  }

  /** 组织隔离 + user 归属查询；跨组织/他人草案返回 null（controller 转 RESOURCE_NOT_FOUND）。 */
  async findForUser(
    draftUid: string,
    organizationId: number,
    userId: number,
  ): Promise<AiProjectDraft | null> {
    const rows = await TenantScope.forOrganization(
      AiProjectDraft.query().where('draft_uid', draftUid).where('user_id', userId),
      organizationId,
    )
    return rows[0] ?? null
  }

  /** 当前活动版本（无则 null）。 */
  async activeVersion(session: AiProjectDraft): Promise<AiProjectDraftVersion | null> {
    return AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .orderBy('version', 'desc')
      .first()
  }

  /** 组装 ProjectDraftDetail（含全部持久化事件，供断点恢复）。 */
  async getDetail(
    session: AiProjectDraft,
    options: { generationRunning?: boolean } = {},
  ): Promise<ProjectDraftDetail> {
    const version = await this.activeVersion(session)
    const eventRows = await AiProjectDraftEvent.query()
      .where('draft_id', session.id)
      .orderBy('sequence', 'asc')
    const events = eventRows.map((event) => event.payload)
    const failedEvent = [...events]
      .reverse()
      .find(
        (event): event is Extract<ProjectDraftStreamEvent, { type: 'draft.failed' }> =>
          event.type === 'draft.failed',
      )
    const checkpointFailure = session.generationCheckpoint?.failedStage
    let failureDetail: ProjectDraftFailureDetail | null = null

    if (session.status === 'error') {
      if (failedEvent) {
        failureDetail = {
          errorCode: failedEvent.errorCode,
          message: failedEvent.message,
          consistency: failedEvent.consistency,
          sequence: failedEvent.sequence,
          stage: failedEvent.stage ?? checkpointFailure?.stage,
          reasonCode:
            failedEvent.reasonCode ?? checkpointFailure?.errorCodes?.[0] ?? failedEvent.errorCode,
          errors:
            failedEvent.errors ??
            checkpointFailure?.validationResult?.errors?.map((err) => ({
              path: err.path,
              message: err.message,
            })),
        }
      } else if (checkpointFailure) {
        failureDetail = {
          errorCode: checkpointFailure.errorCodes[0] ?? 'AI_SERVICE_ERROR',
          message: '草案阶段生成失败，请根据当前输入重试。',
          consistency: 'failed',
          sequence: 0,
          stage: checkpointFailure.stage,
          reasonCode: checkpointFailure.errorCodes[0] ?? 'AI_SERVICE_ERROR',
          errors: checkpointFailure.validationResult?.errors?.map((err) => ({
            path: err.path,
            message: err.message,
          })),
        }
      }
    }

    return {
      draftId: session.draftUid,
      version: session.currentVersion,
      status: session.status as ProjectDraftSessionStatus,
      generationState:
        session.status === 'drafting'
          ? options.generationRunning
            ? 'running'
            : 'orphaned'
          : 'settled',
      projectType: session.projectType,
      draft: version?.draft ?? null,
      meta: version?.meta ?? null,
      validation: version?.validation ?? null,
      events,
      failure: failureDetail,
    }
  }

  /** 读 sequence > cursor 的事件（Last-Event-ID 幂等恢复）。 */
  async eventsAfter(session: AiProjectDraft, cursor: number): Promise<ProjectDraftStreamEvent[]> {
    const rows = await AiProjectDraftEvent.query()
      .where('draft_id', session.id)
      .where('sequence', '>', cursor)
      .orderBy('sequence', 'asc')
    return rows.map((e) => e.payload)
  }

  /** 返回指定 draft 的最小 sequence 号（无事件时返回 null）。§6.4 reset-required 检测用。 */
  async minSequence(draftId: number): Promise<number | null> {
    const row = await AiProjectDraftEvent.query()
      .where('draft_id', draftId)
      .orderBy('sequence', 'asc')
      .first()
    return row?.sequence ?? null
  }

  /** 检查指定 sequence 是否存在。§6.4 reset-required 检测用。 */
  async hasSequence(draftId: number, sequence: number): Promise<boolean> {
    const row = await AiProjectDraftEvent.query()
      .where('draft_id', draftId)
      .where('sequence', sequence)
      .first()
    return row !== null
  }

  private async maxSequence(draftId: number): Promise<number> {
    const row = await AiProjectDraftEvent.query()
      .where('draft_id', draftId)
      .orderBy('sequence', 'desc')
      .first()
    return row?.sequence ?? 0
  }

  private async persistEvents(draftId: number, events: ProjectDraftStreamEvent[]): Promise<void> {
    if (events.length === 0) return
    await AiProjectDraftEvent.createMany(
      events.map((e) => ({
        draftId,
        sequence: e.sequence,
        version: e.version,
        type: e.type,
        payload: e,
      })),
    )
  }
}
