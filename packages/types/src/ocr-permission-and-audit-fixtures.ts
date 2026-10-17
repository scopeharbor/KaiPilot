/**
 * OCR Permission & Audit — 测试夹具构建器（v3-ocr-permission-and-audit §2.9）
 *
 * 提供角色、OCR 来源、任务、已接受提取、保留状态、隐私决策、
 * 陈旧哈希、被拒决策与审计摘要的确定性夹具。默认不调用真实 OCR provider。
 */

import {
  buildDecisionSnapshot,
  computeAuditSummaryHash,
  computeContentHash,
  computeDecisionHash,
  computeSourceRefHash,
  type OcrActorRef,
  type OcrArtifactRef,
  type OcrAuthorizationDecisionSnapshot,
  type OcrAuditSummary,
  type OcrDecisionPreview,
  type OcrOrganizationRef,
  type OcrPermissionAction,
  type OcrPermissionDecisionResult,
  type OcrPermissionReasonCode,
  type OcrPermissionStatus,
  type OcrProjectRef,
  type OcrSourceRef,
  resolveActionMapping,
} from './ocr-permission-and-audit.js'

const FIXED_NOW = '2026-08-03T00:00:00.000Z'
const FIXED_ORG = 1
const FIXED_PROJECT = 10

// ─── 引用 ────────────────────────────────────────────────────────────────────

export function buildActorRef(overrides: Partial<OcrActorRef> = {}): OcrActorRef {
  return { type: 'user', id: 100, ...overrides }
}

export function buildOrganizationRef(
  overrides: Partial<OcrOrganizationRef> = {},
): OcrOrganizationRef {
  return { type: 'organization', id: FIXED_ORG, ...overrides }
}

export function buildProjectRef(overrides: Partial<OcrProjectRef> = {}): OcrProjectRef {
  return { type: 'project', id: FIXED_PROJECT, ...overrides }
}

export function buildSourceRef(overrides: Partial<OcrSourceRef> = {}): OcrSourceRef {
  return { type: 'ocr_source', id: 1, kind: 'attachment', ...overrides }
}

export function buildArtifactRef(overrides: Partial<OcrArtifactRef> = {}): OcrArtifactRef {
  return { type: 'ocr_artifact', id: 1, kind: 'accepted_extraction', ...overrides }
}

// ─── 角色 ────────────────────────────────────────────────────────────────────

export interface OcrRoleFixture {
  readonly role: string
  readonly roleVersion: number
  readonly permissions: readonly string[]
}

const PROJECT_MANAGER_PERMISSIONS = [
  'ocr_document:view',
  'ocr:review',
  'ocr:confirm',
  'ocr_provider_observability:manage',
  'ocr_retention:hold',
  'ocr_retention:cleanup',
  'ocr_search_index:view',
  'ocr_search_index:manage',
  'ocr_structured_extraction:run',
  'ocr_entity_link:run',
  'ocr_entity_link:explain',
  'ocr_privacy:copy',
  'ocr_privacy:export',
  'ocr_permission_audit:view_status',
  'ocr_permission_audit:audit_read',
]

const MEMBER_PERMISSIONS = [
  'ocr_document:view',
  'ocr:review',
  'ocr_search_index:view',
  'ocr_structured_extraction:run',
  'ocr_entity_link:run',
  'ocr_permission_audit:view_status',
]

const READONLY_PERMISSIONS = ['ocr_document:view', 'ocr_permission_audit:view_status']

export function buildProjectManagerRole(overrides: Partial<OcrRoleFixture> = {}): OcrRoleFixture {
  return {
    role: 'PROJECT_MANAGER',
    roleVersion: 3,
    permissions: PROJECT_MANAGER_PERMISSIONS,
    ...overrides,
  }
}

export function buildMemberRole(overrides: Partial<OcrRoleFixture> = {}): OcrRoleFixture {
  return { role: 'MEMBER', roleVersion: 3, permissions: MEMBER_PERMISSIONS, ...overrides }
}

export function buildReadonlyObserverRole(overrides: Partial<OcrRoleFixture> = {}): OcrRoleFixture {
  return {
    role: 'READONLY_OBSERVER',
    roleVersion: 3,
    permissions: READONLY_PERMISSIONS,
    ...overrides,
  }
}

export function buildExternalCollaboratorRole(
  overrides: Partial<OcrRoleFixture> = {},
): OcrRoleFixture {
  return {
    role: 'EXTERNAL_COLLABORATOR',
    roleVersion: 3,
    permissions: ['ocr_document:view'],
    ...overrides,
  }
}

// ─── 决策输入 ────────────────────────────────────────────────────────────────

