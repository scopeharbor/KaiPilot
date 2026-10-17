// v3-multitenant-isolation-architecture §7.3/§7.4 —— 前端组织上下文与低敏渲染。
//
// spec 相关约束：
// - UI 的组织状态是**展示层**，不是安全边界（真正的边界在服务端 tenant 解析）
// - 未授权时 UI 隐藏或降级，且降级提示本身必须低敏
// - 隔离 warning 只按 code 渲染，绝不透传服务端 message（后者可能夹带隐藏细节）
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  describeTenantScopeForDisplay,
  detectForbiddenDisplayKeys,
  isDisplayOnlyOrganizationState,
  toDisplayWarning,
  toDisplayWarnings,
} from '@/lib/tenant-scope'
import { accessTokenWith } from './_jwt-helper'

const ORG_A = 101
const ORG_B = 202

function seedSession(organizationId: number, permissions: string[] = ['project:view']) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'a@b.com',
      fullName: '甲',
      organizations: [
        { id: ORG_A, name: '甲组织', slug: 'a', role: 'owner' },
        { id: ORG_B, name: '乙组织', slug: 'b', role: 'viewer' },
      ],
    },
    accessToken: accessTokenWith(permissions, { organizationId }),
    refreshToken: 'r1',
  })
}

describe('前端组织切换（§7.4）', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    vi.unstubAllGlobals()
  })

  // v3-multitenant-tenant-identification §4.1/§8.2 起，`switchOrganization` 从
  // "复用未认证的 refresh 轮换"改为走受保护端点 `POST /account/organization-selection`。
  // 下面三条用例随之更新，行为差异与理由逐条记在各用例注释里。
  test('切换组织后组织与权限声明整体按新组织重载', async () => {
    seedSession(ORG_A, ['project:view', 'project:create'])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            effectiveContext: {
              actorRef: 'user:1',
              organizationId: ORG_B,
              scopeMode: 'tenant',
              selectionSource: 'server_selection',
              resolutionReason: 'RESOLVED',
              scopeHash: 'hash-b',
              resolvedAt: new Date().toISOString(),
              warningCodes: [],
              isSuperAdmin: false,
            },
            scopeHash: 'hash-b',
            accessToken: accessTokenWith(['project:view'], { organizationId: ORG_B }),
            selectionEpoch: 2,
          },
        }),
      }),
    )

    await useAuthStore.getState().switchOrganization(ORG_B)
    const s = useAuthStore.getState()
    expect(s.currentOrganizationId).toBe(ORG_B)
    // 旧组织的权限不得残留——否则 UI 会按甲组织的权限渲染乙组织的页面。
    expect(s.permissions).toEqual(['project:view'])
    expect(s.hasPermission('project:create')).toBe(false)
  })

  test('本地组织列表之外的目标也交由服务端裁决（不再本地预拦）', async () => {
    seedSession(ORG_A)
    // 行为变更：旧实现先查本地 `user.organizations`，不在列表就抛「无权切换到该组织」
    // 且不发请求。那层 UX 前置门会把**owner-without-member-row**的用户挡在自己组织外面
    //（服务端 `TenantResolutionService` 支持 owner fallback，本地列表却只有成员行）。
    // 现在一律交服务端裁决：非成员由后端统一 404 隐藏。
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'RESOURCE_NOT_FOUND', message: '组织不存在' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(useAuthStore.getState().switchOrganization(999)).rejects.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().currentOrganizationId).toBe(ORG_A)
  })

  test('服务端拒绝切换：保留当前组织，绝不落到目标组织', async () => {
    seedSession(ORG_A)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'RESOURCE_NOT_FOUND', message: '组织不存在' } }),
      }),
    )

    await expect(useAuthStore.getState().switchOrganization(ORG_B)).rejects.toBeTruthy()
    // 行为变更：旧实现走 refresh 轮换，`performRefresh` 失败时会 `clear()` 整个会话——
    // 那是 refresh 路径的副作用，不是刻意的安全设计（误点一个无权组织不该被登出）。
    // 新实现在拒绝时**根本没有修改过任何 token 或组织态**，因此不存在"与 token 不一致
    // 的组织态"，保留当前组织既安全又不打断用户。
    const s = useAuthStore.getState()
    expect(s.currentOrganizationId).toBe(ORG_A)
    expect(s.isAuthenticated).toBe(true)
    // 关键不变量仍然成立：绝不落到目标组织。
    expect(s.currentOrganizationId).not.toBe(ORG_B)
    expect(s.effectiveTenantContext).toBeNull()
  })
})

