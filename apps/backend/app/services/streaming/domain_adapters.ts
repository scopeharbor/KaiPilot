/**
 * domain_adapters —— Streaming WebSocket Service domain 授权适配器（design D2/D4）。
 *
 * 为 AI Draft、Compiler run/stage event、Code Generation 提供基于现有
 * RBAC、组织隔离和成员关系的 stream 授权。
 *
 * 设计 D2：Stream channel 使用 domain-scoped room，不暴露跨组织全局 channel。
 * 设计 D4：Resume 以 cursor replay 优先。
 */

import logger from '@adonisjs/core/services/logger'
import { registerDomainAdapter } from '#services/streaming/streaming_ws_service'
import type { DomainAuthorizationAdapter, DomainAuthorizationResult } from '@aiproj/types'

// =============================================================================
// AI Draft Domain Adapter
// =============================================================================

/**
 * AI Draft 领域的流授权适配器。
 *
 * 验证逻辑：
 * 1. 用户属于目标组织
 * 2. streamId 对应的 draft 属于该组织
 * 3. 用户对 draft 有查看权限
 */
export class AiDraftDomainAdapter implements DomainAuthorizationAdapter {
  domain = 'ai-draft' as const

  async authorize(
    userId: number,
    organizationId: number,
    streamId: string,
  ): Promise<DomainAuthorizationResult> {
    try {
      const draftId = streamId
      if (!draftId) {
        return {
          allowed: false,
          reasonCode: 'INVALID_DRAFT_ID',
          reasonMessage: 'Draft ID is missing.',
        }
      }

      const { default: AiProjectDraft } = await import('#models/ai_project_draft')
      const { default: User } = await import('#models/user')

      const user = await User.find(userId)
      if (!user) {
        return { allowed: false, reasonCode: 'USER_NOT_FOUND', reasonMessage: 'User not found.' }
      }

      // v3-multitenant-database-isolation §5.2：按组织 scope 解析，跨组织与不存在
      // 返回**完全相同**的 DRAFT_NOT_FOUND。原实现先无 scope find 再比较组织并回
      // CROSS_ORGANIZATION_DENIED，两个 reasonCode 的差异本身就泄露「该 draft 存在于别的组织」。
      const draft = await AiProjectDraft.query()
        .where('id', draftId)
        .where('organization_id', organizationId)
        .first()
      if (!draft) {
        return {
          allowed: false,
          reasonCode: 'DRAFT_NOT_FOUND',
          reasonMessage: 'Draft not found.',
        }
      }

      try {
        const { default: RbacService } = await import('#services/rbac_service')
        const rbacService = new RbacService()
        const result = await rbacService.check(
          user,
          'project:view' as never,
          organizationId,
          (draft as any).projectId as number | undefined,
        )
        if (!result.allowed) {
          return {
            allowed: false,
            reasonCode: 'PERMISSION_DENIED',
            reasonMessage: 'No permission to view this draft.',
          }
        }
      } catch {
        return {
          allowed: false,
          reasonCode: 'AUTHORIZATION_ERROR',
          reasonMessage: 'Authorization check failed.',
        }
      }

      return { allowed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      logger.warn({ userId, streamId, error: message }, 'AI Draft authorization adapter 异常')
      return {
        allowed: false,
        reasonCode: 'AUTHORIZATION_ERROR',
        reasonMessage: 'Authorization check failed.',
      }
    }
  }
}

// =============================================================================
// Compiler Domain Adapter
// =============================================================================

export class CompilerDomainAdapter implements DomainAuthorizationAdapter {
  domain = 'compiler' as const

  async authorize(
    userId: number,
    organizationId: number,
    streamId: string,
  ): Promise<DomainAuthorizationResult> {
    try {
      const runId = streamId
      if (!runId) {
        return {
          allowed: false,
          reasonCode: 'INVALID_RUN_ID',
          reasonMessage: 'Compiler run ID is missing.',
        }
      }

      // 纯输入校验必须在加载数据层之前：否则非法 runId 也要先 import 模型，
      // 模型加载失败会被外层 catch 吞成 AUTHORIZATION_ERROR，掩盖真正的 INVALID_RUN_ID。
      const runNumericId = Number(runId)
      if (!Number.isFinite(runNumericId)) {
        return {
          allowed: false,
          reasonCode: 'INVALID_RUN_ID',
          reasonMessage: 'Compiler run ID must be numeric.',
        }
      }

      const { default: CompilerRun } = await import('#models/compiler_run')
      const { default: User } = await import('#models/user')

      const user = await User.find(userId)
      if (!user) {
        return { allowed: false, reasonCode: 'USER_NOT_FOUND', reasonMessage: 'User not found.' }
      }

      // v3-multitenant-database-isolation §5.2：同上——scope 内解析，跨组织与不存在同形。
      const run = await CompilerRun.query()
        .where('id', runNumericId)
        .where('organization_id', organizationId)
        .first()
      if (!run) {
        return {
          allowed: false,
          reasonCode: 'RUN_NOT_FOUND',
          reasonMessage: 'Compiler run not found.',
        }
      }

      try {
        const { default: RbacService } = await import('#services/rbac_service')
        const rbacService = new RbacService()
        const result = await rbacService.check(
          user,
          'project:view' as never,
          organizationId,
          (run as any).projectId as number | undefined,
        )
        if (!result.allowed) {
          return {
            allowed: false,
            reasonCode: 'PERMISSION_DENIED',
            reasonMessage: 'No permission to view this compiler run.',
          }
        }
      } catch {
        return {
          allowed: false,
          reasonCode: 'AUTHORIZATION_ERROR',
          reasonMessage: 'Authorization check failed.',
        }
      }

      return { allowed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      logger.warn({ userId, streamId, error: message }, 'Compiler authorization adapter 异常')
      return {
        allowed: false,
        reasonCode: 'AUTHORIZATION_ERROR',
        reasonMessage: 'Authorization check failed.',
      }
    }
  }
}

// =============================================================================
// Code Generation Domain Adapter
// =============================================================================

export class CodeGenerationDomainAdapter implements DomainAuthorizationAdapter {
  domain = 'code-generation' as const

  async authorize(
    userId: number,
    organizationId: number,
    _streamId: string,
  ): Promise<DomainAuthorizationResult> {
    try {
      const { default: User } = await import('#models/user')
      const user = await User.find(userId)
      if (!user) {
        return { allowed: false, reasonCode: 'USER_NOT_FOUND', reasonMessage: 'User not found.' }
      }

      if (!organizationId || organizationId < 1) {
        return {
          allowed: false,
          reasonCode: 'INVALID_ORGANIZATION',
          reasonMessage: 'Invalid organization.',
        }
      }

      return { allowed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      logger.warn({ userId, error: message }, 'Code generation authorization adapter 异常')
      return {
        allowed: false,
        reasonCode: 'AUTHORIZATION_ERROR',
        reasonMessage: 'Authorization check failed.',
      }
    }
  }
}

// =============================================================================
// 注册所有 domain adapter
// =============================================================================

export function registerAllDomainAdapters(): void {
  registerDomainAdapter(new AiDraftDomainAdapter())
  registerDomainAdapter(new CompilerDomainAdapter())
  registerDomainAdapter(new CodeGenerationDomainAdapter())
  logger.info('所有 Streaming WebSocket Service domain adapters 已注册')
}
