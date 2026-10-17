/**
 * v3-copilot-optional-web-search-configuration §B — 组织级网页搜索设置服务。
 *
 * 职责：
 * - 组织设置以 JSON 存 OrganizationSetting 单键（`copilot.web_search.settings`）
 * - 无记录 = 默认关闭（fail-closed）
 * - provider 连接只存 ID（引用既有 AI connection 密文 key），GET 只回
 *   `configured: boolean` + 脱敏标签，永不回 credential
 * - 设置变更需要 `copilot:web_search:manage` 权限并落低敏审计
 * - 每自然日搜索额度计数（尽力而为，防并发下的过度计数；不引入锁）
 *
 * 禁存边界：本服务字段不含 API key、搜索词原文、网页正文、prompt、输出与 token。
 *
 * 双层同意（2026-10-05，用户决策）：
 * - 超级管理员在「平台统一 AI 配置」组织（slug=platform-ai）里开启 = 平台同意；
 * - 个人帐号（free 且只有本人的个人组织，如 Google 登录自动建立的）：平台同意即可用，
 *   沿用平台的提供方、密钥与来源限制（个人组织自己的设置不参与）；
 * - 团队 / 企业组织：平台同意 且 本组织管理员开启 才可用，提供方与限制用本组织的；
 * - 部署里还没有平台组织时（本地 / 测试），只看本组织开关（与旧行为一致）。
 * 此前开关只按「当前组织」读：超级管理员在平台组织开启后，Google 登录的个人组织、
 * 其他组织都读不到，开了也用不了。
 */

import OrganizationSetting from '#models/organization_setting'
import AiConnection from '#models/ai_connection'
import AuditService, { AuditEvent } from '#services/audit_service'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { COPILOT_WEB_SEARCH_MANAGE } from '#rbac'
import type {
  CopilotWebSearchProviderKind,
  CopilotWebSearchSettings,
  CopilotWebSearchSettingsSummary,
} from '@aiproj/types'
import {
  COPILOT_WEB_SEARCH_PROVIDER_KEY_KEY,
  COPILOT_WEB_SEARCH_PROVIDER_META,
  COPILOT_WEB_SEARCH_SETTINGS_KEY,
  COPILOT_WEB_SEARCH_QUOTA_KEY_PREFIX,
  defaultCopilotWebSearchSettings,
} from '@aiproj/types'
import type { CopilotWebSearchGovernance, CopilotWebSearchGovernanceMode } from '@aiproj/types'
import CryptoService from '#services/crypto_service'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import { editionHooks } from '#services/edition/edition_registry'
import { ValidationException } from '#exceptions/api_exception'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'

/** 设置变更入参（合法值由 validator 层保证；本服务只做形状安全）。 */
export interface CopilotWebSearchSettingsInput {
  enabled?: boolean
  providerConnectionId?: number | null
  allowedDomains?: string[]
  deniedDomains?: string[]
  dailyQueryLimit?: number
  maxResultsPerQuery?: number
  timeoutMs?: number
  cacheTtlMinutes?: number
  retainDecisionDays?: number
  allowForAiCreate?: boolean
  allowForGeneralCopilot?: boolean
  providerKind?: CopilotWebSearchProviderKind
  providerBaseUrl?: string | null
  /** 只写：新密钥明文（加密后单独存放）；空串 = 清除；未提供 = 不变。 */
  providerApiKey?: string | null
}

/** 回合内使用的提供方配置（含解密后的密钥，只在服务端内存中使用）。 */
export interface CopilotWebSearchRuntimeProvider {
  kind: CopilotWebSearchProviderKind
  apiKey: string | null
  baseUrl: string | null
  timeoutMs: number
}

export interface CopilotWebSearchQuotaState {
  /** 今日已用次数。 */
  currentCount: number
  /** 今日窗口开始 ISO（UTC 自然日）。 */
  windowStart: string
}

/**
 * 每次「调用 provider」前的配额计数。
 * 窗口 = UTC 自然日；计数持久化在 OrganizationSetting（尽力而为）。
 */
export interface CopilotWebSearchQuotaConsumeResult {
  allowed: boolean
  currentCount: number
  limit: number
}

/** 双层同意解析结果。 */
export interface CopilotWebSearchResolution {
  governance: CopilotWebSearchGovernance
  /** 回合用设置：enabled 与场景开关已是两层同意后的生效值。 */
  settings: CopilotWebSearchSettings
  /** 提供方与密钥取自哪个组织（个人帐号用平台的）。 */
  providerOrganizationId: number
}

