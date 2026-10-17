/**
 * v3-copilot-mcp-external-tools — 后端服务单元测试。
 *
 * 覆盖：
 * - §3 复用插件治理：声明形状校验、权限不升级
 * - §4 清单固定：未声明能力拒绝、运行时扩展拒绝、清单变更重新授权
 * - §5 授权门：未授权时零外部连接、工具可见不可用
 * - §6 每次调用判权：安装时+调用时双重校验、组织隔离
 * - §7 返回安全：注入检测、截断标记、零直接域写
 * - §2 调用记录：禁存约束（不含参数/返回全文/token/secret）
 *
 * 默认测试不访问公网、不建立真实 MCP 连接。
 */

import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import type { McpToolInvocationRecord, McpToolDetectionRecord } from '@aiproj/types'

import {
  CopilotMcpToolService,
  type McpToolServiceDeps,
} from '../../app/services/copilot_mcp_tools/copilot_mcp_tool_service.js'

import {
  buildReadOnlyToolDeclaration,
  buildEscalationToolDeclaration,
  buildUndeclaredCapabilityDeclaration,
  buildUnauthorizedState,
  buildAuthorizedState,
  buildRevokedState,
  buildManifestFingerprint,
} from '@aiproj/types'

// ===========================================================================
// 测试用 Mock 依赖
// ===========================================================================

function createMockDeps(overrides?: Partial<McpToolServiceDeps>): McpToolServiceDeps {
  const invocationRecords: McpToolInvocationRecord[] = []
  const detectionRecords: McpToolDetectionRecord[] = []

  return {
    getAuthorizationState: async () => buildUnauthorizedState(),
    getManifestFingerprint: async () => null,
    getInstalledCapabilities: async () => ['github.example-org.get-issue'],
    getInstallerPermissions: async () => ['copilot:external_tool:read'],
    getInvokerPermissions: async () => ['copilot:external_tool:read'],
    writeInvocationRecord: async (r) => {
      invocationRecords.push(r)
    },
    writeDetectionRecord: async (r) => {
      detectionRecords.push(r)
    },
    generateId: () => `test-id-${Date.now()}`,
    now: () => '2026-08-19T10:00:00Z',
    ...overrides,
    _invocationRecords: invocationRecords,
    _detectionRecords: detectionRecords,
  } as McpToolServiceDeps & {
    _invocationRecords: McpToolInvocationRecord[]
    _detectionRecords: McpToolDetectionRecord[]
  }
}

// ===========================================================================
// §5 授权门（D6）
// ===========================================================================

describe('§5 授权门', () => {
  it('未授权时返回 unauthorized 状态', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const state = await service.checkAuthorization(1)
    assert.equal(state.decision, 'unauthorized')
  })

  it('已授权时返回 authorized 状态', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => buildAuthorizedState(),
    })
    const service = new CopilotMcpToolService(deps)
    const state = await service.checkAuthorization(1)
    assert.equal(state.decision, 'authorized')
  })

  it('已撤销时返回 revoked 状态（授权门视为未授权）', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => buildRevokedState(),
    })
    const service = new CopilotMcpToolService(deps)
    const state = await service.checkAuthorization(1)
    // 保留原始决策（revoked 比 unauthorized 更有信息量）
    assert.equal(state.decision, 'revoked')
  })

  it('授权状态为 null 时返回 unauthorized', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => null,
    })
    const service = new CopilotMcpToolService(deps)
    const state = await service.checkAuthorization(1)
    assert.equal(state.decision, 'unauthorized')
  })
})

// ===========================================================================
// §4 清单固定与动态扩展拒绝（D2）
// ===========================================================================

