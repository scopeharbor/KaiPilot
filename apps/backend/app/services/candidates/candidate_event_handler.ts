/**
 * v2-5-code-repository-auto-linking —— 事件到候选的集成处理器。
 *
 * 组合 adapter、提取器、resolver 与候选 Service，
 * 确保事件处理只生成候选且不调用正式外链创建/refresh 或任何 provider 写请求。
 *
 * 设计 D1/D6:
 * - 只消费已验证的低敏事件
 * - 只生成候选，不创建正式外链
 * - 不触发 provider refresh
 * - 不修改任务事实
 */

import type { RepositoryReferenceEvent } from '@aiproj/types'
import { GitHubEventAdapter, type AdapterResult } from './github_event_adapter.js'
import CandidateService from './candidate_service.js'
import { TaskReferenceResolver } from './task_reference_resolver.js'
import { isLinkCandidateEnabled } from './link_candidate_feature.js'

// ---------------------------------------------------------------------------
// 事件处理结果
// ---------------------------------------------------------------------------

export interface EventProcessingResult {
  /** 是否生成了候选 */
  createdCandidate: boolean
  /** 生成/跳过的候选 ID */
  candidateId?: number
  /** 适配器结果代码 */
  adapterCode: AdapterResult['code']
  /** 适配器消息 */
  message: string
  /** 任务引用 */
  taskReference?: string
}

// ---------------------------------------------------------------------------
// 事件处理器
// ---------------------------------------------------------------------------

export class CandidateEventHandler {
  constructor(
    private adapter: GitHubEventAdapter = new GitHubEventAdapter(),
    private candidateService: CandidateService = new CandidateService(),
    private resolver: TaskReferenceResolver = new TaskReferenceResolver(),
  ) {}

  /**
   * 处理 RepositoryReferenceEvent 并生成候选。
   * 仅在 feature flag 启用时处理。
   *
   * @param event 已验证的低敏事件
   * @param authorizedOrgs 授权组织列表
   * @param projectId 项目 ID（候选归属）
   * @returns 处理结果
   */
  async handle(
    event: RepositoryReferenceEvent,
    authorizedOrgs: number[],
    projectId?: number,
  ): Promise<EventProcessingResult> {
    // 1. Feature flag 检查
    if (!isLinkCandidateEnabled()) {
      return {
        createdCandidate: false,
        adapterCode: 'unauthorized_org',
        message: '候选生成已禁用（LINK_CANDIDATE_ENABLED=false）',
      }
    }

    // 2. 通过适配器验证事件
    const adapterResult = this.adapter.process(event, authorizedOrgs)

    if (adapterResult.code !== 'accepted' || !adapterResult.taskReference) {
      return {
        createdCandidate: false,
        adapterCode: adapterResult.code,
        message: adapterResult.message,
      }
    }

    const taskReference = adapterResult.taskReference

    // 3. 尝试解析任务引用（如果有项目上下文）
    let taskId: number | null = null
    let taskTitle: string | null = null
    if (projectId) {
      const resolvedTask = await this.resolver.resolve(
        event.organizationId,
        taskReference,
        projectId,
      )
      if (resolvedTask.matched) {
        taskId = resolvedTask.taskId ?? null
        taskTitle = resolvedTask.taskName ?? null
      }
    }

    // 4. 创建候选 — 纯持久化，不创建外链、不刷新、不写任务
    const objectType =
      event.eventType === 'pull_request'
        ? 'pull_request'
        : event.eventType === 'branch'
          ? 'branch'
          : 'commit'

    const objectId =
      event.eventType === 'pull_request'
        ? String(event.pullRequestNumber ?? '')
        : event.eventType === 'branch'
          ? (event.branchRef ?? '')
          : (event.commitSha ?? '')

    try {
      const candidate = await this.candidateService.create({
        organizationId: event.organizationId,
        provider: event.provider,
        repositoryFullName: event.repositoryFullName,
        repositoryExternalId: event.repositoryExternalId,
        eventType: event.eventType,
        deliveryId: event.deliveryId,
        objectType,
        objectId,
        taskReference,
        taskId: taskId ?? undefined,
        taskTitle: taskTitle ?? undefined,
        confidenceClass: 'high',
        evidences:
          adapterResult.evidences?.map((e) => ({
            sourceField: e.sourceField as any,
            matchedPreview: e.matchedPreview,
            ruleVersion: e.ruleVersion,
          })) ?? [],
      })

      return {
        createdCandidate: true,
        candidateId: candidate.id,
        adapterCode: 'accepted',
        message: adapterResult.message,
        taskReference,
      }
    } catch (error: any) {
      // 幂等冲突 — 候选已存在
      return {
        createdCandidate: false,
        adapterCode: 'accepted',
        message: `候选已存在: ${(error as Error).message}`,
        taskReference,
      }
    }
  }
}
