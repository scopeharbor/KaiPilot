/**
 * TRIZ Skill Layer Service (v3-triz-skill-layer-integration §3.5–3.13)
 *
 * 组合 Manifest Resolver、Activation Adapter、Source Adapters、Stage Binding、
 * Destination Router 和 Handoff Preview Builder，提供 summary、destinations、
 * route preview 和 handoff preview 四个只读闭环。
 *
 * 红线：
 * - 不写正式项目/任务/WBS/资源/风险/里程碑/排程/Blueprint/决策日志/Skill 生命周期/Compiler run 记录
 * - 所有查询强制 organization + project 隔离
 * - 返回仅低敏 refs/hashes/warnings
 */
import { inject } from '@adonisjs/core'
import SkillRegistryService from '#services/compiler/skills/skill_registry_service'
import { isTrizSkillLayerEnabled } from './triz_skill_layer_feature_flag.js'
import {
  buildTrizDestinationCatalog,
  computeAllStageBindings,
  mapActualStageToLogical,
  sortTrizRouteDecisions,
  aggregateTrizRouteWarnings,
  computeTrizRouteActionId,
  validateHandoffStaleState,
  buildTrizSkillProfileFromRegistrySkill,
  buildUnavailableTrizSkillProfile,
  buildTrizSkillLayerNavigationMetadataList,
  type TrizSkillDestinationKey,
  type LogicalStageKey,
  type TrizSkillProfile,
  type TrizStageBindingEntry,
  type TrizActivationSummary,
  type TrizPermissionSummary,
  type TrizSkillSourceRef,
  type TrizSkillSourceSummary,
  type TrizRouteDecision,
  type TrizRoutePreviewRequest,
  type TrizRoutePreviewResponse,
  type TrizHandoffPreviewRequest,
  type TrizHandoffPreviewResponse,
  type TrizSkillLayerSummary,
  type TrizSkillDestinationEntry,
  type TrizSkillLayerDestinationFilters,
  type TrizSkillLayerDestinationsResponse,
  type TrizSkillLayerNavigationMetadata,
} from '@aiproj/types'

/**
 * Source adapter interface: 每个 TRIZ destination 的只读低敏数据收集器。
 */
interface TrizSourceAdapter {
  readonly adapterKey: TrizSkillDestinationKey
  getSourceSummary(
    organizationId: number,
    projectId: number,
    userId: number,
    hasPermission: boolean,
  ): Promise<TrizSkillSourceSummary>
}

@inject()
export default class TrizSkillLayerService {
  private catalog = buildTrizDestinationCatalog()
  private adapters: Map<TrizSkillDestinationKey, TrizSourceAdapter> = new Map()

  // 本 Service 是只读闭环，审计由 Controller 侧统一落库，故不在此注入 AuditService
  constructor(private skillRegistry: SkillRegistryService) {
    this.registerAdapters()
  }

  // ── 3.7 Source Adapter Registration ──────────────────────────────

  private registerAdapters(): void {
    // 为每个 destination 注册默认 guarded adapter
    for (const key of this.catalog.map((e) => e.destinationKey)) {
      this.adapters.set(key, this.makeDefaultAdapter(key))
    }
  }

  private makeDefaultAdapter(key: TrizSkillDestinationKey): TrizSourceAdapter {
    return {
      adapterKey: key,
      getSourceSummary: async () => ({
        adapterKey: key,
        availability: 'unavailable',
        sourceRefs: [],
        label: '',
        hasStaleSources: false,
        warnings: ['TRIZ_SL_ADAPTER_UNAVAILABLE'],
      }),
    }
  }

  // ── 3.5 Manifest Resolver ────────────────────────────────────────

  async resolveManifests(
    organizationId: number,
    _projectId: number,
    _permissions: Set<string>,
  ): Promise<TrizSkillProfile[]> {
    const profiles: TrizSkillProfile[] = []

    try {
      const { data: skills } = await this.skillRegistry.listByOrg(organizationId, {
        status: 'active',
        perPage: 200,
      })
      const skillMap = new Map<string, (typeof skills)[number]>()
      for (const s of skills) {
        skillMap.set(s.skillKey, s)
      }

      // 尝试从 Registry skills 投影
      for (const entry of this.catalog) {
        const matchingSkill = skills.find((s) => {
          const tags = s.tags ?? []
          return tags.includes('triz') || s.skillKey.toLowerCase().includes('triz')
        })

        if (matchingSkill) {
          const profile = buildTrizSkillProfileFromRegistrySkill(
            matchingSkill as any,
            entry.destinationKey,
            this.catalog,
          )
          profiles.push(profile)
        } else {
          profiles.push(
            buildUnavailableTrizSkillProfile(
              entry.destinationKey,
              'TRIZ_SL_NO_REGISTRY_SKILL',
              this.catalog,
            ),
          )
        }
      }
    } catch {
      // Registry 不可用：全部返回 unavailable
      for (const entry of this.catalog) {
        profiles.push(
          buildUnavailableTrizSkillProfile(
            entry.destinationKey,
            'TRIZ_SL_ADAPTER_UNAVAILABLE',
            this.catalog,
          ),
        )
      }
    }

    return profiles
  }

