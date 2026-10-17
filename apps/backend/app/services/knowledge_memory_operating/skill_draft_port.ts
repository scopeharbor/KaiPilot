/**
 * v3-knowledge-memory-operating-layer —— Skill knowledge draft read port。
 *
 * 设计 D2 / 3.7 / 3.8：
 * - 只读：list / get / count / resolveSurface。
 * - 通过 `SkillKnowledgeDraft` Lucid Model + 既有 static scopes 复用组织隔离；
 *   读侧不写。
 * - plugin provenance 来自 CompilerSkill.provenance（plugin 来源）+
 *   PluginInstallation（enabled/disabled/uninstalled）；cross-actor 不可见。
 * - baseStale 判定：draft.baseVersion !== skill.version。
 * - 失败 closed。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import SkillKnowledgeDraft from '#models/skill_knowledge_draft'
import CompilerSkill from '#models/compiler_skill'
import PluginInstallation from '#models/plugin_installation'
import type {
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryOperatingStatus,
  KnowledgeMemoryScopedRef,
  OperatingOwningSurfaceDescriptor,
  SkillKnowledgeDraftOperatingProjection,
} from '@aiproj/types'
import {
  buildOwningSurfaceDescriptor,
  computeSurfaceEnabled,
  deriveSkillKnowledgeDraftAttention,
  makeScopedRef,
  priorityForStatus,
  OPERATING_MAX_MERGE_WINDOW,
} from '@aiproj/types'
import {
  type OperatingCountInput,
  type OperatingCountResult,
  type OperatingGetInput,
  type OperatingGetResult,
  type OperatingListInput,
  type OperatingListResult,
  type OperatingReadContext,
  type OperatingResolveSurfaceInput,
  type OperatingResolveSurfaceResult,
  OperatingReadPortError,
} from './port.js'
import {
  buildLaneCountResult,
  matchesOperatingFacets,
  takeOperatingWindow,
} from './projection_helpers.js'

interface ScopedRefParse {
  readonly draftId: number
}

function parseDraftScopedRef(ref: KnowledgeMemoryScopedRef): ScopedRefParse | null {
  const m = ref.ref.match(/^s-(\d+)$/)
  if (!m) return null
  return { draftId: Number(m[1]) }
}

function formatDraftScopedRef(draftId: number): KnowledgeMemoryScopedRef {
  return makeScopedRef('skill_knowledge_draft', `s-${draftId}`)
}

interface PluginState {
  pluginId: string
  skillIdentity: string
  disabled: boolean
  uninstalled: boolean
}

/**
 * 从 skillKey 解析插件 id。
 *
 * plugin 携带的 Skill 通过 `PluginInstallation` 装载；`pluginId` 在 skill 上以
 * `skillKey` 形式编码（约定 `com.<author>.<plugin>.<skill>`）。核心内建 Skill
 * 的 key 不满足该形态，返回 null（= core provenance）。
 */
function pluginIdFromSkillKey(skillKey: string): string | null {
  const parts = skillKey.split('.')
  if (parts.length < 3) return null
  return parts.slice(0, 3).join('.')
}

/**
 * 由**已批量取回**的安装记录派生 plugin provenance（不发查询）。
 *
 * 低敏投影：只暴露 pluginId + disabled/uninstalled，不暴露版本/状态细节。
 * 查不到安装记录 = 已卸载：fail closed 成 disabled，不默认放行。
 */
function resolvePluginState(
  skillKey: string,
  installationByPluginId: ReadonlyMap<string, PluginInstallation>,
): PluginState | null {
  const pluginId = pluginIdFromSkillKey(skillKey)
  if (!pluginId) return null
  const inst = installationByPluginId.get(pluginId)
  if (!inst) {
    return { pluginId, skillIdentity: skillKey, disabled: true, uninstalled: true }
  }
  return {
    pluginId,
    skillIdentity: skillKey,
    disabled: inst.status !== 'enabled',
    uninstalled: inst.status === 'uninstalled',
  }
}

/**
 * 单条 detail 路径的 plugin provenance 查询（一次读，非 N+1）。
 * 列表路径 MUST 走 `#scanVisible` 的批量 join，不得调用本函数。
 */
async function lookupPluginStateOne(
  organizationId: number,
  skillKey: string,
): Promise<PluginState | null> {
  const pluginId = pluginIdFromSkillKey(skillKey)
  if (!pluginId) return null
  const inst = await PluginInstallation.query()
    .where('organization_id', organizationId)
    .where('plugin_id', pluginId)
    .first()
  const map = new Map<string, PluginInstallation>()
  if (inst) map.set(inst.pluginId, inst)
  return resolvePluginState(skillKey, map)
}