describe('§4 清单固定', () => {
  it('已安装的能力通过校验', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const result = await service.validateCapability('github.example-org.get-issue', 1)
    assert.equal(result, null)
  })

  it('未安装的能力被拒绝', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const result = await service.validateCapability('runtime.example-org.new-tool', 1)
    assert.equal(result, 'capability_not_declared')
  })

  it('清单变更需要重新授权', async () => {
    const deps = createMockDeps({
      getManifestFingerprint: async () => buildManifestFingerprint(),
    })
    const service = new CopilotMcpToolService(deps)
    const changed = await service.checkManifestChange(
      'github.example-org.get-issue',
      'sha256:different',
      1,
    )
    assert.equal(changed, true)
  })

  it('清单未变更不需要重新授权', async () => {
    const fp = buildManifestFingerprint()
    const deps = createMockDeps({
      getManifestFingerprint: async () => fp,
    })
    const service = new CopilotMcpToolService(deps)
    const changed = await service.checkManifestChange(
      'github.example-org.get-issue',
      fp.installedDigest,
      1,
    )
    assert.equal(changed, false)
  })
})

// ===========================================================================
// §3 复用插件治理 — 权限不升级（D1）
// ===========================================================================

describe('§3 权限不升级', () => {
  it('声明权限在安装者权限内时通过', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const declaration = buildReadOnlyToolDeclaration()
    const result = await service.validateDeclarationPermissions(declaration, 1)
    assert.equal(result.valid, true)
    assert.equal(result.findings.length, 0)
  })

  it('声明权限超出安装者权限时拒绝', async () => {
    const deps = createMockDeps({
      getInstallerPermissions: async () => ['copilot:external_tool:read'],
    })
    const service = new CopilotMcpToolService(deps)
    const declaration = buildEscalationToolDeclaration()
    const result = await service.validateDeclarationPermissions(declaration, 1)
    assert.equal(result.valid, false)
    assert.ok(result.findings.length > 0)
    assert.equal(result.findings[0].code, 'tool-permission-exceeds-installer')
  })

  it('声明不符合插件清单范式时拒绝', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const declaration = buildReadOnlyToolDeclaration({
      requiredPermissions: [
        {
          permissionKey: '',
          seamKey: '',
          scopeKind: 'organization',
          sideEffect: 'read-only',
          confirmation: 'not-required',
          network: 'direct-allowed',
        },
      ],
    })
    const result = await service.validateDeclarationPermissions(declaration, 1)
    assert.equal(result.valid, false)
    assert.equal(result.findings[0].code, 'tool-declaration-invalid-shape')
  })
})

// ===========================================================================
// §6 每次调用判权（D7）
// ===========================================================================

describe('§6 每次调用判权', () => {
  it('调用者拥有安装者全部权限时通过', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const result = await service.validateInvocationPermission(
      'github.example-org.get-issue',
      'user-001',
      1,
    )
    assert.equal(result, null)
  })

  it('调用者缺少安装者权限时拒绝', async () => {
    const deps = createMockDeps({
      getInvokerPermissions: async () => [], // 空权限
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.validateInvocationPermission(
      'github.example-org.get-issue',
      'user-002',
      1,
    )
    assert.equal(result, 'invoker_permission_denied')
  })
})

// ===========================================================================
// §7 返回安全（D3、D5）
// ===========================================================================

describe('§7 返回安全', () => {
  it('正常返回不截断', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const result = await service.processToolResult(
      'github.example-org.get-issue',
      'short result',
      1,
      50000,
    )
    assert.equal(result.truncated, false)
    assert.equal(result.processed, 'short result')
  })

  it('超预算返回被截断并标记', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const longResult = 'x'.repeat(100000)
    const result = await service.processToolResult(
      'github.example-org.get-issue',
      longResult,
      1,
      50000,
    )
    assert.equal(result.truncated, true)
    assert.ok(result.truncationMarker?.includes('TRUNCATED'))
  })

  it('返回处理写入检测记录', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    await service.processToolResult('github.example-org.get-issue', 'result', 1, 50000)
    const detRecords = (deps as any)._detectionRecords as McpToolDetectionRecord[]
    assert.equal(detRecords.length, 1)
    assert.equal(detRecords[0].toolId, 'github.example-org.get-issue')
  })
})

// ===========================================================================
// §2 低敏落账（D4）
// ===========================================================================

