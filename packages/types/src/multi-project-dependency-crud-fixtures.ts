/**
 * multi-project-dependency-crud 测试夹具
 *
 * 覆盖规范要求的 visible、restricted、cross-organization、stale-preview、
 * duplicate、cycle、archive、restore、delete、idempotent-retry、
 * feature-disabled 和 mobile-list 场景。
 */

import type {
  DepListItem,
  DepDetail,
  DepListResponse,
  DepPreviewSnapshot,
  DepConfirmRequest,
  DepConfirmResult,
  DepAuditSummary,
  DepEndpointSummary,
  DepCreatePreviewInput,
  DepUpdatePreviewInput,
  DepFeatureDisabledResponse,
} from './multi-project-dependency-crud.js'
import type { MultiProjectEndpointRef } from './multi-project-dependency-model.js'

// ─── 固定 organization/user ─────────────────────────────────────

export const FIXTURE_ORG = 'org-fixture-1'
const FIXTURE_MPD_ORG_ID = 1
export const FIXTURE_USER = 'user-fixture-pmo'
export const FIXTURE_READONLY_USER = 'user-fixture-readonly'
export const FIXTURE_EXTERNAL_USER = 'user-fixture-external'

// ─── 端点 fixture builders ─────────────────────────────────────

export function visibleEndpoint(
  type: 'project' | 'milestone' | 'task',
  id: string,
): DepEndpointSummary {
  return {
    type,
    id,
    projectId: 'proj-visible',
    projectName: '可见项目',
    label: `${type}-${id}`,
    isRedacted: false,
  }
}

export function visibleEndpointRef(
  type: 'project' | 'milestone' | 'task',
  id: string | number,
): MultiProjectEndpointRef {
  return {
    endpointType: type,
    projectId: 1,
    projectName: '可见项目',
    milestoneId: type === 'milestone' ? (typeof id === 'number' ? id : 10) : null,
    milestoneName: type === 'milestone' ? `milestone-${id}` : null,
    taskId: type === 'task' ? (typeof id === 'number' ? id : 100) : null,
    taskName: type === 'task' ? `task-${id}` : null,
    externalLabel: null,
    externalKey: null,
    redacted: false,
    redactionReason: null,
  }
}

export function redactedEndpoint(
  type: 'project' | 'milestone' | 'task',
  id: string,
): DepEndpointSummary {
  return {
    type,
    id,
    projectId: '',
    projectName: '',
    label: 'REDACTED',
    isRedacted: true,
  }
}

export function redactedEndpointRef(
  type: 'project' | 'milestone' | 'task',
  _id: string | number,
): MultiProjectEndpointRef {
  return {
    endpointType: type,
    projectId: null,
    projectName: null,
    milestoneId: null,
    milestoneName: null,
    taskId: null,
    taskName: null,
    externalLabel: null,
    externalKey: null,
    redacted: true,
    redactionReason: 'PERMISSION_DENIED',
  }
}

export function manualExternalEndpoint(ref: string): DepEndpointSummary {
  return {
    type: 'manual_external',
    id: `ext-${ref}`,
    projectId: '',
    projectName: '',
    label: ref,
    isRedacted: false,
  }
}

// ─── 可见依赖列表项 ────────────────────────────────────────────

export function visibleDepListItem(
  id: number | string,
  overrides?: Partial<DepListItem>,
): DepListItem {
  const numericId = typeof id === 'number' ? id : parseInt(String(id).replace(/\D/g, '') || '1', 10)
  return {
    id: numericId,
    organizationId: FIXTURE_MPD_ORG_ID,
    providerEndpoint: visibleEndpointRef('task', `provider-${id}`),
    consumerEndpoint: visibleEndpointRef('task', `consumer-${id}`),
    category: 'deliverable',
    type: 'fs',
    lagDays: 0,
    strength: 'hard',
    bufferDays: 5,
    status: 'active',
    riskLevel: 'low',
    ownerUserId: 1,
    sourceMode: 'manual',
    sourceSuggestionId: null,
    evidenceRefs: [],
    freshnessSignature: 'fresh-001',
    freshnessCheckedAt: '2026-07-01T00:00:00Z',
    freshnessStatus: 'fresh',
    confirmationHash: null,
    idempotencyKey: null,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-15T00:00:00Z',
    archivedAt: null,
    warningCodes: [],
    ...overrides,
  }
}

// ─── 受限端点依赖 ──────────────────────────────────────────────

export function restrictedDepListItem(id: number | string): DepListItem {
  return visibleDepListItem(id, {
    consumerEndpoint: redactedEndpointRef('task', `consumer-${id}`),
    warningCodes: ['ENDPOINT_REDACTED'],
  })
}

// ─── 依赖详情 ───────────────────────────────────────────────────

export function visibleDepDetail(id: number | string, overrides?: Partial<DepDetail>): DepDetail {
  return {
    ...visibleDepListItem(id),
    evidenceRefs: [
      {
        type: 'manual_note',
        summary: '存在项目例会记录中的交付依赖',
        freshness: 'fresh',
      },
    ],
    ...overrides,
  }
}

// ─── 列表响应 ───────────────────────────────────────────────────

export function depListResponse(
  items: DepListItem[],
  overrides?: Partial<DepListResponse['meta']>,
): DepListResponse {
  return {
    data: items,
    meta: {
      total: items.length,
      page: 1,
      perPage: 20,
      totalPages: 1,
      ...overrides,
    },
  }
}

