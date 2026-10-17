/**
 * OCR 结构化提取 — 内置 Profile 种子 Seeder（v3-ocr-structured-extraction §3.5）。
 *
 * 对 dev/test 组织注入 5 个内置提取 profile：
 * 会议纪要、行动事项表、里程碑清单、风险登记册、需求清单。
 * 幂等：已存在的 schema_key 跳过。
 */
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Organization from '#models/organization'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import OcrStructuredExtractionProfileVersion from '#models/ocr_structured_extraction_profile_version'
import {
  buildMeetingMinutesProfileSchema,
  buildActionItemsProfileSchema,
  buildMilestoneListProfileSchema,
  buildRiskRegisterProfileSchema,
  buildRequirementSheetProfileSchema,
} from '@aiproj/types'
import type { OcrExtractionProfileSchema } from '@aiproj/types'

const BUILTIN_PROFILES: {
  name: string
  description: string
  schema: OcrExtractionProfileSchema
}[] = [
  {
    name: '会议纪要',
    description: '提取会议纪要中的结构化字段：主题、日期、参会人、决议',
    schema: buildMeetingMinutesProfileSchema(),
  },
  {
    name: '行动事项表',
    description: '提取行动事项表格：事项、负责人、截止日期、状态',
    schema: buildActionItemsProfileSchema(),
  },
  {
    name: '里程碑清单',
    description: '提取里程碑清单：名称、日期、状态',
    schema: buildMilestoneListProfileSchema(),
  },
  {
    name: '风险登记册',
    description: '提取风险登记册表格：风险描述、概率、影响、等级、缓解措施',
    schema: buildRiskRegisterProfileSchema(),
  },
  {
    name: '需求清单',
    description: '提取需求清单表格：编号、标题、优先级、状态',
    schema: buildRequirementSheetProfileSchema(),
  },
]

export default class OcrStructuredExtractionProfilesSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const orgs = await Organization.all()

    for (const org of orgs) {
      for (const profileDef of BUILTIN_PROFILES) {
        // 幂等：已存在则跳过
        const existing = await OcrStructuredExtractionProfile.query()
          .where('organization_id', org.id)
          .where('schema_key', profileDef.schema.schemaKey)
          .where('scope', 'builtin')
          .first()

        if (existing) continue

        // 创建 profile
        const profile = await OcrStructuredExtractionProfile.create({
          organizationId: org.id,
          projectId: null,
          name: profileDef.name,
          scope: 'builtin',
          status: 'active',
          schemaKey: profileDef.schema.schemaKey,
          currentVersion: 1,
          totalRuns: 0,
          description: profileDef.description,
          createdBy: null,
        })

        // 创建初始版本
        await OcrStructuredExtractionProfileVersion.create({
          profileId: profile.id,
          version: 1,
          status: 'active',
          schemaDefinitionJson: profileDef.schema,
          createdBy: null,
        })
      }
    }
  }
}
