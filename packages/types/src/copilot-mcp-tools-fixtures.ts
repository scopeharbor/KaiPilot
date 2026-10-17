// @aiproj/types — V3 Copilot MCP 外部工具 fixtures（copilot-mcp-tools）
//
// v3-copilot-mcp-external-tools —— 覆盖五态（授权未开、正常调用、未声明能力被拒、
// 权限不足、返回含注入）的测试夹具。
//
// 默认测试不访问公网、不建立真实 MCP 连接。

import type {
  McpToolDeclaration,
  McpToolPermissionRef,
  McpToolInvocationRecord,
  McpAuthorizationState,
  McpManifestFingerprint,
  McpToolDetectionRecord,
} from './copilot-mcp-tools.js'

// ---------------------------------------------------------------------------
// 五态 fixtures
// ---------------------------------------------------------------------------

/** 基础权限引用（只读查询）。 */
function baseReadPermission(): McpToolPermissionRef {
  return {
    permissionKey: 'copilot:external_tool:read',
    seamKey: 'copilot-mcp-tools',
    scopeKind: 'organization',
    sideEffect: 'read-only',
    confirmation: 'not-required',
    network: 'direct-allowed',
  }
}

/** 基础权限引用（可写操作）。 */
function baseWritePermission(): McpToolPermissionRef {
  return {
    permissionKey: 'copilot:external_tool:write',
    seamKey: 'copilot-mcp-tools',
    scopeKind: 'organization',
    sideEffect: 'formal-write',
    confirmation: 'required',
    network: 'direct-allowed',
  }
}

/** 构造正常工具声明（只读）。 */
export function buildReadOnlyToolDeclaration(
  overrides?: Partial<McpToolDeclaration>,
): McpToolDeclaration {
  return {
    toolId: 'github.example-org.get-issue',
    toolName: 'GitHub Get Issue',
    description: '查询 GitHub issue 状态与详情',
    capabilityType: 'read_only',
    requiredPermissions: [baseReadPermission()],
    writable: false,
    source: { kind: 'registry', ref: 'registry-entry-001' },
    timeoutMs: 15000,
    ...overrides,
  }
}

/** 构造可写工具声明。 */
export function buildWriteToolDeclaration(
  overrides?: Partial<McpToolDeclaration>,
): McpToolDeclaration {
  return {
    toolId: 'github.example-org.create-issue',
    toolName: 'GitHub Create Issue',
    description: '在 GitHub 上创建 issue（产出为待确认草案）',
    capabilityType: 'write_capable',
    requiredPermissions: [baseReadPermission(), baseWritePermission()],
    writable: true,
    source: { kind: 'registry', ref: 'registry-entry-002' },
    timeoutMs: 20000,
    ...overrides,
  }
}

/** 构造超权声明（权限超过安装者）。 */
export function buildEscalationToolDeclaration(
  overrides?: Partial<McpToolDeclaration>,
): McpToolDeclaration {
  return {
    toolId: 'evil.example-org.admin-tool',
    toolName: 'Admin Tool',
    description: '需要管理员权限的工具',
    capabilityType: 'write_capable',
    requiredPermissions: [
      {
        permissionKey: 'admin:full_access',
        seamKey: 'copilot-mcp-tools',
        scopeKind: 'organization',
        sideEffect: 'external-action',
        confirmation: 'not-required',
        network: 'direct-allowed',
      },
    ],
    writable: true,
    source: { kind: 'registry', ref: 'registry-entry-003' },
    ...overrides,
  }
}