/** 权限门控组件的最小替身：无权时隐藏，降级时渲染低敏提示。 */
function ScopedPanel({ warning }: { warning?: unknown }) {
  const canView = useAuthStore((s) => s.hasPermission('report:export'))
  const displayWarning = toDisplayWarning(warning)
  if (!canView) return <div data-testid="fallback">无查看权限</div>
  return (
    <div data-testid="panel">
      <span>导出面板</span>
      {displayWarning ? <p data-testid="warning">{displayWarning.message}</p> : null}
    </div>
  )
}

describe('未授权隐藏与降级渲染（§7.4）', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
  })

  test('无权限时面板隐藏，且回退文案不暴露任何目标信息', () => {
    seedSession(ORG_A, ['project:view'])
    render(<ScopedPanel />)
    expect(screen.queryByTestId('panel')).toBeNull()
    expect(screen.getByTestId('fallback').textContent).toBe('无查看权限')
  })

  test('有权限时渲染面板；降级 warning 以低敏中文文案展示', () => {
    seedSession(ORG_A, ['report:export'])
    render(<ScopedPanel warning={{ code: 'DEGRADED_ADAPTER_MODULE' }} />)
    expect(screen.getByTestId('panel')).toBeTruthy()
    expect(screen.getByTestId('warning').textContent).toContain('已降级为实时计算')
  })
})

describe('低敏 warning 与 scope 标签（§7.3）', () => {
  test('warning 文案只由 code 决定，服务端 message 绝不透传', () => {
    const hostile = {
      code: 'CROSS_ORGANIZATION_BLOCKED',
      reasonCode: 'MIXED_TENANT_REFERENCE',
      // 服务端（或被篡改的响应）夹带隐藏细节：目标名、计数、他组织归属
      message: '项目「乙组织的机密项目」不属于组织 202（共 37 条被过滤）',
    }
    const displayed = toDisplayWarning(hostile)
    expect(displayed).not.toBeNull()
    expect(displayed!.code).toBe('CROSS_ORGANIZATION_BLOCKED')
    expect(displayed!.message).toBe('该操作涉及当前组织之外的数据，已被阻止。')
    for (const leak of ['乙组织的机密项目', '202', '37']) {
      expect(displayed!.message).not.toContain(leak)
    }
  })

  test('未知 warning code 一律丢弃，不做原样显示兜底', () => {
    expect(toDisplayWarning({ code: 'NOT_A_REAL_CODE', message: '任意文本' })).toBeNull()
    expect(toDisplayWarning(null)).toBeNull()
    expect(toDisplayWarning('CROSS_ORGANIZATION_BLOCKED')).toBeNull()
    expect(
      toDisplayWarnings([
        { code: 'NO_ACTIVE_TENANT' },
        { code: 'NOT_A_REAL_CODE' },
        { code: 'STALE_SCOPE_SNAPSHOT' },
      ]).map((w) => w.code),
    ).toEqual(['NO_ACTIVE_TENANT', 'STALE_SCOPE_SNAPSHOT'])
  })

  test('scope 标签低敏：只含 ID 与 scope hash，无禁止字段', () => {
    const labels = describeTenantScopeForDisplay({
      organizationId: ORG_A,
      projectId: 7,
      projectName: '甲项目',
    })
    expect(labels).not.toBeNull()
    expect(labels!.organizationId).toBe(ORG_A)
    expect(labels!.organizationScopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(labels!.projectScopeHash).toMatch(/^[0-9a-f]{16}$/)
    expect(detectForbiddenDisplayKeys(labels)).toEqual([])
  })

  test('组织 scope hash 跨组织互不相同（UI 不能拿别组织的 hash 当自己的）', () => {
    const a = describeTenantScopeForDisplay({ organizationId: ORG_A })
    const b = describeTenantScopeForDisplay({ organizationId: ORG_B })
    expect(a!.organizationScopeHash).not.toBe(b!.organizationScopeHash)
  })

  test('无有效组织时返回 null，调用方据此渲染空态而非猜一个组织', () => {
    for (const organizationId of [null, undefined, 0, -1, Number.NaN]) {
      expect(describeTenantScopeForDisplay({ organizationId })).toBeNull()
    }
  })

  test('UI 组织状态显式标记为 display-only', () => {
    expect(isDisplayOnlyOrganizationState).toBe(true)
  })
})