export interface OcrDecisionFixtureInput {
  readonly action?: OcrPermissionAction
  readonly result?: OcrPermissionDecisionResult
  readonly reasonCodes?: readonly OcrPermissionReasonCode[]
  readonly sourceHidden?: boolean
  readonly stale?: boolean
  readonly holdActive?: boolean
  readonly lifecycleState?: 'active' | 'expired' | 'purge_pending' | 'purged' | 'tombstoned'
  readonly retentionState?: 'none' | 'held' | 'expired' | 'purge_pending' | 'purged' | 'tombstoned'
  readonly privacyBlocked?: boolean
  readonly requiresConfirmation?: boolean
  readonly outputMode?: 'full' | 'snippet' | 'masked' | 'metadata_only' | 'blocked'
  readonly grantedSource?: 'role' | 'system_admin_bypass' | 'role_version' | 'none'
  readonly roleVersion?: number | null
  readonly sourceHash?: string | null
  readonly privacyHash?: string | null
}

/** 构建授权决策快照（默认：项目管理员允许确认）。 */
export function buildDecisionSnapshotFixture(
  overrides: OcrDecisionFixtureInput = {},
): OcrAuthorizationDecisionSnapshot {
  const action = overrides.action ?? 'review_confirm'
  const mapping = resolveActionMapping(action)!
  const sourceHidden = overrides.sourceHidden ?? false
  const stale = overrides.stale ?? false
  const holdActive = overrides.holdActive ?? false
  const lifecycleState = overrides.lifecycleState ?? 'active'
  const retentionState = overrides.retentionState ?? 'none'
  const privacyBlocked = overrides.privacyBlocked ?? false
  const explicitDenied = overrides.result === 'denied'
  const outputMode = overrides.outputMode ?? (sourceHidden ? 'metadata_only' : 'full')

  let result: OcrPermissionDecisionResult | undefined = overrides.result
  const reasonCodes: OcrPermissionReasonCode[] = [...(overrides.reasonCodes ?? [])]

  if (privacyBlocked) {
    result = 'privacy_blocked'
    reasonCodes.push('privacy_blocked')
  } else if (stale) {
    result = 'stale_blocked'
    reasonCodes.push('stale_source')
  } else if (holdActive || lifecycleState !== 'active' || retentionState !== 'none') {
    result = 'retention_blocked'
    reasonCodes.push('retention_held')
  } else if (sourceHidden) {
    result = 'metadata_only'
    reasonCodes.push('source_hidden')
  }

  const requiresConfirmation =
    overrides.requiresConfirmation ??
    (mapping.isMutation &&
      !sourceHidden &&
      !stale &&
      !holdActive &&
      !privacyBlocked &&
      !explicitDenied)
  if (result === undefined) {
    result = requiresConfirmation ? 'confirm_required' : 'allow'
  }

  const grantedSource = overrides.grantedSource ?? 'role'
  const roleVersion = overrides.roleVersion ?? 3
  const sourceHash = overrides.sourceHash ?? 'src_hash_001'
  const privacyHash = overrides.privacyHash ?? (privacyBlocked ? 'privacy_hash_blocked' : null)

  const sourceRef = buildSourceRef()
  const artifactRef = buildArtifactRef({ id: 1, kind: 'accepted_extraction' })
  const actorRef = buildActorRef()
  const organizationRef = buildOrganizationRef()
  const projectRef = buildProjectRef()

  return buildDecisionSnapshot({
    action,
    result,
    requiredPermission: mapping.permission,
    grantedPermissionSource: grantedSource,
    roleVersion,
    actorRef,
    organizationRef,
    projectRef,
    sourceRef,
    artifactRef,
    sourceHash,
    lifecycleState,
    retentionState,
    holdActive,
    staleStatus: stale ? 'stale' : 'current',
    privacyRef: privacyBlocked ? 'privacy' : null,
    privacyHash,
    outputMode,
    requiresConfirmation,
    reasonCodes,
  })
}

// ─── 决策预览 ────────────────────────────────────────────────────────────────

export function buildDecisionPreview(
  overrides: Partial<OcrDecisionPreview> = {},
): OcrDecisionPreview {
  const snapshot = buildDecisionSnapshotFixture({ action: 'review_confirm' })
  return {
    action: 'review_confirm',
    result: snapshot.result,
    requiresConfirmation: snapshot.requiresConfirmation,
    outputMode: snapshot.outputMode,
    reasonCodes: snapshot.reasonCodes,
    decisionHash: snapshot.decisionHash,
    ...overrides,
  }
}

// ─── 权限状态 ────────────────────────────────────────────────────────────────

