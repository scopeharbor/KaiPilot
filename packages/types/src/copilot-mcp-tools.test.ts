/**
 * v3-copilot-mcp-external-tools — 共享契约纯函数单元测试。
 *
 * 覆盖 @aiproj/types 中的 copilot-mcp-tools 模块。
 * 默认测试不访问公网、不建立真实 MCP 连接。
 */

// vitest 的 include 匹配 src/**/*.test.ts：本文件若从 'node:test' 取 describe/it，
// vitest 收集得到文件却找不到任何 suite，直接报 "No test suite found" 并让整包测试变红
// （断言一条也不执行）。改用 vitest 的 describe/it，断言仍用 node:assert/strict。
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  // 枚举
  MCP_TOOL_CAPABILITY_TYPES,
  MCP_TOOL_INVOCATION_STATUSES,
  MCP_AUTHORIZATION_DECISIONS,
  MCP_DENIAL_REASON_CODES,
  // 类型守卫
  isMcpToolCapabilityType,
  isMcpToolInvocationStatus,
  isMcpAuthorizationDecision,
  isMcpDenialReasonCode,
  // 确定性纯函数
  validateToolDeclarationPermissions,
  validateToolCapabilityInManifest,
  requiresReauthorization,
  buildTruncationMarker,
  validateInvocationRecordNoSensitiveData,
  buildToolSummary,
  validateWriteCapabilityConsistency,
  isTruncationMarked,
  validateToolDeclarationUsesManifestShape,
} from './copilot-mcp-tools.js'

import {
  buildReadOnlyToolDeclaration,
  buildWriteToolDeclaration,
  buildEscalationToolDeclaration,
  buildUndeclaredCapabilityDeclaration,
  buildSuccessfulInvocationRecord,
  buildUnauthorizedInvocationRecord,
  buildUndeclaredCapabilityInvocationRecord,
  buildPermissionDeniedInvocationRecord,
  buildInjectionBlockedInvocationRecord,
  buildTruncatedInvocationRecord,
  buildUnauthorizedState,
  buildAuthorizedState,
  buildRevokedState,
  buildManifestFingerprint,
  buildCleanDetectionRecord,
  buildInjectionDetectionRecord,
  buildUnavailableDetectionRecord,
} from './copilot-mcp-tools-fixtures.js'

// ===========================================================================
// §1 枚举完整性
// ===========================================================================

describe('MCP 工具枚举', () => {
  it('MCP_TOOL_CAPABILITY_TYPES 包含三种能力类型', () => {
    assert.deepEqual(MCP_TOOL_CAPABILITY_TYPES, ['read_only', 'advisory', 'write_capable'])
  })

  it('MCP_TOOL_INVOCATION_STATUSES 包含八种状态', () => {
    assert.equal(MCP_TOOL_INVOCATION_STATUSES.length, 8)
  })

  it('MCP_AUTHORIZATION_DECISIONS 包含三种决策', () => {
    assert.deepEqual(MCP_AUTHORIZATION_DECISIONS, ['authorized', 'unauthorized', 'revoked'])
  })

  it('MCP_DENIAL_REASON_CODES 包含八种拒绝原因', () => {
    assert.equal(MCP_DENIAL_REASON_CODES.length, 8)
  })
})

// ===========================================================================
// §2 类型守卫
// ===========================================================================

describe('MCP 工具类型守卫', () => {
  it('isMcpToolCapabilityType 识别合法值', () => {
    assert.equal(isMcpToolCapabilityType('read_only'), true)
    assert.equal(isMcpToolCapabilityType('write_capable'), true)
    assert.equal(isMcpToolCapabilityType('invalid'), false)
  })

  it('isMcpToolInvocationStatus 识别合法值', () => {
    assert.equal(isMcpToolInvocationStatus('success'), true)
    assert.equal(isMcpToolInvocationStatus('blocked_unauthorized'), true)
    assert.equal(isMcpToolInvocationStatus('invalid'), false)
  })

  it('isMcpAuthorizationDecision 识别合法值', () => {
    assert.equal(isMcpAuthorizationDecision('authorized'), true)
    assert.equal(isMcpAuthorizationDecision('unauthorized'), true)
    assert.equal(isMcpAuthorizationDecision('invalid'), false)
  })

  it('isMcpDenialReasonCode 识别合法值', () => {
    assert.equal(isMcpDenialReasonCode('organization_not_authorized'), true)
    assert.equal(isMcpDenialReasonCode('capability_not_declared'), true)
    assert.equal(isMcpDenialReasonCode('invalid'), false)
  })
})

