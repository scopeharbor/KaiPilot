import { describe, it, expect } from 'vitest'
import {
  PLUGIN_SEAM_TEMPLATE_PACK,
  PLUGIN_TEMPLATE_ID_PREFIX,
  TEMPLATE_PACK_DOMAINS,
  MAX_TEMPLATES_PER_PACK,
  MAX_PAYLOAD_SERIALIZED_BYTES,
  isTemplatePackDomain,
  isValidPluginTemplateId,
  normalizeTemplatePackPayload,
  templatePackStableSerialize,
  computeTemplatePackDigest,
  validateTemplatePackPayload,
  PILOT_TEMPLATE_PACK_PAYLOAD,
} from './plugin-template-pack.js'
import {
  VALID_TEMPLATE_PACK_FIXTURE,
  NEGATIVE_TEMPLATE_PACK_FIXTURES,
} from './plugin-template-pack-fixtures.js'

describe('plugin-template-pack 共享契约与校验测试', () => {
  describe('1. 常量与类型守卫', () => {
    it('接缝 key 与前缀常量稳定', () => {
      expect(PLUGIN_SEAM_TEMPLATE_PACK).toBe('template-pack.content-bundle')
      expect(PLUGIN_TEMPLATE_ID_PREFIX).toBe('ptpl_')
      expect(TEMPLATE_PACK_DOMAINS).toContain('bi-report-template')
      expect(MAX_TEMPLATES_PER_PACK).toBe(20)
      expect(MAX_PAYLOAD_SERIALIZED_BYTES).toBe(65536)
    })

    it('isTemplatePackDomain 正确识别', () => {
      expect(isTemplatePackDomain('bi-report-template')).toBe(true)
      expect(isTemplatePackDomain('unknown-domain')).toBe(false)
      expect(isTemplatePackDomain('')).toBe(false)
      expect(isTemplatePackDomain(null)).toBe(false)
    })

    it('isValidPluginTemplateId 强制 ptpl_ 前缀与合法格式', () => {
      expect(isValidPluginTemplateId('ptpl_pilot_weekly')).toBe(true)
      expect(isValidPluginTemplateId('ptpl_risk_123_custom')).toBe(true)
      expect(isValidPluginTemplateId('bad_prefix_test')).toBe(false)
      expect(isValidPluginTemplateId('ptpl_INVALID_CAPS')).toBe(false)
      expect(isValidPluginTemplateId('ptpl_with-dash')).toBe(false)
      expect(isValidPluginTemplateId('ptpl_')).toBe(false)
    })
  })

  describe('2. 归一化、稳定序列化与 digest 确定性', () => {
    it('对正例负载归一化并计算 digest 两次结果完全一致', () => {
      const digest1 = computeTemplatePackDigest(VALID_TEMPLATE_PACK_FIXTURE)
      const digest2 = computeTemplatePackDigest(VALID_TEMPLATE_PACK_FIXTURE)
      expect(digest1).toBe(digest2)
      expect(typeof digest1).toBe('string')
      expect(digest1.length).toBe(8)
    })

    it('对象键乱序序列化输出一致', () => {
      const payloadA = {
        domain: 'bi-report-template' as const,
        version: '1.0.0',
        description: 'Test',
        templates: VALID_TEMPLATE_PACK_FIXTURE.templates,
      }
      const payloadB = {
        description: 'Test',
        templates: VALID_TEMPLATE_PACK_FIXTURE.templates,
        version: '1.0.0',
        domain: 'bi-report-template' as const,
      }
      expect(templatePackStableSerialize(payloadA)).toBe(templatePackStableSerialize(payloadB))
    })

    it('归一化会对 template 列表及 composition 内部字段做稳定排序', () => {
      const reversedFixture = {
        ...VALID_TEMPLATE_PACK_FIXTURE,
        templates: [...VALID_TEMPLATE_PACK_FIXTURE.templates].reverse(),
      }
      const norm1 = normalizeTemplatePackPayload(VALID_TEMPLATE_PACK_FIXTURE)
      const norm2 = normalizeTemplatePackPayload(reversedFixture)
      expect(norm1.templates[0].templateId).toBe(norm2.templates[0].templateId)
      expect(norm1.templates[1].templateId).toBe(norm2.templates[1].templateId)
      expect(computeTemplatePackDigest(VALID_TEMPLATE_PACK_FIXTURE)).toBe(
        computeTemplatePackDigest(reversedFixture),
      )
    })
  })

  describe('3. validateTemplatePackPayload 契约层校验', () => {
    it('正例 pilot 模板包校验通过', () => {
      const res = validateTemplatePackPayload(PILOT_TEMPLATE_PACK_PAYLOAD)
      expect(res.valid).toBe(true)
      expect(res.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0)
      expect(res.normalizedPayload).toBeDefined()
      expect(res.normalizedPayload?.templates).toHaveLength(2)
    })

    it('未知 domain 产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.unknownDomain)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-unknown-domain')).toBe(true)
    })

    it('非完整 SemVer 产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.invalidSemver)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-invalid-semver')).toBe(true)
    })

    it('未声明 payload 字段产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.unallowedPayloadField)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-unallowed-field')).toBe(true)
    })

    it('未声明 entry 字段产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.unallowedEntryField)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-unallowed-field')).toBe(true)
    })

    it('缺少 ptpl_ 前缀产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.invalidIdPrefix)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-invalid-id-prefix')).toBe(
        true,
      )
    })

    it('同包内重复 templateId 产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.duplicateTemplateId)
      expect(res.valid).toBe(false)
      expect(
        res.findings.some((f) => f.code === 'plugin-template-pack-duplicate-template-id'),
      ).toBe(true)
    })

    it('空 templates 数组产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.emptyTemplates)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-schema-invalid')).toBe(true)
    })

    it('超出单包 20 个模板上限产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.countLimitExceeded)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-count-limit-exceeded')).toBe(
        true,
      )
    })

    it('非法枚举值产生 blocking finding', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.invalidCategoryEnum)
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-invalid-enum')).toBe(true)
    })
  })

  describe('4. 低敏内容检查（SQL、脚本、外部 URL、secret）', () => {
    it('模板名称含 SQL 注入拦截', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.sqlInjectionInName)
      expect(res.valid).toBe(false)
      expect(
        res.findings.some((f) => f.code === 'plugin-template-pack-sensitive-content-detected'),
      ).toBe(true)
    })

    it('模板描述含外部 URL 拦截', () => {
      const res = validateTemplatePackPayload(
        NEGATIVE_TEMPLATE_PACK_FIXTURES.externalUrlInDescription,
      )
      expect(res.valid).toBe(false)
      expect(
        res.findings.some((f) => f.code === 'plugin-template-pack-sensitive-content-detected'),
      ).toBe(true)
    })

    it('图表标题含 script 标签拦截', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.scriptInChartTitle)
      expect(res.valid).toBe(false)
      expect(
        res.findings.some((f) => f.code === 'plugin-template-pack-sensitive-content-detected'),
      ).toBe(true)
    })

    it('描述含 API 密钥 token 拦截', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.secretInDescription)
      expect(res.valid).toBe(false)
      expect(
        res.findings.some((f) => f.code === 'plugin-template-pack-sensitive-content-detected'),
      ).toBe(true)
    })
  })

  describe('5. 宿主事实校验 context 注入', () => {
    it('悬空数据源键拦截', () => {
      const res = validateTemplatePackPayload(
        NEGATIVE_TEMPLATE_PACK_FIXTURES.danglingDataSourceKey,
        {
          knownDataSourceKeys: ['organization_dashboard', 'pmo_portfolio_dashboard'],
        },
      )
      expect(res.valid).toBe(false)
      expect(
        res.findings.some((f) => f.code === 'plugin-template-pack-dangling-datasource-key'),
      ).toBe(true)
    })

    it('内置模板 ID 冲突拦截', () => {
      const res = validateTemplatePackPayload(NEGATIVE_TEMPLATE_PACK_FIXTURES.idConflictBuiltin, {
        knownBuiltinTemplateIds: ['project_execution_overview'],
      })
      expect(res.valid).toBe(false)
      expect(res.findings.some((f) => f.code === 'plugin-template-pack-id-conflict-builtin')).toBe(
        true,
      )
    })
  })
})
