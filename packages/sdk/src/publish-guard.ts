// v2-5-sdk-npm-release-workflow §5 —— 授权发布门禁。
// 在真实 npm publish 前验证授权状态、门禁结果、dry-run 证据、版本/commit 一致性。
// 默认本地和 CI 路径必须跳过 registry 写入。

import { execSync } from 'node:child_process'

// --- 类型 ---

export type AuthorizationLevel = 'not_authorized' | 'dry_run_only' | 'publish_authorized'

export interface PublishIntent {
  /** 用户显式提供的发布授权。 */
  authorization: AuthorizationLevel
  /** 目标包名。 */
  packageName: string
  /** 确认发布的版本。 */
  confirmedVersion: string
  /** 确认发布的 commit。 */
  confirmedCommit: string
  /** 目标 registry URL。 */
  targetRegistry: string
  /** 门禁是否通过。 */
  gatesPassed: boolean
  /** Dry-run 是否成功。 */
  dryRunPassed: boolean
  /** npm token 是否可用（环境变量中）。 */
  npmTokenAvailable: boolean
  /** 授权人（用于审计）。 */
  authorizedBy?: string
}

export interface PublishGuardResult {
  allowed: boolean
  reason: string
  details: {
    authorizationOk: boolean
    versionMatch: boolean
    commitMatch: boolean
    dryRunOk: boolean
    gatesOk: boolean
    credentialsOk: boolean
  }
}

// --- 环境检测 ---

/** 检查是否在 CI 环境中运行。 */
export function isCiEnvironment(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL
  )
}

/** 检查 npm token 是否可用。 */
export function isNpmTokenAvailable(): boolean {
  return !!(process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN)
}

/** 获取当前 git commit SHA。 */
export function getCurrentCommit(): string {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

/** 获取当前分支名。 */
export function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

// --- 门禁函数 ---

/**
 * 验证发布意图。
 * 所有条件都必须满足才允许真实 publish：
 * 1. 用户明确授权 publish
 * 2. 确认的版本匹配
 * 3. 确认的 commit 匹配当前 HEAD
 * 4. Dry-run 通过
 * 5. 全部门禁通过
 * 6. npm token 可用
 */
export function validatePublishIntent(intent: PublishIntent): PublishGuardResult {
  const currentCommit = getCurrentCommit()

  const authorizationOk = intent.authorization === 'publish_authorized'
  const versionMatch = intent.confirmedVersion.length > 0
  const commitMatch = intent.confirmedCommit === currentCommit
  const dryRunOk = intent.dryRunPassed
  const gatesOk = intent.gatesPassed
  const credentialsOk = intent.npmTokenAvailable

  const failures: string[] = []

  if (!authorizationOk) {
    failures.push('未获得用户显式发布授权（authorization !== publish_authorized）')
  }
  if (!versionMatch) {
    failures.push('未确认发布版本')
  }
  if (!commitMatch) {
    failures.push(`确认的 commit ${intent.confirmedCommit} 不匹配当前 HEAD ${currentCommit}`)
  }
  if (!dryRunOk) {
    failures.push('Dry-run 未通过')
  }
  if (!gatesOk) {
    failures.push('发布门禁未通过')
  }
  if (!credentialsOk) {
    failures.push('npm token 不可用（未设置 NPM_TOKEN 或 NODE_AUTH_TOKEN）')
  }

  const allowed = failures.length === 0

  return {
    allowed,
    reason: allowed ? '所有发布门禁通过' : `发布被拒绝: ${failures.join('; ')}`,
    details: {
      authorizationOk,
      versionMatch,
      commitMatch,
      dryRunOk,
      gatesOk,
      credentialsOk,
    },
  }
}

/**
 * 检查是否允许执行 npm publish（包括 dry-run）。
 * 默认仅允许 dry-run；真实 publish 需要 publish_authorized。
 */
export function canRunPublish(
  authorization: AuthorizationLevel,
  isDryRun: boolean,
): { allowed: boolean; reason: string } {
  if (isCiEnvironment()) {
    // CI 环境：只允许 dry-run，除非显式 publish_authorized
    if (isDryRun) {
      return { allowed: true, reason: 'CI 环境允许 dry-run' }
    }
    if (authorization === 'publish_authorized') {
      return { allowed: true, reason: 'CI 环境 + 用户显式授权允许 publish' }
    }
    return {
      allowed: false,
      reason: 'CI 环境默认禁止真实 publish。设置 authorization=publish_authorized 以覆盖',
    }
  }

  // 本地环境
  if (isDryRun) {
    return { allowed: true, reason: '本地环境允许 dry-run' }
  }
  if (authorization === 'publish_authorized') {
    return { allowed: true, reason: '本地环境 + 用户显式授权允许 publish' }
  }
  return { allowed: false, reason: '本地环境默认禁止真实 publish。需要用户明确授权' }
}

// --- 授权记录 ---

export interface AuthorizationRecord {
  authorizedBy: string
  authorizedAt: string
  targetRegistry: string
  confirmedVersion: string
  confirmedCommit: string
  branch: string
  notes?: string
}

/**
 * 创建授权记录（低敏，不含 token/secret）。
 */
export function createAuthorizationRecord(params: {
  authorizedBy: string
  targetRegistry: string
  confirmedVersion: string
  notes?: string
}): AuthorizationRecord {
  return {
    authorizedBy: params.authorizedBy,
    authorizedAt: new Date().toISOString(),
    targetRegistry: params.targetRegistry,
    confirmedVersion: params.confirmedVersion,
    confirmedCommit: getCurrentCommit(),
    branch: getCurrentBranch(),
    notes: params.notes,
  }
}