// ===========================================================================
// §3 权限不升级校验（D1）
// ===========================================================================

describe('validateToolDeclarationPermissions', () => {
  it('安装者拥有所需权限时通过', () => {
    const declaration = buildReadOnlyToolDeclaration()
    const findings = validateToolDeclarationPermissions(declaration, ['copilot:external_tool:read'])
    assert.equal(findings.length, 0)
  })

  it('安装者缺少所需权限时拒绝', () => {
    const declaration = buildEscalationToolDeclaration()
    const findings = validateToolDeclarationPermissions(declaration, ['copilot:external_tool:read'])
    assert.equal(findings.length, 1)
    assert.equal(findings[0].code, 'tool-permission-exceeds-installer')
    assert.equal(findings[0].permissionKey, 'admin:full_access')
  })

  it('多个权限中部分超权时返回全部', () => {
    const declaration = buildWriteToolDeclaration()
    const findings = validateToolDeclarationPermissions(declaration, [
      'copilot:external_tool:read', // 只有 read，没有 write
    ])
    assert.equal(findings.length, 1)
    assert.equal(findings[0].permissionKey, 'copilot:external_tool:write')
  })
})

// ===========================================================================
// §4 清单固定与动态扩展拒绝（D2）
// ===========================================================================

describe('validateToolCapabilityInManifest', () => {
  it('工具在清单中时通过', () => {
    const result = validateToolCapabilityInManifest('github.example-org.get-issue', [
      'github.example-org.get-issue',
      'github.example-org.create-issue',
    ])
    assert.equal(result, null)
  })

  it('工具不在清单中时拒绝', () => {
    const result = validateToolCapabilityInManifest('runtime.example-org.new-tool', [
      'github.example-org.get-issue',
    ])
    assert.equal(result, 'capability_not_declared')
  })

  it('空清单时拒绝任何工具', () => {
    const result = validateToolCapabilityInManifest('any-tool', [])
    assert.equal(result, 'capability_not_declared')
  })
})

describe('requiresReauthorization', () => {
  it('digest 相同时不需要重新授权', () => {
    assert.equal(requiresReauthorization('sha256:abc', 'sha256:abc'), false)
  })

  it('digest 不同时需要重新授权', () => {
    assert.equal(requiresReauthorization('sha256:abc', 'sha256:def'), true)
  })
})

// ===========================================================================
// §5 截断标记（D7）
// ===========================================================================

describe('buildTruncationMarker', () => {
  it('生成正确的截断标记', () => {
    const marker = buildTruncationMarker(100000, 50000)
    assert.ok(marker.includes('TRUNCATED'))
    assert.ok(marker.includes('100000'))
    assert.ok(marker.includes('50000'))
  })
})

describe('isTruncationMarked', () => {
  it('未截断的记录始终通过', () => {
    const record = buildSuccessfulInvocationRecord()
    assert.equal(isTruncationMarked(record), true)
  })

  it('截断且有标记时通过', () => {
    const record = buildTruncatedInvocationRecord()
    assert.equal(isTruncationMarked(record), true)
  })

  it('截断但无标记时失败', () => {
    const record = buildTruncatedInvocationRecord({ truncationMarker: undefined })
    assert.equal(isTruncationMarked(record), false)
  })
})

// ===========================================================================
// §6 禁存约束（D4）
// ===========================================================================

describe('validateInvocationRecordNoSensitiveData', () => {
  it('合法记录无违规', () => {
    const record = buildSuccessfulInvocationRecord()
    const violations = validateInvocationRecordNoSensitiveData(
      record as unknown as Record<string, unknown>,
    )
    assert.equal(violations.length, 0)
  })

  it('含 arguments 字段时违规', () => {
    const violations = validateInvocationRecordNoSensitiveData({
      toolId: 'test',
      arguments: { secret: 'data' },
    })
    assert.ok(violations.includes('arguments'))
  })

  it('含 result 字段时违规', () => {
    const violations = validateInvocationRecordNoSensitiveData({
      toolId: 'test',
      result: 'full response body',
    })
    assert.ok(violations.includes('result'))
  })

  it('含 token 字段时违规', () => {
    const violations = validateInvocationRecordNoSensitiveData({
      toolId: 'test',
      token: 'sk-12345',
    })
    assert.ok(violations.includes('token'))
  })

  it('含 secret 字段时违规', () => {
    const violations = validateInvocationRecordNoSensitiveData({
      toolId: 'test',
      secret: 'my-api-key',
    })
    assert.ok(violations.includes('secret'))
  })

  it('含 prompt 字段时违规', () => {
    const violations = validateInvocationRecordNoSensitiveData({
      toolId: 'test',
      prompt: 'system prompt content',
    })
    assert.ok(violations.includes('prompt'))
  })

  it('null/undefined 值不算违规', () => {
    const violations = validateInvocationRecordNoSensitiveData({
      toolId: 'test',
      arguments: null,
      result: undefined,
    })
    assert.equal(violations.length, 0)
  })
})

