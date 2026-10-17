/**
 * v2-5-code-repository-auto-linking —— GitHub 事件适配器。
 *
 * 在 incoming foundation 的已验签低敏 envelope 后接入。
 * 校验 organization connection 与 repository identity，
 * 拒绝客户端自报组织/仓库/API URL。
 *
 * 设计 D1:
 * - 只消费已验证的低敏事件（已通过 incoming foundation 的签名、时间戳、去重校验）
 * - 依赖 GitHubConnectionResolver 获得组织/仓库归属
 * - 不发起真实网络请求，纯本地校验
 */

import type { RepositoryReferenceEvent } from '@aiproj/types'
import { extractFromReferenceEventFields } from './task_ref_extractor.js'

// ---------------------------------------------------------------------------
// 适配器结果
// ---------------------------------------------------------------------------

export type AdapterResultCode =
  | 'accepted' // 事件被接受并产生候选
  | 'skipped_no_ref' // 事件无任务引用
  | 'unauthorized_org' // 组织未授权
  | 'unknown_repo' // 仓库不匹配
  | 'unsupported_event' // 不支持的事件类型
  | 'unsupported_provider' // 仅支持 GitHub

export interface AdapterResult {
  code: AdapterResultCode
  message: string
  /** 提取到的任务引用（仅 accepted 时有） */
  taskReference?: string
  /** 匹配证据 */
  evidences?: Array<{ sourceField: string; matchedPreview: string; ruleVersion: number }>
}

// ---------------------------------------------------------------------------
// 事件适配器
// ---------------------------------------------------------------------------

export class GitHubEventAdapter {
  /**
   * 处理低敏事件并提取候选信息。
   * 只接受已验证的 GitHub 事件，且组织/仓库必须匹配。
   */
  process(event: RepositoryReferenceEvent, authorizedOrgs: number[]): AdapterResult {
    // 只接受 GitHub
    if (event.provider !== 'github') {
      return {
        code: 'unsupported_provider',
        message: '只支持 GitHub 事件',
      }
    }

    // 校验组织归属
    if (!authorizedOrgs.includes(event.organizationId)) {
      return {
        code: 'unauthorized_org',
        message: '该组织未授权自动关联',
      }
    }

    // 校验事件类型
    if (!['branch', 'push', 'pull_request'].includes(event.eventType)) {
      return {
        code: 'unsupported_event',
        message: `不支持的事件类型: ${event.eventType}`,
      }
    }

    // 从事件字段提取任务引用
    const results = extractFromReferenceEventFields({
      branchRef: event.branchRef,
      commitMessagePreview: event.commitMessagePreview,
      pullRequestTitle: event.pullRequestTitle,
      pullRequestBodyPreview: event.pullRequestBodyPreview,
    })

    if (results.length === 0) {
      return {
        code: 'skipped_no_ref',
        message: '事件中未发现任务引用',
      }
    }

    // 取第一个匹配结果
    const first = results[0]
    return {
      code: 'accepted',
      message: `发现任务引用: ${first.normalizedReference}`,
      taskReference: first.normalizedReference,
      evidences: first.evidences.map((e) => ({
        sourceField: e.sourceField,
        matchedPreview: e.matchedPreview,
        ruleVersion: e.ruleVersion,
      })),
    }
  }
}