  // ── 3.10 Stage Binding Resolver ──────────────────────────────────

  resolveStageBindings(
    profiles: TrizSkillProfile[],
    permissions: Set<string>,
    featureFlags: Set<string>,
  ): TrizStageBindingEntry[] {
    const availableKeys = new Set(
      profiles.filter((p) => p.availability === 'available').map((p) => p.destinationKey),
    )
    return computeAllStageBindings(this.catalog, availableKeys, permissions, featureFlags)
  }

  // ── 3.11 Destination Router ──────────────────────────────────────

  async routeDestinations(
    profiles: TrizSkillProfile[],
    input: TrizRoutePreviewRequest,
    permissions: Set<string>,
  ): Promise<TrizRoutePreviewResponse> {
    const routes: TrizRouteDecision[] = []
    const availableProfiles = profiles.filter((p) => p.availability === 'available')

    // 确定 logical stage
    let logicalStage: LogicalStageKey | null = null
    if (input.stageHint) {
      const mapping = mapActualStageToLogical(input.stageHint)
      logicalStage = mapping.logical
    }

    for (const profile of availableProfiles) {
      const catalogEntry = this.catalog.find((e) => e.destinationKey === profile.destinationKey)
      if (!catalogEntry) continue

      // 如果有 stage hint 且 profile 绑定了该 stage，提高分数
      let deterministicScore = 50 // 基础分
      if (logicalStage && catalogEntry.defaultStageBindings.includes(logicalStage)) {
        deterministicScore += 30
      }

      // 权限检查
      const hasAllPerms = catalogEntry.defaultRequiredPermissions.every((p) => permissions.has(p))
      if (!hasAllPerms) {
        deterministicScore -= 40
      }

      // 知识可用性加分
      if (profile.knowledgeAvailability) {
        deterministicScore += 10
      }

      const skillKey = profile.fromRegistry ? profile.skillKey : null
      const actionId = computeTrizRouteActionId(
        profile.destinationKey,
        input.stageHint ?? '',
        skillKey,
        input.idempotencyKey,
      )

      const sourceRefs: TrizSkillSourceRef[] = []
      const adapter = this.adapters.get(profile.destinationKey)
      if (adapter) {
        try {
          const summary = await adapter.getSourceSummary(0, 0, 0, hasAllPerms)
          sourceRefs.push(...summary.sourceRefs)
        } catch {
          // adapter 不可用，继续
        }
      }

      routes.push({
        destinationKey: profile.destinationKey,
        skillKey,
        confidence: Math.min(1, deterministicScore / 100),
        deterministicScore: Math.max(0, Math.min(100, deterministicScore)),
        order: 0,
        requiredPermissions: catalogEntry.defaultRequiredPermissions,
        sourceRefs,
        stale: sourceRefs.some((r) => r.stale),
        warnings: profile.warnings,
        actionId,
        idempotencyKey: input.idempotencyKey,
        actionType: deterministicScore >= 70 ? 'open_review' : 'request_clarification',
        requiresUserConfirmation: deterministicScore < 70,
      })
    }

    const sorted = sortTrizRouteDecisions(routes)
    // 重新编号 order
    sorted.forEach((r, i) => {
      r.order = i
    })

    return {
      routes: sorted,
      warnings: aggregateTrizRouteWarnings(sorted),
      idempotencyKey: input.idempotencyKey,
      generatedAt: new Date().toISOString(),
    }
  }

  // ── 3.12 Handoff Preview Builder ─────────────────────────────────