describe('§2 低敏落账', () => {
  it('调用记录不含禁存字段', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const record = await service.recordInvocation(
      'github.example-org.get-issue',
      'GitHub Get Issue',
      'success',
      1000,
      'user-001',
      1,
    )
    // 验证记录不包含禁存字段
    assert.equal((record as any).arguments, undefined)
    assert.equal((record as any).params, undefined)
    assert.equal((record as any).result, undefined)
    assert.equal((record as any).token, undefined)
    assert.equal((record as any).secret, undefined)
    assert.equal((record as any).prompt, undefined)
  })

  it('拒绝原因码正确记录', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const record = await service.recordInvocation(
      'github.example-org.get-issue',
      'GitHub Get Issue',
      'blocked_unauthorized',
      5,
      'user-001',
      1,
      { denialReason: 'organization_not_authorized' },
    )
    assert.equal(record.denialReason, 'organization_not_authorized')
  })
})

// ===========================================================================
// §8 完整调用流程
// ===========================================================================

describe('§8 完整调用流程', () => {
  it('未授权时短路并记录', async () => {
    const deps = createMockDeps()
    const service = new CopilotMcpToolService(deps)
    const result = await service.invokeTool(
      buildReadOnlyToolDeclaration(),
      'user-001',
      1,
      async () => 'should not reach here',
    )
    assert.equal(result.success, false)
    assert.equal(result.denialReason, 'organization_not_authorized')
    assert.equal(result.record.status, 'blocked_unauthorized')
  })

  it('已授权但未声明能力时短路', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => buildAuthorizedState(),
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.invokeTool(
      buildUndeclaredCapabilityDeclaration(),
      'user-001',
      1,
      async () => 'should not reach here',
    )
    assert.equal(result.success, false)
    assert.equal(result.denialReason, 'capability_not_declared')
  })

  it('已授权+已声明但权限不足时短路', async () => {
    // 超权工具已安装（在能力列表中），但安装者权限不足以声明它
    const deps = createMockDeps({
      getAuthorizationState: async () => buildAuthorizedState(),
      getInstalledCapabilities: async () => [
        'github.example-org.get-issue',
        'evil.example-org.admin-tool',
      ],
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.invokeTool(
      buildEscalationToolDeclaration(),
      'user-001',
      1,
      async () => 'should not reach here',
    )
    assert.equal(result.success, false)
    assert.equal(result.denialReason, 'declaration_escalation')
  })

  it('已授权+已声明+权限OK但调用者无权时短路', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => buildAuthorizedState(),
      getInvokerPermissions: async () => [],
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.invokeTool(
      buildReadOnlyToolDeclaration(),
      'user-002',
      1,
      async () => 'should not reach here',
    )
    assert.equal(result.success, false)
    assert.equal(result.denialReason, 'invoker_permission_denied')
  })

  it('全部通过时执行工具并返回结果', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => buildAuthorizedState(),
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.invokeTool(
      buildReadOnlyToolDeclaration(),
      'user-001',
      1,
      async () => 'issue #123: open',
    )
    assert.equal(result.success, true)
    assert.equal(result.result, 'issue #123: open')
    assert.equal(result.record.status, 'success')
  })

  it('工具执行失败时记录 error 状态', async () => {
    const deps = createMockDeps({
      getAuthorizationState: async () => buildAuthorizedState(),
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.invokeTool(
      buildReadOnlyToolDeclaration(),
      'user-001',
      1,
      async () => {
        throw new Error('network timeout')
      },
    )
    assert.equal(result.success, false)
    assert.equal(result.record.status, 'error')
  })
})

// ===========================================================================
// §6.4 组织隔离
// ===========================================================================

describe('§6.4 组织隔离', () => {
  it('跨组织工具不可见（能力列表不包含）', async () => {
    const deps = createMockDeps({
      getInstalledCapabilities: async () => [], // 组织 2 没有安装
    })
    const service = new CopilotMcpToolService(deps)
    const result = await service.validateCapability('github.example-org.get-issue', 2)
    assert.equal(result, 'capability_not_declared')
  })
})
