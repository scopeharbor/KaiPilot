/**
 * v2-5-compiler-config-management-api —— CompilerConfigService（切片 1/2/3）。
 *
 * 切片 1：生效配置解析（org active profile 覆盖 → env → 系统默认）、原始 profile + 版本历史读取。
 * 切片 2：预览（校验 + 差异 + 解析影响，不写库不执行）。
 * 切片 3：受控编排写入（创建/新版本/激活/停用 + 审计）。
 *
 * 全部强制 organizationId 隔离。
 */
import env from '#start/env'
import CompilerConfigProfile from '#models/compiler_config_profile'
import AuditService from '#services/audit_service'
import type {
  CompilerConfigProfileInput,
  CompilerEffectiveConfig,
  CompilerConfigPreviewResponse,
  CompilerConfigDiffEntry,
  CompilerConfigProfileView,
  CompilerConfigProfileHistoryResponse,
  CompilerConfigCommittedView,
  CompilerFeatureToggles,
  CompilerCachePolicy,
} from '@aiproj/types/compiler-config-management'
import { COMPILER_CONFIG_FEATURE_TOGGLES } from '@aiproj/types/compiler-config-management'

// ── 系统默认 ──

/** 系统级默认 feature toggles。 */
const SYSTEM_DEFAULT_FEATURES: CompilerFeatureToggles = {
  stageCacheEnabled: true,
}

/** 系统默认缓存策略版本（对应 stage_cache_fingerprint.STAGE_CACHE_POLICY_VERSION）。 */
const SYSTEM_DEFAULT_CACHE_POLICY_VERSION = '1'

/** 系统默认 TTL（秒）。 */
const SYSTEM_DEFAULT_CACHE_TTL = 3600

/** 系统默认 store 偏好。 */
const SYSTEM_DEFAULT_CACHE_STORE = 'auto' as const

// =============================================================================
// 切片 1 —— 只读解析 API
// =============================================================================

/**
 * 获取组织生效配置。
 * 解析顺序：org active profile 覆盖 → env → 系统默认（design D4）。
 */
export async function getEffectiveConfig(organizationId: number): Promise<CompilerEffectiveConfig> {
  const activeProfile = await CompilerConfigProfile.activeForOrganization(organizationId)

  if (!activeProfile) {
    // 无 profile：全部回落 env/系统默认
    const toggles = resolveFeatureToggles(undefined)
    return {
      organizationId,
      sourceVersion: null,
      source: 'system_default',
      featureToggles: toggles,
      budgetPolicyNames: [],
      cachePolicyVersion: env.get(
        'COMPILER_STAGE_CACHE_POLICY_VERSION',
        SYSTEM_DEFAULT_CACHE_POLICY_VERSION,
      ),
      cacheTtlSeconds: SYSTEM_DEFAULT_CACHE_TTL,
      cacheStoreKind: SYSTEM_DEFAULT_CACHE_STORE,
    }
  }

  const featureToggles = resolveFeatureToggles(activeProfile.parsedFeatureToggles)
  const budgetPolicies = activeProfile.parsedBudgetPolicies
  const cachePolicy = activeProfile.parsedCachePolicy

  return {
    organizationId,
    sourceVersion: activeProfile.version,
    source: 'profile',
    featureToggles,
    budgetPolicyNames: budgetPolicies.map((p: Record<string, unknown>) => String(p.name ?? '')),
    cachePolicyVersion: String(cachePolicy?.policyVersion ?? SYSTEM_DEFAULT_CACHE_POLICY_VERSION),
    cacheTtlSeconds: Number(cachePolicy?.ttlSeconds ?? SYSTEM_DEFAULT_CACHE_TTL),
    cacheStoreKind: String(
      cachePolicy?.storeKind ?? SYSTEM_DEFAULT_CACHE_STORE,
    ) as CompilerEffectiveConfig['cacheStoreKind'],
  }
}

/**
 * 获取组织 profile 原始数据与版本历史（低敏视图）。
 */
export async function getProfileHistory(
  organizationId: number,
): Promise<CompilerConfigProfileHistoryResponse> {
  const profiles = await CompilerConfigProfile.forOrganization(organizationId).orderBy(
    'version',
    'desc',
  )

  const views: CompilerConfigProfileView[] = profiles.map(toProfileView)
  const active = views.find((v) => v.isActive) ?? null

  return {
    organizationId,
    activeVersion: active?.version ?? null,
    current: active,
    history: views,
  }
}

// =============================================================================
// 切片 2 —— 只读 preview / 差异
// =============================================================================

/**
 * 预览配置改动（只读，不写库、不执行）。
 * 返回校验结果 + 差异 + 解析影响预览 + 预计新版本号。
 */
