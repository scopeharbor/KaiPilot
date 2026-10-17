/**
 * v3-initial-skill-software-development —— 内置 Compiler Skill 种子 Seeder（D4）。
 *
 * 对 dev/test 组织调用 BuiltinSeedService.seedOrganization，幂等 + feature flag 检查。
 * 不污染生产库（static environment = ['development','test']）。
 */
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Organization from '#models/organization'
import BuiltinSeedService from '#services/compiler/skills/builtin_seed_service'

export default class BuiltinCompilerSkillsSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const builtinSeed = await this.getBuiltinSeedService()

    // 对 dev/test 所有组织注入内置 Skill
    const orgs = await Organization.all()

    for (const org of orgs) {
      await builtinSeed.seedOrganization(org.id)
    }
  }

  /**
   * 解析 BuiltinSeedService（BaseSeeder 无 DI，手动获取）。
   */
  private async getBuiltinSeedService(): Promise<BuiltinSeedService> {
    const { default: AuditService } = await import('#services/audit_service')
    const audit = new AuditService()
    return new BuiltinSeedService(audit)
  }
}