function buildSkillDraftOperating(
  draft: SkillKnowledgeDraft,
  skill: CompilerSkill | null,
  pluginState: PluginState | null,
): SkillKnowledgeDraftOperatingProjection {
  const draftStatus = draft.status as 'pending' | 'committed' | 'discarded'
  const baseStale = skill ? skill.version !== draft.baseVersion : false
  const pluginDisabled = pluginState?.disabled ?? false
  const status: KnowledgeMemoryOperatingStatus = deriveSkillKnowledgeDraftAttention({
    draftStatus,
    baseStale,
    pluginDisabled,
  })
  const sections = Array.isArray(draft.sections) ? draft.sections : []
  return {
    kind: 'skill_knowledge_draft',
    scopedRef: formatDraftScopedRef(draft.id),
    scope: 'organization' as KnowledgeMemoryOperatingScope,
    visibility: 'visible',
    status,
    priority: priorityForStatus(status),
    freshnessState: baseStale ? 'stale' : 'fresh',
    skillId: draft.skillId,
    skillName: skill?.name ?? `Skill ${draft.skillId}`,
    draftStatus,
    baseVersion: draft.baseVersion,
    currentVersion: skill?.version ?? draft.baseVersion,
    baseStale,
    sectionCount: sections.length,
    pluginProvenance: pluginState
      ? {
          kind: 'plugin',
          pluginId: pluginState.pluginId,
          skillIdentity: pluginState.skillIdentity,
          disabled: pluginState.disabled,
          uninstalled: pluginState.uninstalled,
        }
      : { kind: 'core' },
    attentionBasis: {
      reasonCode: baseStale
        ? 'base_version_stale'
        : pluginDisabled
          ? 'plugin_disabled'
          : draftStatus === 'pending'
            ? 'pending_review'
            : 'no_action_needed',
      basisRefs: [formatDraftScopedRef(draft.id).ref],
      note: `draft=${draftStatus};base_stale=${baseStale};plugin_disabled=${pluginDisabled}`,
    },
    safeLabels: ['methodology_candidate', `draft_status:${draftStatus}`],
    updatedAt: (draft.updatedAt ?? draft.createdAt ?? new Date(0)).toISO() as string,
  }
}

@inject()
export default class SkillKnowledgeDraftOperatingReadPort {
  readonly kind = 'skill_knowledge_draft' as const

  async countByFacets(input: OperatingCountInput): Promise<OperatingCountResult> {
    try {
      const scan = await this.#scanVisible(input.ctx)
      const visible = scan.items.filter((it) =>
        matchesOperatingFacets(it, { statuses: input.statuses }),
      )
      return buildLaneCountResult(visible, scan.truncated)
    } catch (err) {
      throw asPortError(err)
    }
  }

  async listWindow(input: OperatingListInput): Promise<OperatingListResult> {
    const start = Date.now()
    try {
      const scan = await this.#scanVisible(input.ctx)
      const filtered = scan.items.filter((it) =>
        matchesOperatingFacets(it, { statuses: input.statuses, scopes: input.scopes }),
      )
      return {
        // 合并窗口：本 lane 稳定序的前 limit 项；跨 lane 切片由聚合器完成（D3）。
        items: takeOperatingWindow(filtered, input.limit),
        laneTotal: filtered.length,
        degraded: scan.truncated,
        queryMs: Date.now() - start,
        queryCount: scan.queryCount,
      }
    } catch (err) {
      throw asPortError(err)
    }
  }

