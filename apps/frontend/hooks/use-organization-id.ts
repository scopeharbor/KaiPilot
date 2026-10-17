'use client'

// 当前组织 ID 解析 hook。
// 从 auth store 读取当前组织，回退到 URL 参数，最后回退到 null。
// 供 PMO / 组织级页面统一获取 organizationId。

import { useAuthStore } from '@/stores/auth-store'
import { useSearchParams } from 'next/navigation'

/**
 * 组织 ID 恒为数值；解析不出有效正整数时返回 null（调用方据此禁用查询）。
 * 早期实现会把无法解析的 URL 参数原样以字符串返回，但所有下游 hook 都要求 number，
 * 只会在运行时打出非法请求，故收敛为 `number | null`。
 *
 * **返回值是请求提示，不是 scope 授权**（v3-multitenant-isolation-architecture §7.3）：
 * store 值来自可改写的 token 声明，URL 回退更是纯客户端输入。服务端会用认证态
 * 重新解析组织并校验一致性，不一致统一 404 掩蔽——所以这里的 URL 回退不构成越权面，
 * 但也不要把它当成"已经确认过的组织"来做任何前端安全判断。
 */
export function useOrganizationId(): number | null {
  const currentOrganizationId = useAuthStore((s) => s.currentOrganizationId)
  const searchParams = useSearchParams()

  // 优先用 auth store 的当前组织；URL 参数作为回退（用于测试或显式指定）
  if (currentOrganizationId != null) {
    const fromStore = Number(currentOrganizationId)
    return Number.isFinite(fromStore) && fromStore > 0 ? fromStore : null
  }

  const urlOrgId = searchParams?.get('organizationId') ?? searchParams?.get('orgId')
  if (urlOrgId) {
    const num = Number(urlOrgId)
    return Number.isFinite(num) && num > 0 ? num : null
  }

  return null
}