/** 构造未声明能力的工具（运行时动态扩展）。 */
export function buildUndeclaredCapabilityDeclaration(
  overrides?: Partial<McpToolDeclaration>,
): McpToolDeclaration {
  return {
    toolId: 'runtime.example-org.new-tool',
    toolName: 'Runtime New Tool',
    description: '运行时动态新增的工具（不应被采纳）',
    capabilityType: 'read_only',
    requiredPermissions: [baseReadPermission()],
    writable: false,
    source: { kind: 'registry', ref: 'registry-entry-004' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 五态 — 调用记录 fixtures
// ---------------------------------------------------------------------------

/** 构造成功调用记录。 */
export function buildSuccessfulInvocationRecord(
  overrides?: Partial<McpToolInvocationRecord>,
): McpToolInvocationRecord {
  return {
    recordId: 'inv-001',
    toolId: 'github.example-org.get-issue',
    toolName: 'GitHub Get Issue',
    status: 'success',
    durationMs: 1200,
    invokedAt: '2026-08-19T10:00:00Z',
    actorId: 'user-001',
    organizationId: 1,
    responseSizeBytes: 2048,
    ...overrides,
  }
}

/** 构造授权未开的调用记录。 */
export function buildUnauthorizedInvocationRecord(
  overrides?: Partial<McpToolInvocationRecord>,
): McpToolInvocationRecord {
  return {
    recordId: 'inv-002',
    toolId: 'github.example-org.get-issue',
    toolName: 'GitHub Get Issue',
    status: 'blocked_unauthorized',
    durationMs: 5,
    invokedAt: '2026-08-19T10:00:01Z',
    actorId: 'user-001',
    organizationId: 1,
    denialReason: 'organization_not_authorized',
    ...overrides,
  }
}

/** 构造未声明能力被拒的调用记录。 */
export function buildUndeclaredCapabilityInvocationRecord(
  overrides?: Partial<McpToolInvocationRecord>,
): McpToolInvocationRecord {
  return {
    recordId: 'inv-003',
    toolId: 'runtime.example-org.new-tool',
    toolName: 'Runtime New Tool',
    status: 'blocked_undeclared',
    durationMs: 3,
    invokedAt: '2026-08-19T10:00:02Z',
    actorId: 'user-001',
    organizationId: 1,
    denialReason: 'capability_not_declared',
    ...overrides,
  }
}

/** 构造权限不足的调用记录。 */
export function buildPermissionDeniedInvocationRecord(
  overrides?: Partial<McpToolInvocationRecord>,
): McpToolInvocationRecord {
  return {
    recordId: 'inv-004',
    toolId: 'github.example-org.create-issue',
    toolName: 'GitHub Create Issue',
    status: 'blocked_permission',
    durationMs: 4,
    invokedAt: '2026-08-19T10:00:03Z',
    actorId: 'user-002',
    organizationId: 1,
    denialReason: 'invoker_permission_denied',
    ...overrides,
  }
}

/** 构造注入检测拦截的调用记录。 */
export function buildInjectionBlockedInvocationRecord(
  overrides?: Partial<McpToolInvocationRecord>,
): McpToolInvocationRecord {
  return {
    recordId: 'inv-005',
    toolId: 'github.example-org.get-issue',
    toolName: 'GitHub Get Issue',
    status: 'blocked_injection',
    durationMs: 800,
    invokedAt: '2026-08-19T10:00:04Z',
    actorId: 'user-001',
    organizationId: 1,
    denialReason: 'injection_detected',
    ...overrides,
  }
}

/** 构造截断调用记录。 */
export function buildTruncatedInvocationRecord(
  overrides?: Partial<McpToolInvocationRecord>,
): McpToolInvocationRecord {
  return {
    recordId: 'inv-006',
    toolId: 'github.example-org.get-issue',
    toolName: 'GitHub Get Issue',
    status: 'truncated',
    durationMs: 2000,
    invokedAt: '2026-08-19T10:00:05Z',
    actorId: 'user-001',
    organizationId: 1,
    responseSizeBytes: 100000,
    truncated: true,
    truncationMarker: '[TRUNCATED: 100000 bytes exceeds budget 50000 bytes]',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 授权状态 fixtures
// ---------------------------------------------------------------------------

/** 构造未授权状态。 */
export function buildUnauthorizedState(
  overrides?: Partial<McpAuthorizationState>,
): McpAuthorizationState {
  return {
    organizationId: 1,
    decision: 'unauthorized',
    manifestDigest: 'sha256:abc123',
    rowVersion: 1,
    ...overrides,
  }
}

/** 构造已授权状态。 */
export function buildAuthorizedState(
  overrides?: Partial<McpAuthorizationState>,
): McpAuthorizationState {
  return {
    organizationId: 1,
    decision: 'authorized',
    authorizedAt: '2026-08-19T09:00:00Z',
    authorizedBy: 'admin-001',
    manifestDigest: 'sha256:abc123',
    rowVersion: 2,
    ...overrides,
  }
}

/** 构造已撤销状态。 */
export function buildRevokedState(
  overrides?: Partial<McpAuthorizationState>,
): McpAuthorizationState {
  return {
    organizationId: 1,
    decision: 'revoked',
    authorizedAt: '2026-08-19T09:00:00Z',
    authorizedBy: 'admin-001',
    revokedAt: '2026-08-19T09:30:00Z',
    manifestDigest: 'sha256:abc123',
    rowVersion: 3,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 清单固定 fixtures
// ---------------------------------------------------------------------------

/** 构造清单指纹。 */
export function buildManifestFingerprint(
  overrides?: Partial<McpManifestFingerprint>,
): McpManifestFingerprint {
  return {
    toolId: 'github.example-org.get-issue',
    installedDigest: 'sha256:abc123',
    installedCapabilities: ['github.example-org.get-issue'],
    installedAt: '2026-08-19T08:00:00Z',
    organizationId: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 注入检测 fixtures
// ---------------------------------------------------------------------------

/** 构造干净的检测记录（通过）。 */
export function buildCleanDetectionRecord(
  overrides?: Partial<McpToolDetectionRecord>,
): McpToolDetectionRecord {
  return {
    recordId: 'det-001',
    toolId: 'github.example-org.get-issue',
    verdict: 'passed',
    hitCategories: [],
    totalHits: 0,
    detectorVersion: '1.0.0',
    detectedAt: '2026-08-19T10:00:00Z',
    organizationId: 1,
    ...overrides,
  }
}

/** 构造注入检测拦截记录。 */
export function buildInjectionDetectionRecord(
  overrides?: Partial<McpToolDetectionRecord>,
): McpToolDetectionRecord {
  return {
    recordId: 'det-002',
    toolId: 'github.example-org.get-issue',
    verdict: 'rejected',
    hitCategories: ['instruction_override'],
    totalHits: 1,
    detectorVersion: '1.0.0',
    detectedAt: '2026-08-19T10:00:00Z',
    organizationId: 1,
    ...overrides,
  }
}

/** 构造检测不可用记录。 */
export function buildUnavailableDetectionRecord(
  overrides?: Partial<McpToolDetectionRecord>,
): McpToolDetectionRecord {
  return {
    recordId: 'det-003',
    toolId: 'github.example-org.get-issue',
    verdict: 'unavailable',
    hitCategories: [],
    totalHits: 0,
    detectorVersion: '1.0.0',
    detectedAt: '2026-08-19T10:00:00Z',
    organizationId: 1,
    ...overrides,
  }
}
