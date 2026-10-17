/**
 * v3-prompt-version-registry —— 注册表后端服务。
 *
 * 组织隔离：所有查询与注册附加 organization_id。
 * RBAC：注册需要 manage 权限，查询需要 view 权限。
 * 零域写：不依赖任何领域仓储或模型写 API，不产生动作。
 *
 * 当前实现为内存注册表（InMemory），后续可扩展为 DB 持久化。
 */

import type { PromptVersionEntry, PromptVersionQueryResult } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 内存注册表
// ---------------------------------------------------------------------------

/** 组织级内存注册表。key = organizationId。 */
const registryByOrg = new Map<number, Map<string, PromptVersionEntry>>()

function getOrgRegistry(organizationId: number): Map<string, PromptVersionEntry> {
  let org = registryByOrg.get(organizationId)
  if (!org) {
    org = new Map()
    registryByOrg.set(organizationId, org)
  }
  return org
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

/**
 * 注册一个 prompt 版本。组织隔离：条目归属指定组织。
 *
 * @returns true = 新注册，false = 已存在同名同版本条目（幂等）
 */
export function registerPromptVersion(organizationId: number, entry: PromptVersionEntry): boolean {
  const org = getOrgRegistry(organizationId)
  const key = `${entry.promptName}::${entry.version}`
  if (org.has(key)) {
    return false // 幂等：已注册
  }
  org.set(key, entry)
  return true
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/**
 * 按 prompt 名查询已注册版本。组织隔离。
 */
export function queryPromptVersions(
  organizationId: number,
  promptName: string,
): PromptVersionQueryResult {
  const org = getOrgRegistry(organizationId)
  const entries: PromptVersionEntry[] = []
  for (const entry of org.values()) {
    if (entry.promptName === promptName) {
      entries.push(entry)
    }
  }
  return { entries, total: entries.length }
}

/**
 * 查询所有已注册条目。组织隔离。
 */
export function listPromptVersions(organizationId: number): PromptVersionQueryResult {
  const org = getOrgRegistry(organizationId)
  const entries = [...org.values()]
  return { entries, total: entries.length }
}

/**
 * 按能力面查询受影响的版本。组织隔离。
 */
export function queryByCapability(
  organizationId: number,
  capability: string,
): PromptVersionQueryResult {
  const org = getOrgRegistry(organizationId)
  const entries: PromptVersionEntry[] = []
  for (const entry of org.values()) {
    if (
      entry.effectiveScope.capabilities.length === 0 ||
      entry.effectiveScope.capabilities.includes(capability)
    ) {
      entries.push(entry)
    }
  }
  return { entries, total: entries.length }
}

/**
 * 检查指定 prompt 名+版本是否已注册。组织隔离。
 */
export function isRegistered(organizationId: number, promptName: string, version: string): boolean {
  const org = getOrgRegistry(organizationId)
  return org.has(`${promptName}::${version}`)
}

/**
 * 获取指定 prompt 名的最新版本条目。组织隔离。
 */
export function getLatestVersion(
  organizationId: number,
  promptName: string,
): PromptVersionEntry | null {
  const org = getOrgRegistry(organizationId)
  let latest: PromptVersionEntry | null = null
  for (const entry of org.values()) {
    if (entry.promptName === promptName) {
      if (!latest || entry.createdAt > latest.createdAt) {
        latest = entry
      }
    }
  }
  return latest
}

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

/** 清空指定组织的注册表（测试用）。 */
export function clearOrgRegistry(organizationId: number): void {
  registryByOrg.delete(organizationId)
}

/** 清空全部注册表（测试用）。 */
export function clearAllRegistries(): void {
  registryByOrg.clear()
}