// ─── Create 预览输入 ────────────────────────────────────────────

export function validCreatePreviewInput(
  overrides?: Partial<DepCreatePreviewInput>,
): DepCreatePreviewInput {
  return {
    providerEndpointType: 'task',
    providerTaskId: 1,
    consumerEndpointType: 'task',
    consumerTaskId: 2,
    category: 'deliverable',
    type: 'fs',
    lagDays: 0,
    strength: 'hard',
    bufferDays: 5,
    riskLevel: 'low',
    sourceMode: 'manual',
    ...overrides,
  }
}

export function duplicateCreatePreviewInput(): DepCreatePreviewInput {
  return validCreatePreviewInput({
    providerTaskId: 11,
    consumerTaskId: 12,
  })
}

export function selfDependencyCreatePreviewInput(): DepCreatePreviewInput {
  return validCreatePreviewInput({
    providerTaskId: 1,
    consumerTaskId: 1,
  })
}

export function crossOrgCreatePreviewInput(): DepCreatePreviewInput {
  return validCreatePreviewInput({
    providerTaskId: 21,
  })
}

// ─── Update 预览输入 ────────────────────────────────────────────

export function validUpdatePreviewInput(dependencyId: number): DepUpdatePreviewInput {
  return {
    dependencyId,
    category: 'technical',
    bufferDays: 10,
  }
}

// ─── 预览快照 ───────────────────────────────────────────────────

export function validPreviewSnapshot(overrides?: Partial<DepPreviewSnapshot>): DepPreviewSnapshot {
  return {
    previewId: 'preview-001',
    operation: 'preview_create',
    organizationId: FIXTURE_ORG,
    providerSummary: visibleEndpoint('task', 't-provider-1'),
    consumerSummary: visibleEndpoint('task', 't-consumer-1'),
    proposedDiff: {
      category: { from: null, to: 'deliverable' },
      type: { from: null, to: 'FS' },
    },
    warnings: [],
    isRedacted: false,
    freshnessSignature: 'fresh-001',
    confirmationHash: 'abcd1234',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    idempotencyGuidance: '需提供幂等键',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function stalePreviewSnapshot(): DepPreviewSnapshot {
  return validPreviewSnapshot({
    warnings: ['STALE_PREVIEW'],
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
  })
}

export function cyclePreviewSnapshot(): DepPreviewSnapshot {
  return validPreviewSnapshot({
    warnings: ['CYCLE_DETECTED'],
  })
}

export function duplicatePreviewSnapshot(): DepPreviewSnapshot {
  return validPreviewSnapshot({
    warnings: ['DUPLICATE_ACTIVE_KEY'],
  })
}

// ─── 确认请求 ───────────────────────────────────────────────────

export function validConfirmRequest(overrides?: Partial<DepConfirmRequest>): DepConfirmRequest {
  return {
    previewId: 'preview-001',
    confirmationHash: 'abcd1234',
    idempotencyKey: 'idem-key-001',
    ...overrides,
  }
}

// ─── 确认结果 ───────────────────────────────────────────────────

export function validConfirmResult(depId: number | string): DepConfirmResult {
  return {
    dependency: visibleDepDetail(depId),
    auditEventId: 'audit-001',
    isReplay: false,
  }
}

export function replayConfirmResult(depId: number | string): DepConfirmResult {
  return {
    ...validConfirmResult(depId),
    isReplay: true,
  }
}

// ─── 审计摘要 ───────────────────────────────────────────────────

export function depAuditSummary(overrides?: Partial<DepAuditSummary>): DepAuditSummary {
  return {
    actorId: FIXTURE_USER,
    organizationId: FIXTURE_ORG,
    operation: 'confirm_create',
    queryHash: 'query-hash-001',
    dependencyId: 'dep-001',
    endpointHashes: ['ephash1', 'ephash2'],
    warningCodes: [],
    freshnessHash: 'fresh-001',
    confirmationHash: 'abcd1234',
    idempotencyKeyHash: 'idemhash01',
    statusTransition: 'none->active',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

// ─── 特性开关禁用响应 ─────────────────────────────────────────

export function featureDisabledResponse(): DepFeatureDisabledResponse {
  return {
    error: {
      code: 'FEATURE_DISABLED',
      message: '跨项目依赖 CRUD 功能未启用',
      details: { feature: 'multi-project-dependency-crud' },
    },
  }
}

// ─── 移动端列表 fixtures ───────────────────────────────────────

export function mobileListItems(count: number): DepListItem[] {
  return Array.from({ length: count }, (_, i) => visibleDepListItem(i + 1))
}

// ─── 归档/恢复/删除 fixtures ──────────────────────────────────

export function archivedDepDetail(id: number | string): DepDetail {
  return visibleDepDetail(id, { status: 'archived' })
}

export function deletedDepDetail(id: number | string): DepDetail {
  return visibleDepDetail(id, { status: 'archived' })
}

// ─── 大量图 fixtures ────────────────────────────────────────────

export function largeDepList(count: number): DepListItem[] {
  return Array.from({ length: count }, (_, i) =>
    visibleDepListItem(i + 1, {
      type: i % 2 === 0 ? 'fs' : 'ss',
      category: ['deliverable', 'resource', 'technical', 'schedule'][i % 4] as any,
      riskLevel: ['low', 'medium', 'high'][i % 3] as any,
    }),
  )
}