// ===========================================================================
// §7 工具摘要（低敏）
// ===========================================================================

describe('buildToolSummary', () => {
  it('生成低敏摘要', () => {
    const declaration = buildReadOnlyToolDeclaration()
    const summary = buildToolSummary(declaration)
    assert.ok(summary.includes('GitHub Get Issue'))
    assert.ok(summary.includes('read_only'))
    // 不含描述、权限等敏感信息
    assert.ok(!summary.includes('查询 GitHub issue'))
  })
})

// ===========================================================================
// §8 写能力一致性校验（D5）
// ===========================================================================

describe('validateWriteCapabilityConsistency', () => {
  it('write_capable 且 writable=true 时通过', () => {
    const declaration = buildWriteToolDeclaration()
    const findings = validateWriteCapabilityConsistency(declaration)
    assert.equal(findings.length, 0)
  })

  it('write_capable 但 writable=false 时报告', () => {
    const declaration = buildWriteToolDeclaration({ writable: false })
    const findings = validateWriteCapabilityConsistency(declaration)
    assert.equal(findings.length, 1)
  })

  it('read_only 且 writable=false 时通过', () => {
    const declaration = buildReadOnlyToolDeclaration()
    const findings = validateWriteCapabilityConsistency(declaration)
    assert.equal(findings.length, 0)
  })
})

// ===========================================================================
// §9 清单形状校验（D1）
// ===========================================================================

describe('validateToolDeclarationUsesManifestShape', () => {
  it('合法声明通过', () => {
    const declaration = buildReadOnlyToolDeclaration()
    assert.equal(validateToolDeclarationUsesManifestShape(declaration), true)
  })

  it('缺少 permissionKey 的声明失败', () => {
    const declaration = buildReadOnlyToolDeclaration({
      requiredPermissions: [
        {
          permissionKey: '',
          seamKey: 'copilot-mcp-tools',
          scopeKind: 'organization',
          sideEffect: 'read-only',
          confirmation: 'not-required',
          network: 'direct-allowed',
        },
      ],
    })
    assert.equal(validateToolDeclarationUsesManifestShape(declaration), false)
  })

  it('缺少 seamKey 的声明失败', () => {
    const declaration = buildReadOnlyToolDeclaration({
      requiredPermissions: [
        {
          permissionKey: 'test',
          seamKey: '',
          scopeKind: 'organization',
          sideEffect: 'read-only',
          confirmation: 'not-required',
          network: 'direct-allowed',
        },
      ],
    })
    assert.equal(validateToolDeclarationUsesManifestShape(declaration), false)
  })

  it('空权限列表的声明通过（无需权限的只读工具）', () => {
    const declaration = buildReadOnlyToolDeclaration({ requiredPermissions: [] })
    assert.equal(validateToolDeclarationUsesManifestShape(declaration), true)
  })
})

// ===========================================================================
// §10 Fixtures 五态覆盖
// ===========================================================================