export function buildPermissionStatus(
  overrides: Partial<OcrPermissionStatus> = {},
): OcrPermissionStatus {
  const projectRef = buildProjectRef()
  const sourceRef = buildSourceRef()
  const artifactRef = buildArtifactRef()
  const allowedActions: OcrPermissionAction[] = [
    'metadata_read',
    'permission_status_read',
    'ocr_audit_read',
  ]
  return {
    projectRef,
    sourceRef,
    artifactRef,
    sourceHash: 'src_hash_001',
    lifecycleState: 'active',
    retentionState: 'none',
    staleStatus: 'current',
    outputMode: 'full',
    allowedActions,
    blockedActions: [],
    decisionHashes: [],
    warnings: [],
    statusHash: 'status_hash_001',
    ...overrides,
  }
}

// ─── 审计摘要 ────────────────────────────────────────────────────────────────

export function buildAuditSummary(overrides: Partial<OcrAuditSummary> = {}): OcrAuditSummary {
  const actorRef = buildActorRef()
  const projectRef = buildProjectRef()
  const sourceRef = buildSourceRef()
  const artifactRef = buildArtifactRef()
  const sourceHash = 'src_hash_001'
  const contentHash = computeContentHash({
    extractionId: 1,
    sourceHash,
    selectedTextHash: 'sel_hash_001',
    textLength: 1500,
    pageCount: 2,
  })
  const decisionHash = computeDecisionHash({
    action: 'review_confirm',
    result: 'allow',
    requiredPermission: 'ocr:confirm',
    grantedPermissionSource: 'role',
    roleVersion: 3,
    organizationId: FIXED_ORG,
    projectId: FIXED_PROJECT,
    sourceRefId: 1,
    artifactRefId: 1,
    sourceHash,
    lifecycleState: 'active',
    retentionState: 'none',
    holdActive: false,
    staleStatus: 'current',
    privacyHash: null,
    outputMode: 'full',
    reasonCodes: [],
  })
  return {
    id: 1,
    event: 'ocr.permission.review_confirm',
    action: 'review_confirm',
    result: 'allow',
    reasonCodes: [],
    actorRef,
    projectRef,
    sourceRef,
    artifactRef,
    sourceHash,
    contentHash,
    decisionHash,
    createdAt: FIXED_NOW,
    metadata: {
      action: 'review_confirm',
      result: 'allow',
      sourceRefKind: 'attachment',
      sourceHash,
      artifactRefKind: 'accepted_extraction',
      artifactRefId: 1,
      contentHash,
      lifecycleState: 'active',
      retentionState: 'none',
      privacyHash: null,
      decisionHash,
      reasonCodes: [],
    },
    ...overrides,
  }
}

// ─── 其余确定性哈希（供测试断言） ───────────────────────────────────────────

export function buildSourceRefHashFixture(): string {
  return computeSourceRefHash({
    organizationId: FIXED_ORG,
    projectId: FIXED_PROJECT,
    sourceId: 1,
    sourceHash: 'src_hash_001',
  })
}

export function buildAuditSummaryHashFixture(): string {
  return computeAuditSummaryHash({
    event: 'ocr.permission.review_confirm',
    action: 'review_confirm',
    result: 'allow',
    actorId: 100,
    organizationId: FIXED_ORG,
    projectId: FIXED_PROJECT,
    sourceRefId: 1,
    artifactRefId: 1,
    sourceHash: 'src_hash_001',
    contentHash: 'content_hash_001',
    createdAt: FIXED_NOW,
  })
}

export function buildStaleSourceHashFixture(): string {
  return 'stale_hash_999'
}

export function buildDeniedDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({
    action: 'copy_export_execution',
    result: 'denied',
    reasonCodes: ['permission_missing'],
    grantedSource: 'none',
  })
}

export function buildSensitiveDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({ action: 'accepted_text_read' })
}

export function buildPrivacyBlockedDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({
    action: 'optional_ai_handoff',
    privacyBlocked: true,
  })
}

export function buildRetentionHeldDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({
    action: 'copy_export_execution',
    holdActive: true,
    retentionState: 'held',
  })
}

export function buildStaleBlockedDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({
    action: 'review_confirm',
    stale: true,
  })
}

export function buildHiddenSourceDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({
    action: 'accepted_text_read',
    sourceHidden: true,
  })
}

export function buildDegradedDecisionFixture(): OcrAuthorizationDecisionSnapshot {
  return buildDecisionSnapshotFixture({
    action: 'search_indexing_preview',
    result: 'degraded',
    reasonCodes: ['capability_unavailable'],
  })
}