export async function previewConfig(
  organizationId: number,
  input: CompilerConfigProfileInput,
): Promise<CompilerConfigPreviewResponse> {
  const errors: string[] = []

  // 1. 校验 featureToggles
  const toggles = input.featureToggles ?? {}
  for (const key of Object.keys(toggles)) {
    if (!(COMPILER_CONFIG_FEATURE_TOGGLES as readonly string[]).includes(key)) {
      errors.push(`未知开关: ${key}`)
    }
  }

  // 2. 校验 budgetPolicies（浅校验：检查 name/scope/scopeValue）
  const policies = input.budgetPolicies ?? []
  for (const [i, p] of policies.entries()) {
    if (!p.name || !p.scope || !p.scopeValue) {
      errors.push(`budgetPolicies[${i}] 缺必要字段 (name/scope/scopeValue)`)
    }
  }

  // 3. 校验 cachePolicy
  const cachePolicy = input.cachePolicy
  if (cachePolicy) {
    if (cachePolicy.policyVersion !== undefined && typeof cachePolicy.policyVersion !== 'string') {
      errors.push('cachePolicy.policyVersion 必须为字符串')
    }
    if (
      cachePolicy.ttlSeconds !== undefined &&
      (typeof cachePolicy.ttlSeconds !== 'number' || cachePolicy.ttlSeconds <= 0)
    ) {
      errors.push('cachePolicy.ttlSeconds 必须为正整数')
    }
    if (
      cachePolicy.storeKind !== undefined &&
      !['memory', 'redis', 'auto'].includes(cachePolicy.storeKind)
    ) {
      errors.push('cachePolicy.storeKind 必须为 memory/redis/auto')
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      validationErrors: errors,
      diff: [],
      impactPreview: { featureToggles: {}, budgetPolicyNames: [], cachePolicyVersion: '' },
      prospectiveVersion: 0,
    }
  }

  // 4. 计算差异
  const activeProfile = await CompilerConfigProfile.activeForOrganization(organizationId)
  const diffs = computeDiffs(activeProfile, input)

  // 5. 计算影响预览
  const mergedToggles = { ...resolveFeatureToggles(undefined), ...(toggles ?? {}) }
  const mergedPolicyNames = policies.map((p) => String(p.name ?? ''))
  const mergedCacheVersion = cachePolicy?.policyVersion ?? SYSTEM_DEFAULT_CACHE_POLICY_VERSION

  // 6. 预计新版本号
  const latest = await CompilerConfigProfile.forOrganization(organizationId)
    .orderBy('version', 'desc')
    .first()
  const prospectiveVersion = (latest?.version ?? 0) + 1

  return {
    valid: true,
    validationErrors: [],
    diff: diffs,
    impactPreview: {
      featureToggles: mergedToggles,
      budgetPolicyNames: mergedPolicyNames,
      cachePolicyVersion: mergedCacheVersion,
    },
    prospectiveVersion,
  }
}

// =============================================================================
// 切片 3 —— 受控编排写入
// =============================================================================

/**
 * 创建配置 profile（新版本）。
 * 需显式确认（confirm=true）才写入。
 */
export async function createConfigProfile(
  organizationId: number,
  userId: number,
  input: CompilerConfigProfileInput & { confirm: boolean },
): Promise<CompilerConfigCommittedView> {
  if (!input.confirm) {
    throw new Error('配置创建必须显式确认（confirm=true）')
  }

  // 计算新版本号
  const latest = await CompilerConfigProfile.forOrganization(organizationId)
    .orderBy('version', 'desc')
    .first()
  const newVersion = (latest?.version ?? 0) + 1

  // 序列化 JSON
  const featureToggles = JSON.stringify(input.featureToggles ?? {})
  const budgetPolicies = JSON.stringify(input.budgetPolicies ?? [])
  const cachePolicy = input.cachePolicy ? JSON.stringify(input.cachePolicy) : null

  await CompilerConfigProfile.create({
    organizationId,
    version: newVersion,
    isActive: true,
    featureToggles,
    budgetPolicies,
    cachePolicy,
    createdBy: userId,
  })

  // 审计
  const budgetNames = (input.budgetPolicies ?? []).map((p) => p.name)
  await new AuditService().log({
    event: 'AI_COMPILER_CONFIG_CREATED',
    userId,
    organizationId,
    metadata: {
      version: newVersion,
      featureToggleCount: Object.keys(input.featureToggles ?? {}).length,
      budgetPolicyCount: (input.budgetPolicies ?? []).length,
      hasCachePolicy: !!input.cachePolicy,
      action: 'create',
    },
  })

  return {
    version: newVersion,
    isActive: true,
    featureToggles: input.featureToggles ?? {},
    budgetPolicyNames: budgetNames.filter(Boolean) as string[],
    cachePolicy: input.cachePolicy ?? ({} as CompilerCachePolicy),
  }
}

/**
 * 激活/停用配置版本。
 */