describe('MCP 工具 fixtures', () => {
  it('buildReadOnlyToolDeclaration 构造正确的只读声明', () => {
    const d = buildReadOnlyToolDeclaration()
    assert.equal(d.capabilityType, 'read_only')
    assert.equal(d.writable, false)
    assert.equal(d.requiredPermissions.length, 1)
  })

  it('buildWriteToolDeclaration 构造正确的可写声明', () => {
    const d = buildWriteToolDeclaration()
    assert.equal(d.capabilityType, 'write_capable')
    assert.equal(d.writable, true)
    assert.equal(d.requiredPermissions.length, 2)
  })

  it('buildEscalationToolDeclaration 构造超权声明', () => {
    const d = buildEscalationToolDeclaration()
    assert.equal(d.requiredPermissions[0].permissionKey, 'admin:full_access')
  })

  it('buildSuccessfulInvocationRecord 构造成功记录', () => {
    const r = buildSuccessfulInvocationRecord()
    assert.equal(r.status, 'success')
    assert.equal(r.denialReason, undefined)
  })

  it('buildUnauthorizedInvocationRecord 构造授权未开记录', () => {
    const r = buildUnauthorizedInvocationRecord()
    assert.equal(r.status, 'blocked_unauthorized')
    assert.equal(r.denialReason, 'organization_not_authorized')
  })

  it('buildUndeclaredCapabilityInvocationRecord 构造未声明记录', () => {
    const r = buildUndeclaredCapabilityInvocationRecord()
    assert.equal(r.status, 'blocked_undeclared')
    assert.equal(r.denialReason, 'capability_not_declared')
  })

  it('buildPermissionDeniedInvocationRecord 构造权限不足记录', () => {
    const r = buildPermissionDeniedInvocationRecord()
    assert.equal(r.status, 'blocked_permission')
    assert.equal(r.denialReason, 'invoker_permission_denied')
  })

  it('buildInjectionBlockedInvocationRecord 构造注入拦截记录', () => {
    const r = buildInjectionBlockedInvocationRecord()
    assert.equal(r.status, 'blocked_injection')
    assert.equal(r.denialReason, 'injection_detected')
  })

  it('buildTruncatedInvocationRecord 构造截断记录', () => {
    const r = buildTruncatedInvocationRecord()
    assert.equal(r.status, 'truncated')
    assert.equal(r.truncated, true)
    assert.ok(r.truncationMarker?.includes('TRUNCATED'))
  })

  it('buildUnauthorizedState 构造未授权状态', () => {
    const s = buildUnauthorizedState()
    assert.equal(s.decision, 'unauthorized')
  })

  it('buildAuthorizedState 构造已授权状态', () => {
    const s = buildAuthorizedState()
    assert.equal(s.decision, 'authorized')
    assert.ok(s.authorizedAt)
  })

  it('buildRevokedState 构造已撤销状态', () => {
    const s = buildRevokedState()
    assert.equal(s.decision, 'revoked')
    assert.ok(s.revokedAt)
  })

  it('buildManifestFingerprint 构造清单指纹', () => {
    const f = buildManifestFingerprint()
    assert.ok(f.installedDigest)
    assert.ok(f.installedCapabilities.length > 0)
  })

  it('buildCleanDetectionRecord 构造干净检测记录', () => {
    const r = buildCleanDetectionRecord()
    assert.equal(r.verdict, 'passed')
    assert.equal(r.totalHits, 0)
  })

  it('buildInjectionDetectionRecord 构造注入检测记录', () => {
    const r = buildInjectionDetectionRecord()
    assert.equal(r.verdict, 'rejected')
    assert.ok(r.hitCategories.includes('instruction_override'))
  })

  it('buildUnavailableDetectionRecord 构造不可用检测记录', () => {
    const r = buildUnavailableDetectionRecord()
    assert.equal(r.verdict, 'unavailable')
  })
})

// ===========================================================================
// §11 调用记录禁存约束集成测试
// ===========================================================================

describe('调用记录禁存约束集成', () => {
  it('所有五态记录均满足禁存约束', () => {
    const records = [
      buildSuccessfulInvocationRecord(),
      buildUnauthorizedInvocationRecord(),
      buildUndeclaredCapabilityInvocationRecord(),
      buildPermissionDeniedInvocationRecord(),
      buildInjectionBlockedInvocationRecord(),
      buildTruncatedInvocationRecord(),
    ]

    for (const record of records) {
      const violations = validateInvocationRecordNoSensitiveData(
        record as unknown as Record<string, unknown>,
      )
      assert.equal(
        violations.length,
        0,
        `记录 ${record.recordId} 包含禁存字段: ${violations.join(', ')}`,
      )
    }
  })
})

// ===========================================================================
// §12 清单固定集成测试
// ===========================================================================

describe('清单固定集成', () => {
  it('已安装的能力通过校验', () => {
    const fp = buildManifestFingerprint()
    const result = validateToolCapabilityInManifest(fp.toolId, fp.installedCapabilities)
    assert.equal(result, null)
  })

  it('未安装的能力被拒绝', () => {
    const fp = buildManifestFingerprint()
    const result = validateToolCapabilityInManifest('unknown-tool', fp.installedCapabilities)
    assert.equal(result, 'capability_not_declared')
  })

  it('清单变更需要重新授权', () => {
    const fp = buildManifestFingerprint()
    assert.equal(requiresReauthorization(fp.installedDigest, fp.installedDigest), false)
    assert.equal(requiresReauthorization(fp.installedDigest, 'sha256:different'), true)
  })
})