/** 低敏 provider 标签（脱敏；不含任何 key 材料）。 */
export interface CopilotWebSearchProviderStatus {
  configured: boolean
  maskedLabel: string | null
  connectionId: number | null
}

@inject()
export default class CopilotWebSearchSettingsService {
  #audit: AuditService
  #rbac: RbacService

  constructor(audit?: AuditService, rbac?: RbacService) {
    this.#audit = audit ?? new AuditService()
    this.#rbac = rbac ?? new RbacService()
  }

  /**
   * 读取组织设置；无记录 / 解析失败一律回退默认（fail-closed 关闭）。
   */
  async getSettings(organizationId: number): Promise<CopilotWebSearchSettings> {
    try {
      const setting = await OrganizationSetting.query()
        .where('organization_id', organizationId)
        .where('key', COPILOT_WEB_SEARCH_SETTINGS_KEY)
        .first()
      if (!setting) return defaultCopilotWebSearchSettings(organizationId)
      const parsed = JSON.parse(setting.value) as Partial<CopilotWebSearchSettings>
      return this.#mergeDefaults(organizationId, parsed)
    } catch (err) {
      logger.error({ err, organizationId }, '读取网页搜索组织设置失败，回退默认关闭')
      return defaultCopilotWebSearchSettings(organizationId)
    }
  }