  async buildHandoffPreview(
    organizationId: number,
    projectId: number,
    actorId: number,
    input: TrizHandoffPreviewRequest,
    profiles: TrizSkillProfile[],
    permissions: Set<string>,
  ): Promise<TrizHandoffPreviewResponse> {
    const profile = profiles.find((p) => p.destinationKey === input.destinationKey)
    const catalogEntry = this.catalog.find((e) => e.destinationKey === input.destinationKey)

    const sourceHashes: Record<string, string> = {}
    const sourceRefs: TrizSkillSourceRef[] = []
    const requiredPermissions = catalogEntry?.defaultRequiredPermissions ?? []

    // 从 adapter 获取来源
    const adapter = this.adapters.get(input.destinationKey)
    if (adapter) {
      try {
        const hasAllPerms = requiredPermissions.every((p) => permissions.has(p))
        const summary = await adapter.getSourceSummary(
          organizationId,
          projectId,
          actorId,
          hasAllPerms,
        )
        for (const ref of summary.sourceRefs) {
          sourceRefs.push(ref)
          if (ref.sourceHash) {
            sourceHashes[ref.kind] = ref.sourceHash
          }
        }
      } catch {
        // adapter 不可用
      }
    }

    // stale 检测
    const staleCheck = validateHandoffStaleState(sourceHashes, input.currentSourceHashes)

    // 目标 destination 的 manifest 可用性：不可用时不允许跳转，并回传对应低敏警告码
    const warnings = [...staleCheck.warnings]
    const destinationAvailable = profile?.availability === 'available'
    if (!destinationAvailable) {
      warnings.push(profile ? 'TRIZ_SL_INACCESSIBLE_TARGET' : 'TRIZ_SL_MISSING_MODULE')
    }

    return {
      destinationKey: input.destinationKey,
      targetModule: catalogEntry?.name ?? input.destinationKey,
      sourceRefs,
      sourceHashes,
      hashValidationPassed: staleCheck.valid,
      stale: staleCheck.stale,
      requiredPermissions,
      actorId,
      organizationId,
      projectId,
      idempotencyKey: input.idempotencyKey,
      previewOnly: true,
      requiresUserConfirmation: true,
      warnings,
      canNavigate: !staleCheck.stale && destinationAvailable,
    }
  }

  // ── 3.13 Composition: Summary ────────────────────────────────────

  async getSummary(
    organizationId: number,
    projectId: number,
    _userId: number,
    permissions: Set<string>,
  ): Promise<TrizSkillLayerSummary> {
    const featureFlagEnabled = isTrizSkillLayerEnabled()

    const profiles = featureFlagEnabled
      ? await this.resolveManifests(organizationId, projectId, permissions)
      : []

    const stageBindings = featureFlagEnabled
      ? this.resolveStageBindings(profiles, permissions, new Set())
      : []

    const activationSummary: TrizActivationSummary = {
      activeSkillKeys: profiles
        .filter((p) => p.availability === 'available')
        .map((p) => p.skillKey),
      advisorySkillKeys: profiles
        .filter((p) => p.availability === 'advisory')
        .map((p) => p.skillKey),
      activationEvidenceRefs: [],
      hasActiveActivations: profiles.some((p) => p.availability === 'available'),
    }

    const permissionSummary: TrizPermissionSummary = {
      grantedPermissions: [...permissions],
      missingPermissions: [],
      canViewSummary: permissions.has('triz_skill_layer:view'),
      canViewDestinations: permissions.has('triz_skill_layer:view'),
      canRoutePreview: permissions.has('triz_skill_layer:preview'),
      canHandoffPreview: permissions.has('triz_skill_layer:preview'),
      denialWarnings: permissions.has('triz_skill_layer:view') ? [] : ['TRIZ_SL_PERMISSION_DENIED'],
    }

    return {
      profiles,
      unavailableDestinations: profiles
        .filter((p) => p.availability !== 'available' && p.availability !== 'advisory')
        .map((p) => p.destinationKey),
      activationSummary,
      stageBindings,
      sourceSummaries: [],
      permissionSummary,
      featureFlagEnabled,
      auditRefs: [],
    }
  }

  // ── 3.13 Composition: Destinations ───────────────────────────────

  async getDestinations(
    organizationId: number,
    projectId: number,
    _userId: number,
    permissions: Set<string>,
    filters?: TrizSkillLayerDestinationFilters,
    _sort?: string,
    page?: number,
    perPage?: number,
  ): Promise<TrizSkillLayerDestinationsResponse> {
    const profiles = await this.resolveManifests(organizationId, projectId, permissions)

    let entries: TrizSkillDestinationEntry[] = profiles.map((p) => ({
      destinationKey: p.destinationKey,
      profile: p,
      stageBindings: p.stageBindings,
      availability: p.availability,
      sourceSummary: null,
      warnings: p.warnings,
    }))

    // 过滤
    if (filters?.stage) {
      entries = entries.filter((e) => e.stageBindings.includes(filters.stage!))
    }
    if (filters?.availability) {
      entries = entries.filter((e) => e.availability === filters.availability)
    }
    if (filters?.destinationKey) {
      entries = entries.filter((e) => e.destinationKey === filters.destinationKey)
    }

    // 排序（默认按 destinationKey 字典序）
    entries.sort((a, b) => a.destinationKey.localeCompare(b.destinationKey))

    const total = entries.length
    const pg = page ?? 1
    const pp = perPage ?? 20
    const totalPages = Math.ceil(total / pp)
    const paginated = entries.slice((pg - 1) * pp, pg * pp)

    return {
      data: paginated,
      meta: { total, page: pg, perPage: pp, totalPages },
    }
  }

  // ── Navigation Metadata ──────────────────────────────────────────

  getNavigationMetadata(profiles: TrizSkillProfile[]): TrizSkillLayerNavigationMetadata[] {
    return buildTrizSkillLayerNavigationMetadataList(profiles, this.catalog)
  }
}