  /**
   * 单次有界扫描（≤ `OPERATING_MAX_MERGE_WINDOW` 行）+ 两次批量关联读取。
   *
   * 关联对象按 id / plugin_id **批量**取回后在内存 join——早期实现对每条
   * draft 各发一次 skill 查询与一次 plugin 查询（`2N+1`），在 500 草稿的
   * 规模 fixture 上就是 1001 次查询，属于 spec 明令禁止的逐行 N+1。
   * 现在无论多少条草稿都固定 3 次查询。
   */
  async #scanVisible(ctx: OperatingReadContext): Promise<{
    items: SkillKnowledgeDraftOperatingProjection[]
    truncated: boolean
    queryCount: number
  }> {
    const drafts = await SkillKnowledgeDraft.query()
      .where('organization_id', ctx.organizationId)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(OPERATING_MAX_MERGE_WINDOW)
    if (drafts.length === 0) {
      return { items: [], truncated: false, queryCount: 1 }
    }

    // 批量取 skill（一次 whereIn）
    const skillIds = [...new Set(drafts.map((d) => d.skillId))]
    const skills = await CompilerSkill.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('id', skillIds)
    const skillById = new Map(skills.map((s) => [s.id, s]))

    // 批量取 plugin installation（一次 whereIn），再在内存里 join
    const pluginIds = [
      ...new Set(
        skills
          .map((s) => pluginIdFromSkillKey(s.skillKey))
          .filter((id): id is string => id !== null),
      ),
    ]
    const installationByPluginId = new Map<string, PluginInstallation>()
    let queryCount = 2
    if (pluginIds.length > 0) {
      const installations = await PluginInstallation.query()
        .where('organization_id', ctx.organizationId)
        .whereIn('plugin_id', pluginIds)
      for (const inst of installations) installationByPluginId.set(inst.pluginId, inst)
      queryCount = 3
    }

    const items = drafts.map((d) => {
      const skill = skillById.get(d.skillId) ?? null
      return buildSkillDraftOperating(
        d,
        skill,
        skill ? resolvePluginState(skill.skillKey, installationByPluginId) : null,
      )
    })
    return {
      items: items.filter((it) => it.visibility === 'visible'),
      truncated: drafts.length >= OPERATING_MAX_MERGE_WINDOW,
      queryCount,
    }
  }

  async getProjection(input: OperatingGetInput): Promise<OperatingGetResult | null> {
    const ctx = input.ctx
    const parsed = parseDraftScopedRef(input.scopedRef)
    if (!parsed) return null
    try {
      const draft = await SkillKnowledgeDraft.query()
        .where('organization_id', ctx.organizationId)
        .where('id', parsed.draftId)
        .first()
      if (!draft) return null
      const skill = await CompilerSkill.query()
        .where('organization_id', ctx.organizationId)
        .where('id', draft.skillId)
        .first()
      const pluginState = skill
        ? await lookupPluginStateOne(ctx.organizationId, skill.skillKey)
        : null
      const opItem = buildSkillDraftOperating(draft, skill, pluginState)
      const surfaces = this.#buildSurfaces(opItem)
      return {
        item: opItem,
        surfaces,
        relatedCount: 0,
        fetchedAt: new Date().toISOString(),
      }
    } catch (err) {
      throw asPortError(err)
    }
  }

  async resolveSurface(
    input: OperatingResolveSurfaceInput,
  ): Promise<OperatingResolveSurfaceResult | null> {
    const ctx = input.ctx
    const parsed = parseDraftScopedRef(input.scopedRef)
    if (!parsed) return null
    try {
      const draft = await SkillKnowledgeDraft.query()
        .where('organization_id', ctx.organizationId)
        .where('id', parsed.draftId)
        .first()
      if (!draft) return null
      const skill = await CompilerSkill.query()
        .where('organization_id', ctx.organizationId)
        .where('id', draft.skillId)
        .first()
      const pluginState = skill
        ? await lookupPluginStateOne(ctx.organizationId, skill.skillKey)
        : null
      const opItem = buildSkillDraftOperating(draft, skill, pluginState)
      const enabled = computeSurfaceEnabled({
        surface: input.surface,
        pluginDisabled:
          opItem.pluginProvenance.kind === 'plugin' ? opItem.pluginProvenance.disabled : false,
        pluginUninstalled:
          opItem.pluginProvenance.kind === 'plugin' ? opItem.pluginProvenance.uninstalled : false,
        baseStale: opItem.baseStale,
        isMemoryScope: false,
      })
      if (!enabled.enabled) return null
      return {
        descriptor: buildOwningSurfaceDescriptor({
          surface: input.surface,
          scopedRef: opItem.scopedRef,
          enabled: true,
          routeKey: '/compiler/skills/knowledge',
          safeReturnContext: 'Skill 知识草稿',
        }),
      }
    } catch (err) {
      throw asPortError(err)
    }
  }

  #buildSurfaces(
    opItem: SkillKnowledgeDraftOperatingProjection,
  ): readonly OperatingOwningSurfaceDescriptor[] {
    const enabled = computeSurfaceEnabled({
      surface: 'skill_knowledge_authoring',
      pluginDisabled:
        opItem.pluginProvenance.kind === 'plugin' ? opItem.pluginProvenance.disabled : false,
      pluginUninstalled:
        opItem.pluginProvenance.kind === 'plugin' ? opItem.pluginProvenance.uninstalled : false,
      baseStale: opItem.baseStale,
      isMemoryScope: false,
    })
    if (!enabled.enabled) return []
    return [
      buildOwningSurfaceDescriptor({
        surface: 'skill_knowledge_authoring',
        scopedRef: opItem.scopedRef,
        enabled: true,
        routeKey: '/compiler/skills/knowledge',
        safeReturnContext: 'Skill 知识草稿',
      }),
    ]
  }
}

function asPortError(err: unknown): OperatingReadPortError {
  if (err instanceof OperatingReadPortError) return err
  const code =
    err instanceof Error && err.message.includes('timeout')
      ? 'OPERATING_PORT_TIMEOUT'
      : 'OPERATING_PORT_INTERNAL_ERROR'
  const message = err instanceof Error ? err.message.slice(0, 200) : 'unknown'
  return new OperatingReadPortError(code, 'skill_knowledge_draft', message)
}