  /**
   * 更新组织设置（RBAC + 审计）。
   * 返回低敏投影；失败抛错由 controller 统一映射。
   */
  async updateSettings(
    user: User,
    organizationId: number,
    input: CopilotWebSearchSettingsInput,
  ): Promise<CopilotWebSearchSettingsSummary> {
    const perm = await this.#rbac.check(user, COPILOT_WEB_SEARCH_MANAGE, organizationId)
    if (!perm.allowed) {
      throw new CopilotWebSearchPermissionDeniedError()
    }
    const mode = await this.#governanceMode(organizationId)
    if (mode.mode === 'personal') {
      throw new ValidationException('个人帐号的网页搜索沿用平台设置，不需要单独设置')
    }

    const current = await this.getSettings(organizationId)
    const merged: CopilotWebSearchSettings = {
      organizationId,
      enabled: input.enabled ?? current.enabled,
      providerConnectionId:
        input.providerConnectionId === undefined
          ? current.providerConnectionId
          : input.providerConnectionId,
      allowedDomains: input.allowedDomains ?? current.allowedDomains,
      deniedDomains: input.deniedDomains ?? current.deniedDomains,
      dailyQueryLimit: input.dailyQueryLimit ?? current.dailyQueryLimit,
      maxResultsPerQuery: input.maxResultsPerQuery ?? current.maxResultsPerQuery,
      timeoutMs: input.timeoutMs ?? current.timeoutMs,
      cacheTtlMinutes: input.cacheTtlMinutes ?? current.cacheTtlMinutes,
      retainDecisionDays: input.retainDecisionDays ?? current.retainDecisionDays,
      requirePerTurnConsent: true, // 本版本锁定：必须按次同意
      allowForAiCreate: input.allowForAiCreate ?? current.allowForAiCreate,
      allowForGeneralCopilot: input.allowForGeneralCopilot ?? current.allowForGeneralCopilot,
      providerKind: input.providerKind ?? current.providerKind ?? 'free',
      providerBaseUrl:
        input.providerBaseUrl === undefined
          ? (current.providerBaseUrl ?? null)
          : input.providerBaseUrl?.trim() || null,
    }

    if (input.providerApiKey !== undefined) {
      await this.#writeProviderKey(organizationId, input.providerApiKey)
    }

    const json = JSON.stringify(merged)
    const existing = await OrganizationSetting.query()
      .where('organization_id', organizationId)
      .where('key', COPILOT_WEB_SEARCH_SETTINGS_KEY)
      .first()
    if (existing) {
      existing.value = json
      await existing.save()
    } else {
      await OrganizationSetting.create({
        organizationId,
        key: COPILOT_WEB_SEARCH_SETTINGS_KEY,
        value: json,
      })
    }

    // 低敏审计：不回 secret；只记开关与轮廓（enabled/domain 数量/额度/provider 是否配置）。
    try {
      await this.#audit.log({
        event: AuditEvent.COPILOT_WEB_SEARCH_SETTINGS_UPDATED,
        userId: user.id,
        organizationId,
        entityType: 'copilot_web_search_settings',
        metadata: {
          enabled: merged.enabled,
          providerConfigured: !!merged.providerConnectionId,
          providerKind: merged.providerKind,
          providerKeyChanged: input.providerApiKey !== undefined,
          allowedDomainCount: merged.allowedDomains.length,
          deniedDomainCount: merged.deniedDomains.length,
          dailyQueryLimit: merged.dailyQueryLimit,
          allowForAiCreate: merged.allowForAiCreate,
          allowForGeneralCopilot: merged.allowForGeneralCopilot,
        },
      })
    } catch (err) {
      logger.warn({ err, organizationId }, '网页搜索设置审计落账失败（不阻断）')
    }

    return this.buildSummary(organizationId, merged)
  }

  /**
   * 解析双层同意（见文件头）：返回生效设置、授权来源与提供方所属组织。
   * `ownOverride` 用于保存后立即回投影（避免再读一次库）。
   */
  async resolveEffective(
    organizationId: number,
    ownOverride?: CopilotWebSearchSettings,
  ): Promise<CopilotWebSearchResolution> {
    const own = ownOverride ?? (await this.getSettings(organizationId))
    const { mode, platformOrganizationId } = await this.#governanceMode(organizationId)
    const governance = (
      platformApproved: boolean,
      organizationApproved: boolean,
      settings: CopilotWebSearchSettings,
    ): CopilotWebSearchGovernance => ({
      mode,
      platformApproved,
      organizationApproved,
      effectiveEnabled: settings.enabled && settings.allowForGeneralCopilot,
    })

    if (mode === 'platform' || platformOrganizationId === null) {
      return {
        governance: governance(mode === 'platform' ? own.enabled : true, own.enabled, own),
        settings: own,
        providerOrganizationId: organizationId,
      }
    }

    const platform = await this.getSettings(platformOrganizationId)
    if (mode === 'personal') {
      const settings: CopilotWebSearchSettings = { ...platform, organizationId }
      return {
        governance: governance(platform.enabled, platform.enabled, settings),
        settings,
        providerOrganizationId: platformOrganizationId,
      }
    }

    const settings: CopilotWebSearchSettings = {
      ...own,
      enabled: own.enabled && platform.enabled,
      allowForGeneralCopilot: own.allowForGeneralCopilot && platform.allowForGeneralCopilot,
      allowForAiCreate: own.allowForAiCreate && platform.allowForAiCreate,
    }
    return {
      governance: governance(platform.enabled, own.enabled, settings),
      settings,
      providerOrganizationId: organizationId,
    }
  }

  /** 回合用的生效设置（工具门用；两层同意都满足才 enabled）。 */
  async getEffectiveSettings(organizationId: number): Promise<CopilotWebSearchSettings> {
    try {
      const resolution = await this.resolveEffective(organizationId)
      return resolution.settings
    } catch (err) {
      logger.error({ err, organizationId }, '解析网页搜索生效设置失败，回退默认关闭')
      return defaultCopilotWebSearchSettings(organizationId)
    }
  }

  /** 授权来源：平台组织 / 个人帐号 / 团队企业组织。 */
  async #governanceMode(organizationId: number): Promise<{
    mode: CopilotWebSearchGovernanceMode
    platformOrganizationId: number | null
  }> {
    // 平台统一配置只存在于私有部署（版本扩展点）；个人版没有平台组织，一律按组织自管
    const platformAi = editionHooks().platformAi
    const platformOrganizationId = platformAi
      ? await platformAi.findPlatformOrganizationId().catch(() => null)
      : null
    if (platformOrganizationId === null) return { mode: 'organization', platformOrganizationId }
    if (platformOrganizationId === organizationId) {
      return { mode: 'platform', platformOrganizationId }
    }
    const org = await Organization.find(organizationId)
    if (org?.planTier === 'free') {
      const members = await OrganizationMember.query()
        .where('organization_id', organizationId)
        .count('* as total')
      const total = Number((members[0]?.$extras as { total?: number | string })?.total ?? 0)
      if (total <= 1) return { mode: 'personal', platformOrganizationId }
    }
    return { mode: 'organization', platformOrganizationId }
  }

  /**
   * 构造低敏投影（GET）：解析 provider 连接的存在性与 key 状态，永不含 credential。
   * 个人帐号展示平台的设置（只读）；其余展示本组织自己的设置，并附双层同意状态。
   */
  async buildSummary(
    organizationId: number,
    settings?: CopilotWebSearchSettings,
  ): Promise<CopilotWebSearchSettingsSummary> {
    const resolution = await this.resolveEffective(organizationId, settings)
    const personal = resolution.governance.mode === 'personal'
    const resolved = personal
      ? resolution.settings
      : (settings ?? (await this.getSettings(organizationId)))
    const providerOrganizationId = resolution.providerOrganizationId
    const provider = await this.resolveProviderStatus(
      providerOrganizationId,
      resolved.providerConnectionId,
    )
    const kind = resolved.providerKind ?? 'free'
    const meta = COPILOT_WEB_SEARCH_PROVIDER_META[kind]
    const keyHint = await this.#readProviderKeyHint(providerOrganizationId)
    // configured：当前提供方所需材料齐全（免费搜索开箱即用；需要密钥/地址的看是否已填）
    const configured =
      (!meta.requiresKey || keyHint !== null) &&
      (!meta.requiresBaseUrl || !!resolved.providerBaseUrl)
    return {
      organizationId,
      enabled: resolved.enabled,
      configured: configured || provider.configured,
      maskedProviderLabel: provider.maskedLabel ?? meta.label,
      providerConnectionId: provider.connectionId,
      allowedDomains: resolved.allowedDomains,
      deniedDomains: resolved.deniedDomains,
      allowedDomainCount: resolved.allowedDomains.length,
      deniedDomainCount: resolved.deniedDomains.length,
      dailyQueryLimit: resolved.dailyQueryLimit,
      maxResultsPerQuery: resolved.maxResultsPerQuery,
      timeoutMs: resolved.timeoutMs,
      cacheTtlMinutes: resolved.cacheTtlMinutes,
      retainDecisionDays: resolved.retainDecisionDays,
      requirePerTurnConsent: true,
      allowForAiCreate: resolved.allowForAiCreate,
      allowForGeneralCopilot: resolved.allowForGeneralCopilot,
      providerKind: kind,
      providerBaseUrl: resolved.providerBaseUrl ?? null,
      providerKeyConfigured: keyHint !== null,
      providerKeyHint: personal ? null : keyHint,
      governance: resolution.governance,
    }
  }

  /** 回合用提供方配置：解密密钥（失败按未配置处理，由提供方退回免费搜索）。个人帐号用平台的。 */
  async resolveRuntimeProvider(organizationId: number): Promise<CopilotWebSearchRuntimeProvider> {
    const resolution = await this.resolveEffective(organizationId)
    const resolved = resolution.settings
    let apiKey: string | null = null
    try {
      const row = await this.#providerKeyRow(resolution.providerOrganizationId)
      if (row?.value) apiKey = new CryptoService().decrypt(row.value)
    } catch (err) {
      logger.warn({ err, organizationId }, '网页搜索提供方密钥解密失败，按未配置处理')
    }
    return {
      kind: resolved.providerKind ?? 'free',
      apiKey,
      baseUrl: resolved.providerBaseUrl ?? null,
      timeoutMs: resolved.timeoutMs,
    }
  }

  #providerKeyRow(organizationId: number) {
    return OrganizationSetting.query()
      .where('organization_id', organizationId)
      .where('key', COPILOT_WEB_SEARCH_PROVIDER_KEY_KEY)
      .first()
  }

  /** 末四位提示；读不到或解密失败返回 null（永不回明文）。 */
  async #readProviderKeyHint(organizationId: number): Promise<string | null> {
    try {
      const row = await this.#providerKeyRow(organizationId)
      if (!row?.value) return null
      const plain = new CryptoService().decrypt(row.value)
      return plain.length >= 4 ? `…${plain.slice(-4)}` : '…'
    } catch {
      return null
    }
  }

  async #writeProviderKey(organizationId: number, plain: string | null): Promise<void> {
    const row = await this.#providerKeyRow(organizationId)
    const trimmed = plain?.trim() ?? ''
    if (!trimmed) {
      if (row) await row.delete()
      return
    }
    const value = new CryptoService().encrypt(trimmed)
    if (row) {
      row.value = value
      await row.save()
    } else {
      await OrganizationSetting.create({
        organizationId,
        key: COPILOT_WEB_SEARCH_PROVIDER_KEY_KEY,
        value,
      })
    }
  }

  /**
   * provider 状态检查（secret-safe）：
   * - 连接不存在 → configured=false
   * - 连接无 key → configured=false
   * - 有 key → configured=true + 脱敏标签（displayName ••••），不含 key 材料
   */
  async resolveProviderStatus(
    organizationId: number,
    connectionId: number | null,
  ): Promise<CopilotWebSearchProviderStatus> {
    if (!connectionId) {
      return { configured: false, maskedLabel: null, connectionId: null }
    }
    try {
      const conn = await AiConnection.query()
        .where('id', connectionId)
        .where('organization_id', organizationId)
        .first()
      if (!conn) return { configured: false, maskedLabel: null, connectionId }
      const hasKey = !!conn.apiKeyEncrypted
      return {
        configured: hasKey,
        maskedLabel: hasKey ? `${conn.displayName} ••••` : `${conn.displayName}（未配置密钥）`,
        connectionId,
      }
    } catch (err) {
      logger.error({ err, organizationId, connectionId }, '解析网页搜索 provider 状态失败')
      return { configured: false, maskedLabel: null, connectionId }
    }
  }

  /**
   * 读取今日配额计数（UTC 自然日窗口；无记录 = 0）。
   */
  async readQuota(
    organizationId: number,
    now: Date = new Date(),
  ): Promise<CopilotWebSearchQuotaState> {
    try {
      const setting = await OrganizationSetting.query()
        .where('organization_id', organizationId)
        .where('key', `${COPILOT_WEB_SEARCH_QUOTA_KEY_PREFIX}${organizationId}`)
        .first()
      if (!setting) {
        return { currentCount: 0, windowStart: this.#dayStart(now).toISOString() }
      }
      const parsed = JSON.parse(setting.value) as { windowStart?: string; count?: number }
      const windowStart = parsed.windowStart ? new Date(parsed.windowStart) : this.#dayStart(now)
      if (windowStart < this.#dayStart(now)) {
        // 跨自然日：窗口已过期，视为新窗口（不写回，待 consume 时重建）
        return { currentCount: 0, windowStart: this.#dayStart(now).toISOString() }
      }
      return {
        currentCount: typeof parsed.count === 'number' ? parsed.count : 0,
        windowStart: windowStart.toISOString(),
      }
    } catch {
      return { currentCount: 0, windowStart: this.#dayStart(now).toISOString() }
    }
  }

  /**
   * 记录一次「已调用 provider」的配额消耗（尽力而为）。
   * 每次真正的 provider 调用前调用一次；失败不阻断搜索但记日志。
   */
  async consumeQuota(organizationId: number): Promise<void> {
    try {
      const dayStart = this.#dayStart().toISOString()
      const key = `${COPILOT_WEB_SEARCH_QUOTA_KEY_PREFIX}${organizationId}`
      const existing = await OrganizationSetting.query()
        .where('organization_id', organizationId)
        .where('key', key)
        .first()
      if (existing) {
        const parsed = JSON.parse(existing.value) as { windowStart?: string; count?: number }
        const windowStart = parsed.windowStart ? new Date(parsed.windowStart) : new Date(dayStart)
        const count = windowStart >= this.#dayStart() ? (parsed.count ?? 0) + 1 : 1
        existing.value = JSON.stringify({ windowStart: dayStart, count })
        await existing.save()
      } else {
        await OrganizationSetting.create({
          organizationId,
          key,
          value: JSON.stringify({ windowStart: dayStart, count: 1 }),
        })
      }
    } catch (err) {
      logger.warn({ err, organizationId }, '网页搜索配额计数失败（尽力而为，不阻断）')
    }
  }

  /** 判定配额是否足额。 */
  quotaAllowed(
    state: CopilotWebSearchQuotaState,
    limit: number,
  ): CopilotWebSearchQuotaConsumeResult {
    const allowed = state.currentCount < limit
    return { allowed, currentCount: state.currentCount, limit }
  }

  #mergeDefaults(
    organizationId: number,
    parsed: Partial<CopilotWebSearchSettings>,
  ): CopilotWebSearchSettings {
    const base = defaultCopilotWebSearchSettings(organizationId)
    return {
      ...base,
      ...parsed,
      organizationId,
      requirePerTurnConsent: true, // 服务端锁定：必须按次同意
    }
  }

  /** UTC 自然日起点。 */
  #dayStart(now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }
}

/** 权限不足（controller 映射 403，非泄露语义）。 */
export class CopilotWebSearchPermissionDeniedError extends Error {
  constructor() {
    super('无权限管理网页搜索设置')
    this.name = 'CopilotWebSearchPermissionDeniedError'
  }
}
