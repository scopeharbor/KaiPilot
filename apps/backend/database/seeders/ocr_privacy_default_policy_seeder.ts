/**
 * OCR 隐私策略默认行为 Seeder（v3-ocr-privacy-policy-controls §3.5）
 *
 * 安全默认策略：不脱敏、不失效、不清理现有的 OCR 文本。
 * 仅对 dev/test 组织注入系统默认隐私策略记录，保证 privacy decision
 * 无需任何覆盖即可运行。
 *
 * 幂等：已存在同组织/project 的活跃策略跳过。
 */
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Organization from '#models/organization'
import OcrPrivacyPolicyOverride from '#models/ocr_privacy_policy_override'
import { resolveSystemDefaultCategoryRules, computePrivacyPolicyHash } from '@aiproj/types'

export default class OcrPrivacyDefaultPolicySeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const orgs = await Organization.all()

    for (const org of orgs) {
      const existing = await OcrPrivacyPolicyOverride.query()
        .where('organization_id', org.id)
        .whereNull('project_id')
        .where('status', 'active')
        .first()

      if (existing) continue

      const categoryRules = resolveSystemDefaultCategoryRules()
      const policyHash = computePrivacyPolicyHash({
        organizationId: org.id,
        projectId: null,
        categoryRules,
      })

      await OcrPrivacyPolicyOverride.create({
        organizationId: org.id,
        projectId: null,
        policyJson: {
          categoryRules: categoryRules.map((r) => ({
            category: r.category,
            allowedPurposes: r.allowedPurposes,
            defaultOutputMode: r.defaultOutputMode,
          })),
          allowedPurposes: [
            'review',
            'copy_single',
            'export_metadata',
            'search_index',
            'structured_extraction',
            'entity_linking',
          ],
          globalOutputMode: 'full',
        },
        version: 1,
        policyHash,
        source: 'system',
        status: 'active',
        updatedBy: null,
      })
    }
  }
}
