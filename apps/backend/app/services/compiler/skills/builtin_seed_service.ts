/**
 * v3-initial-skill-software-development —— BuiltinSeedService（D2/D3/D4）。
 *
 * 官方内置 Skill 种子注入与升级服务。
 * - seedOrganization：遍历 listBuiltinSeeds() 逐个注入，直接 CompilerSkill.create(active, isBuiltin=true)
 * - upgradeOrganization：版本升级 knowledge + version
 * - assertNotBuiltin：守卫辅助
 * - 受 COMPILER_SKILL_BUILTIN_SEED_ENABLED feature flag 控制
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import CompilerSkill from '#models/compiler_skill'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  listBuiltinSeeds,
  resolveSeedContent,
  compareSeedVersion,
  type SkillLifecycleStatus,
} from '@aiproj/types'
import env from '#start/env'

export class BuiltinSkillPermissionError extends Error {
  constructor(skillKey: string) {
    super(`内置 Skill "${skillKey}" 不可被组织用户编辑/删除/转移`)
    this.name = 'BuiltinSkillPermissionError'
  }
}

@inject()
export default class BuiltinSeedService {
  constructor(private readonly audit: AuditService) {}

  /**
   * 检查 feature flag 是否启用。
   * 读实时 process.env（仓库 feature flag 惯例，见 webhooks/* 的 ENABLED 判定）——
   * `env.get` 只反映进程启动时快照，测试与运维热切换都不生效。
   */
  private isEnabled(): boolean {
    const raw = process.env.COMPILER_SKILL_BUILTIN_SEED_ENABLED
    if (raw !== undefined) return raw === 'true'
    return env.get('COMPILER_SKILL_BUILTIN_SEED_ENABLED', false)
  }

  /**
   * 对指定组织注入全部官方内置 Skill 种子。
   * 直接 CompilerSkill.create({ status: 'active', isBuiltin: true })，不经 transitionLifecycle。
   * 幂等：按 (organizationId, skillKey) 检查，已存在则 no-op。
   */
  async seedOrganization(organizationId: number): Promise<void> {
    if (!this.isEnabled()) return

    const seeds = listBuiltinSeeds()

    for (const seed of seeds) {
      const existing = await CompilerSkill.forOrganizationByKey(organizationId, seed.skillKey)
      if (existing) continue // 幂等

      const knowledge = resolveSeedContent(seed)

      await CompilerSkill.create({
        organizationId,
        skillKey: seed.skillKey,
        name: seed.name,
        version: seed.version,
        description: seed.description,
        status: 'active' as SkillLifecycleStatus,
        category: seed.category as any,
        tags: seed.tags,
        dependencies: seed.dependencies,
        activation: seed.activation as any,
        knowledge: knowledge as any,
        basePriority: seed.basePriority,
        isBuiltin: true,
        createdBy: 0, // system-seed
        updatedBy: 0,
      })

      // 低敏审计
      await this.audit.log({
        event: AuditEvent.AI_COMPILER_SKILL_BUILTIN_SEEDED,
        userId: 0,
        organizationId,
        metadata: {
          skillKey: seed.skillKey,
          version: seed.version,
          actor: 'system-seed',
        },
      })
    }
  }

  /**
   * 升级组织内置 Skill：目录版本高于组织现有版本时升级 knowledge + version。
   * 不删行、不影响 isBuiltin=false 副本。版本不高于时 no-op。
   */
  async upgradeOrganization(organizationId: number): Promise<void> {
    if (!this.isEnabled()) return

    const seeds = listBuiltinSeeds()

    for (const seed of seeds) {
      const existing = await CompilerSkill.forOrganizationByKey(organizationId, seed.skillKey)
      if (!existing || !existing.isBuiltin) continue

      const cmp = compareSeedVersion(seed.version, existing.version)
      if (cmp <= 0) continue // 不高于，no-op

      const knowledge = resolveSeedContent(seed)
      const fromVersion = existing.version

      existing.version = seed.version
      existing.knowledge = knowledge as any
      existing.name = seed.name
      existing.description = seed.description
      existing.category = seed.category as any
      existing.tags = seed.tags
      existing.dependencies = seed.dependencies
      existing.activation = seed.activation as any
      existing.basePriority = seed.basePriority
      existing.updatedBy = 0
      await existing.save()

      // 低敏审计
      await this.audit.log({
        event: AuditEvent.AI_COMPILER_SKILL_BUILTIN_UPGRADED,
        userId: 0,
        organizationId,
        metadata: {
          skillKey: seed.skillKey,
          fromVersion,
          toVersion: seed.version,
          actor: 'system-seed',
        },
      })
    }
  }

  /**
   * 守卫：断言 Skill 不是内置（isBuiltin=true）。
   * 若为内置，抛出 BuiltinSkillPermissionError。
   */
  assertNotBuiltin(skill: CompilerSkill): void {
    if (skill.isBuiltin) {
      throw new BuiltinSkillPermissionError(skill.skillKey)
    }
  }
}