export async function activateConfigProfile(
  organizationId: number,
  userId: number,
  version: number,
  active: boolean,
  confirm: boolean,
): Promise<CompilerConfigCommittedView> {
  if (!confirm) {
    throw new Error('配置激活/停用必须显式确认（confirm=true）')
  }

  const profile = await CompilerConfigProfile.forOrganization(organizationId)
    .where('version', version)
    .first()

  if (!profile) {
    throw new Error(`配置版本 ${version} 不存在`)
  }

  profile.isActive = active
  await profile.save()

  // 审计
  await new AuditService().log({
    event: active ? 'AI_COMPILER_CONFIG_ACTIVATED' : 'AI_COMPILER_CONFIG_DEACTIVATED',
    userId,
    organizationId,
    metadata: {
      version,
      action: active ? 'activate' : 'deactivate',
    },
  })

  const parsedToggles = profile.parsedFeatureToggles
  const parsedPolicies = profile.parsedBudgetPolicies

  return {
    version: profile.version,
    isActive: profile.isActive,
    featureToggles: parsedToggles,
    budgetPolicyNames: parsedPolicies.map((p: Record<string, unknown>) => String(p.name ?? '')),
    cachePolicy: profile.parsedCachePolicy ?? ({} as CompilerCachePolicy),
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * 解析 feature toggles。
 * 优先级：组织 profile → env → 系统默认。
 */
function resolveFeatureToggles(
  profileToggles: Record<string, boolean> | undefined,
): CompilerFeatureToggles {
  const result: CompilerFeatureToggles = { ...SYSTEM_DEFAULT_FEATURES }

  // env 覆盖（COMPILER_STAGE_CACHE_ENABLED 为 boolean.optional()，未设置时为 undefined）
  const envEnabled = env.get('COMPILER_STAGE_CACHE_ENABLED')
  if (envEnabled !== undefined) {
    result.stageCacheEnabled = envEnabled
  }

  // profile 覆盖
  if (profileToggles && typeof profileToggles === 'object') {
    for (const key of Object.keys(profileToggles)) {
      if ((COMPILER_CONFIG_FEATURE_TOGGLES as readonly string[]).includes(key)) {
        result[key as keyof CompilerFeatureToggles] = profileToggles[key]
      }
    }
  }

  return result
}

/**
 * 计算配置差异。
 */
function computeDiffs(
  activeProfile: CompilerConfigProfile | null,
  input: CompilerConfigProfileInput,
): CompilerConfigDiffEntry[] {
  const diffs: CompilerConfigDiffEntry[] = []

  // featureToggles 差异
  const currentToggles = activeProfile?.parsedFeatureToggles ?? {}
  const newToggles = input.featureToggles ?? {}
  const allToggleKeys = new Set([...Object.keys(currentToggles), ...Object.keys(newToggles)])

  for (const key of allToggleKeys) {
    const oldVal =
      key in currentToggles ? (currentToggles as Record<string, boolean | undefined>)[key] : null
    const newVal =
      key in newToggles ? (newToggles as Record<string, boolean | undefined>)[key] : null
    if (oldVal !== newVal) {
      const change = oldVal === null ? 'added' : newVal === null ? 'removed' : 'modified'
      diffs.push({
        path: `featureToggles.${key}`,
        before: oldVal ?? null,
        after: newVal ?? null,
        change,
      })
    }
  }

  // budgetPolicies 差异（仅对比策略名数量）
  const currentPolicyCount = activeProfile
    ? (activeProfile.parsedBudgetPolicies as Record<string, unknown>[]).length
    : 0
  const newPolicyCount = (input.budgetPolicies ?? []).length
  if (currentPolicyCount !== newPolicyCount) {
    diffs.push({
      path: 'budgetPolicies',
      before: currentPolicyCount,
      after: newPolicyCount,
      change: currentPolicyCount === 0 && newPolicyCount > 0 ? 'added' : 'modified',
    })
  }

  // cachePolicy 差异
  const currentCache = activeProfile?.parsedCachePolicy ?? {}
  const newCache = input.cachePolicy ?? {}
  const cachePaths = ['policyVersion', 'ttlSeconds', 'storeKind'] as const
  for (const field of cachePaths) {
    const oldVal =
      field in currentCache ? String((currentCache as Record<string, unknown>)[field] ?? '') : null
    const newVal =
      field in newCache ? String((newCache as Record<string, unknown>)[field] ?? '') : null
    if (oldVal !== newVal) {
      diffs.push({
        path: `cachePolicy.${field}`,
        before: oldVal,
        after: newVal,
        change: oldVal === null ? 'added' : newVal === null ? 'removed' : 'modified',
      })
    }
  }

  return diffs
}

/**
 * 低敏 Profile 视图转换。
 */
function toProfileView(profile: CompilerConfigProfile): CompilerConfigProfileView {
  const parsedToggles = profile.parsedFeatureToggles
  const parsedPolicies = profile.parsedBudgetPolicies as Record<string, unknown>[]

  return {
    version: profile.version,
    isActive: profile.isActive,
    featureToggles: parsedToggles,
    budgetPolicyNames: parsedPolicies.map((p) => String(p.name ?? '')),
    cachePolicy: profile.parsedCachePolicy ?? ({} as CompilerCachePolicy),
    createdBy: profile.createdBy,
    createdAt: profile.createdAt.toISO() ?? '',
  }
}
