// v3-triz-contradiction-copilot 任务 1.1 + 1.2 单元测试。
//
// 覆盖：
// - 知识包全量计数（40 原则 / 39 参数 / 14 对 PM 矛盾映射）与逐条来源标注（1.1 验收）；
// - 三条确定性检索路径（按原则编号 / 按关键词 / 按参数对）各 ≥2 例；
// - 未知参数与未知关键词的中性空结果（不抛错）；
// - 同一输入两次调用结果完全一致（确定性）；
// - 静态红线断言：模块内无写库、无权限判定、无作用域参数、只依赖知识包自身。
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  TRIZ_PARAMETERS,
  TRIZ_PM_CLASSIC_SCENARIOS,
  TRIZ_PM_CONTRAIDCTION_PAIRS,
  TRIZ_PRINCIPLES,
  TRIZ_KNOWLEDGE_PACK_VERSION,
} from '#services/triz_copilot/knowledge/index'
import {
  getKnowledgePackMetadata,
  searchByKeyword,
  searchByParameterPair,
  searchParameterByNumber,
  searchPrincipleByNumber,
} from '#services/triz_copilot/triz_knowledge_search_service'

const SERVICE_RELATIVE_PATH = '../../app/services/triz_copilot/triz_knowledge_search_service.ts'

const KNOWLEDGE_INDEX_RELATIVE_PATH = '../../app/services/triz_copilot/knowledge/index.ts'

/** 承载知识内容的数据模块（模块入口只写边界说明，不承载内容）。 */
const KNOWLEDGE_DATA_RELATIVE_PATHS = [
  '../../app/services/triz_copilot/knowledge/principles.ts',
  '../../app/services/triz_copilot/knowledge/parameters.ts',
  '../../app/services/triz_copilot/knowledge/pm_contradiction_pairs.ts',
]

const KNOWLEDGE_RELATIVE_PATHS = [KNOWLEDGE_INDEX_RELATIVE_PATH, ...KNOWLEDGE_DATA_RELATIVE_PATHS]

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const MODULE_PATHS = [SERVICE_RELATIVE_PATH, ...KNOWLEDGE_RELATIVE_PATHS]

/** 写库类依赖与调用（正则只看代码形态，不覆盖中文文案）。 */
const WRITE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/@adonisjs\/lucid/i, 'Lucid ORM'],
  [/#models\//i, 'models 子路径导入'],
  [/\brawQuery\s*\(/i, 'rawQuery'],
  [/\.insert\s*\(/i, 'insert'],
  [/\.update\s*\(/i, 'update'],
  [/\.delete\s*\(/i, 'delete'],
  [/\.save\s*\(/i, 'save'],
  [/\.create\s*\(/i, 'create'],
  [/\btrx\b/i, '事务对象'],
  [/\btransaction\b/i, '事务'],
]

/** 权限判定类依赖与调用。 */
const PERMISSION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bpermissions?\b/i, '权限集合'],
  [/\brbac\b/i, 'RBAC'],
  [/\bpolic(y|ies)\b/i, 'Policy'],
  [/\bauthorize/i, 'authorize'],
  [/ai:trigger/i, 'ai:trigger'],
  [/ai:confirm/i, 'ai:confirm'],
]

/**
 * 作用域参数：按**标识符形态**匹配（含引号加冒号的属性写法），而不是裸词匹配——
 * 知识包里的调研原文含 “Fixed Timebox Scope Reduction” 这类散文用法，裸词会误报。
 */
const SCOPE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(organizationId|organization_id|orgId|org_id|tenantId|tenant_id|projectId|project_id|userId|user_id|scopeId|scope_id)\b/,
    '作用域标识符',
  ],
  [/['"]?scope['"]?\s*[?:]/, 'scope 参数 / 属性'],
  [/\b(organization|tenant)\b/i, '组织 / 租户字段'],
]

test.group('TRIZ 知识包 · 全量计数与逐条溯源', () => {
  test('40 条发明原则齐全，编号 1–40 无缺口', ({ assert }) => {
    assert.lengthOf(TRIZ_PRINCIPLES, 40)
    assert.deepEqual(
      TRIZ_PRINCIPLES.map((entry) => entry.number),
      Array.from({ length: 40 }, (_, index) => index + 1),
    )
    assert.equal(new Set(TRIZ_PRINCIPLES.map((entry) => entry.number)).size, 40)
  })

  test('每条原则均含中英俄三语名、现代语汇名、定义、实例与 PM 释义', ({ assert }) => {
    for (const entry of TRIZ_PRINCIPLES) {
      assert.isTrue(entry.nameZh.length > 0, `原则 ${entry.number} 缺中文名`)
      assert.isTrue(entry.nameEn.length > 0, `原则 ${entry.number} 缺英文名`)
      assert.isTrue(entry.nameRu.length > 0, `原则 ${entry.number} 缺俄文名`)
      assert.isTrue(entry.displayName.length > 0, `原则 ${entry.number} 缺现代语汇名`)
      assert.isTrue(entry.definition.length > 0, `原则 ${entry.number} 缺一句话定义`)
      assert.isTrue(entry.softwareExamples.length > 0, `原则 ${entry.number} 缺软件管理实例`)
      assert.isTrue(entry.pmInterpretation.length > 0, `原则 ${entry.number} 缺 PM 求解释义`)
      assert.include(entry.source, 'triz-fundamentals.md §二', `原则 ${entry.number} 来源标注缺失`)
      assert.include(entry.source, `原则 ${entry.number}`)
    }
  })

  test('39 个工程参数齐全，编号 1–39 无缺口且每带 PM 映射含义', ({ assert }) => {
    assert.lengthOf(TRIZ_PARAMETERS, 39)
    assert.deepEqual(
      TRIZ_PARAMETERS.map((entry) => entry.number),
      Array.from({ length: 39 }, (_, index) => index + 1),
    )
    for (const entry of TRIZ_PARAMETERS) {
      assert.isTrue(entry.nameZh.length > 0, `参数 ${entry.number} 缺中文名`)
      assert.isTrue(entry.nameEn.length > 0, `参数 ${entry.number} 缺英文名`)
      assert.isTrue(entry.category.length > 0, `参数 ${entry.number} 缺大类`)
      assert.isTrue(entry.displayName.length > 0, `参数 ${entry.number} 缺现代语汇名`)
      assert.isTrue(entry.pmMeaning.length > 0, `参数 ${entry.number} 缺 PM 映射含义`)
      assert.include(entry.source, 'triz-fundamentals.md §3.1', `参数 ${entry.number} 来源标注缺失`)
      assert.include(entry.source, `参数 ${entry.number}`)
    }
  })

  test('参数 PM 映射含义区分调研原文与自行推导', ({ assert }) => {
    const sourced = TRIZ_PARAMETERS.filter((entry) => entry.pmMeaningSource !== null)
    const derived = TRIZ_PARAMETERS.filter((entry) => entry.pmMeaningSource === null)
    // 素材给出映射的参数共 16 个（§3.3 8 个 ∪ §三 15 个，重叠 7 个），其余 23 个为推导值。
    assert.lengthOf(sourced, 16)
    assert.lengthOf(derived, 23)
    for (const entry of sourced) {
      assert.isTrue(
        /triz-fundamentals\.md §3\.3|triz-application-ai-pm\.md §三/.test(
          entry.pmMeaningSource ?? '',
        ),
        `参数 ${entry.number} 的 PM 映射来源标注不可识别`,
      )
    }
  })

  test('14 对 PM 矛盾映射齐全，字段与来源标注完整', ({ assert }) => {
    assert.lengthOf(TRIZ_PM_CONTRAIDCTION_PAIRS, 14)
    assert.deepEqual(
      TRIZ_PM_CONTRAIDCTION_PAIRS.map((entry) => entry.id),
      Array.from({ length: 14 }, (_, index) => `PM-${String(index + 1).padStart(2, '0')}`),
    )
    for (const pair of TRIZ_PM_CONTRAIDCTION_PAIRS) {
      assert.isTrue(pair.title.length > 0, `${pair.id} 缺标题`)
      assert.isTrue(pair.scenario.length > 0, `${pair.id} 缺场景描述`)
      assert.lengthOf(pair.improvingParameterNumbers, 1, `${pair.id} 改善参数异常`)
      assert.lengthOf(pair.worseningParameterNumbers, 1, `${pair.id} 恶化参数异常`)
      assert.isTrue(pair.principleNumbers.length >= 1, `${pair.id} 缺推荐原则`)
      assert.isTrue(pair.solutions.length >= 1, `${pair.id} 缺场景解法`)
      assert.include(pair.source, 'triz-application-ai-pm.md §三', `${pair.id} 来源标注缺失`)
      assert.include(pair.source, `矛盾对`)
    }
  })

  test('§3.3 经典推演参数对与推荐原则可追溯', ({ assert }) => {
    assert.lengthOf(TRIZ_PM_CLASSIC_SCENARIOS, 3)
    for (const scenario of TRIZ_PM_CLASSIC_SCENARIOS) {
      assert.isTrue(scenario.conflict.length > 0, `${scenario.id} 缺管理冲突描述`)
      assert.isTrue(scenario.improvingParameterNumbers.length >= 1)
      assert.isTrue(scenario.worseningParameterNumbers.length >= 1)
      assert.isTrue(scenario.principleNumbers.length >= 1)
      assert.isTrue(scenario.solutions.length >= 1)
      assert.include(scenario.source, 'triz-fundamentals.md §3.3', `${scenario.id} 来源标注缺失`)
    }
  })

  test('所有被引用的参数编号与原则编号都在知识包内（无悬空引用）', ({ assert }) => {
    const parameterNumbers = new Set(TRIZ_PARAMETERS.map((entry) => entry.number))
    const principleNumbers = new Set(TRIZ_PRINCIPLES.map((entry) => entry.number))

    for (const pair of TRIZ_PM_CONTRAIDCTION_PAIRS) {
      for (const number of [...pair.improvingParameterNumbers, ...pair.worseningParameterNumbers]) {
        assert.isTrue(parameterNumbers.has(number), `${pair.id} 引用了不存在的参数 #${number}`)
      }
      for (const number of pair.principleNumbers) {
        assert.isTrue(principleNumbers.has(number), `${pair.id} 引用了不存在的原则 #${number}`)
      }
    }

    for (const scenario of TRIZ_PM_CLASSIC_SCENARIOS) {
      for (const number of [
        ...scenario.improvingParameterNumbers,
        ...scenario.worseningParameterNumbers,
      ]) {
        assert.isTrue(parameterNumbers.has(number), `${scenario.id} 引用了不存在的参数 #${number}`)
      }
      for (const number of scenario.principleNumbers) {
        assert.isTrue(principleNumbers.has(number), `${scenario.id} 引用了不存在的原则 #${number}`)
      }
    }
  })

  test('呈现语汇不含古典机械物理术语（用户可见文案取现代语汇名）', ({ assert }) => {
    const classicalTerms = ['重量', '热膨胀', '氧化剂', '液压', '薄膜', '多孔', '相变', '球面']
    for (const entry of [...TRIZ_PRINCIPLES, ...TRIZ_PARAMETERS]) {
      assert.notEqual(entry.displayName, entry.nameZh, `${entry.number} 现代语汇名与古典名相同`)
      for (const term of classicalTerms) {
        assert.notInclude(entry.displayName, term, `${entry.number} 呈现名残留古典术语「${term}」`)
      }
    }
  })

  test('知识包不含外部矩阵数据集引用（只采用语汇取向）', ({ assert }) => {
    // 数据模块不得出现外部矩阵数据集自述或站点引用（如 Matrix 2003/2010、triz40.com）。
    // 模块入口 index.ts 的边界说明里会出现数据集名称（禁止性条款），故只校验站点引用。
    for (const relativePath of KNOWLEDGE_DATA_RELATIVE_PATHS) {
      const source = readSource(relativePath)
      assert.isTrue(source.length > 0)
      for (const pattern of [
        /matrix\s*20(03|10)/i,
        /triz40\.com/i,
        /systematic-innovation\.com/i,
      ]) {
        assert.isFalse(pattern.test(source), `${relativePath} 引入了外部矩阵数据集引用`)
      }
    }

    const indexSource = readSource(KNOWLEDGE_INDEX_RELATIVE_PATH)
    assert.isFalse(
      /triz40\.com|systematic-innovation\.com/i.test(indexSource),
      '知识包入口不得引用外部矩阵数据集站点',
    )
  })
})

test.group('TRIZ 知识包检索 · 按原则编号', () => {
  test('原则 1 命中分割原则及其溯源标注', ({ assert }) => {
    const entry = searchPrincipleByNumber(1)
    assert.isNotNull(entry)
    assert.equal(entry!.number, 1)
    assert.equal(entry!.nameZh, '分割原则')
    assert.equal(entry!.displayName, '拆分与模块化')
    assert.include(entry!.nameEn, 'Segmentation')
    assert.include(entry!.nameRu, 'Дробление')
    assert.equal(entry!.source, 'triz-fundamentals.md §二 · 原则 1')
  })

  test('原则 40 命中复合材料原则，与全量条目一致', ({ assert }) => {
    const entry = searchPrincipleByNumber(40)
    assert.isNotNull(entry)
    assert.equal(entry!.nameZh, '复合材料原则')
    assert.equal(entry!.displayName, '人机复合')
    assert.deepEqual(
      entry,
      TRIZ_PRINCIPLES.find((item) => item.number === 40),
    )
  })

  test('参数 27 命中可靠性并带 §3.1 溯源与 PM 映射含义', ({ assert }) => {
    const entry = searchParameterByNumber(27)
    assert.isNotNull(entry)
    assert.equal(entry!.nameZh, '可靠性')
    assert.equal(entry!.displayName, '交付可靠性')
    assert.include(entry!.source, 'triz-fundamentals.md §3.1 · 参数 27')
    assert.include(entry!.pmMeaning, '产品无 Bug 率')
    assert.isNotNull(entry!.pmMeaningSource)
  })

  test('编号越界 / 非整数返回 null（中性空结果，不抛错）', ({ assert }) => {
    for (const number of [0, 41, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.isNull(searchPrincipleByNumber(number), `原则编号 ${number} 应为 null`)
    }
    for (const number of [0, 40, -1, 12.5, Number.NaN]) {
      assert.isNull(searchParameterByNumber(number), `参数编号 ${number} 应为 null`)
    }
  })
})

test.group('TRIZ 知识包检索 · 按关键词', () => {
  test('中文关键词命中原则且排序确定', ({ assert }) => {
    const result = searchByKeyword('分割')
    assert.equal(result.keyword, '分割')
    assert.isTrue(result.principles.length >= 1)
    assert.equal(result.principles[0].number, 1)
    assert.equal(result.principles[0].nameZh, '分割原则')
  })

  test('英文关键词大小写不敏感（含俄文名命中）', ({ assert }) => {
    const lower = searchByKeyword('segmentation')
    const mixed = searchByKeyword('SeGmEnTaTiOn')
    assert.equal(lower.principles[0].number, 1)
    assert.deepEqual(mixed, lower)

    // 俄文名同样参与关键词匹配（用词干避开「ё / е」书写差异）。
    const russian = searchByKeyword('Матр')
    assert.equal(russian.principles[0].number, 7)
  })

  test('关键词可命中软件管理实例与 PM 释义字段', ({ assert }) => {
    const byExample = searchByKeyword('微服务')
    assert.isTrue(byExample.principles.some((entry) => entry.number === 1))

    const byMeaning = searchByKeyword('灰度静默窗口')
    assert.isTrue(byMeaning.principles.some((entry) => entry.number === 11))
  })

  test('关键词同时覆盖参数、14 对矛盾映射与经典推演', ({ assert }) => {
    const parameters = searchByKeyword('工期延误')
    assert.isTrue(parameters.parameters.some((entry) => entry.number === 25))

    const pairs = searchByKeyword('Brooks')
    assert.lengthOf(pairs.pairs, 1)
    assert.equal(pairs.pairs[0].id, 'PM-03')

    const scenarios = searchByKeyword('集成风险')
    assert.isTrue(scenarios.pairs.some((entry) => entry.id === 'PM-14'))

    const classic = searchByKeyword('架构腐化')
    assert.isTrue(classic.classicScenarios.some((entry) => entry.id === 'CLASSIC-2'))
  })

  test('空关键词与未知关键词返回中性空结果', ({ assert }) => {
    for (const keyword of ['', '   ', '\t']) {
      const result = searchByKeyword(keyword)
      assert.lengthOf(result.principles, 0)
      assert.lengthOf(result.parameters, 0)
      assert.lengthOf(result.pairs, 0)
      assert.lengthOf(result.classicScenarios, 0)
    }

    const unknown = searchByKeyword('zzz-不存在的知识条目-zzz')
    assert.lengthOf(unknown.principles, 0)
    assert.lengthOf(unknown.parameters, 0)
    assert.lengthOf(unknown.pairs, 0)
    assert.lengthOf(unknown.classicScenarios, 0)
  })
})

test.group('TRIZ 知识包检索 · 按参数对', () => {
  test('改善 #39 × 恶化 #27 命中 §3.3 场景 1 的推荐原则', ({ assert }) => {
    const result = searchByParameterPair(39, 27)
    assert.isTrue(result.matched)
    assert.equal(result.improving!.number, 39)
    assert.equal(result.worsening!.number, 27)

    const classic = result.mappings.find((mapping) => mapping.id === 'CLASSIC-1')
    assert.isDefined(classic)
    assert.equal(classic!.kind, 'classic-scenario')
    assert.deepEqual([...classic!.principleNumbers], [35, 10, 28, 14])
    assert.equal(classic!.source, 'triz-fundamentals.md §3.3 · 场景 1')
    assert.deepEqual(
      classic!.principles.map((entry) => entry.number),
      [35, 10, 28, 14],
    )
    assert.isTrue(classic!.recommendations.length >= 1)
  })

  test('#39 × #27 同时带出 14 对清单里同参数对的映射（两来源各自标注）', ({ assert }) => {
    const result = searchByParameterPair(39, 27)
    const pair = result.mappings.find((mapping) => mapping.id === 'PM-14')
    assert.isDefined(pair)
    assert.equal(pair!.kind, 'pm-pair')
    assert.deepEqual([...pair!.principleNumbers], [19, 24, 1])
    assert.equal(pair!.source, 'triz-application-ai-pm.md §三 · 矛盾对 14')
    // 两来源共存时顺序固定：先经典推演、后 14 对清单。
    assert.deepEqual(
      result.mappings.map((mapping) => mapping.id),
      ['CLASSIC-1', 'PM-14'],
    )
  })

  test('改善 #25 × 恶化 #27 命中矛盾对 1 并展开原则条目', ({ assert }) => {
    const result = searchByParameterPair(25, 27)
    assert.lengthOf(result.mappings, 1)
    const mapping = result.mappings[0]
    assert.equal(mapping.id, 'PM-01')
    assert.equal(mapping.title, '时间 vs 质量（赶工期 vs 保质量）')
    assert.deepEqual([...mapping.principleNumbers], [10, 28, 24])
    assert.deepEqual(
      mapping.principles.map((entry) => entry.number),
      [10, 28, 24],
    )
    for (const entry of mapping.principles) {
      assert.include(entry.source, 'triz-fundamentals.md §二')
    }
  })

  test('改善 #35 × 恶化 #36 / #37 命中经典推演场景 2', ({ assert }) => {
    for (const worsening of [36, 37]) {
      const result = searchByParameterPair(35, worsening)
      assert.isTrue(result.matched, `#35 × #${worsening} 应命中`)
      assert.deepEqual(
        result.mappings.map((mapping) => mapping.id),
        ['CLASSIC-2'],
      )
      assert.deepEqual([...result.mappings[0].principleNumbers], [15, 1, 29, 32])
    }
  })

  test('未知参数编号返回中性空结果（不抛错、无映射）', ({ assert }) => {
    const unknownImproving = searchByParameterPair(999, 27)
    assert.isNull(unknownImproving.improving)
    assert.isNotNull(unknownImproving.worsening)
    assert.isFalse(unknownImproving.matched)
    assert.lengthOf(unknownImproving.mappings, 0)

    const unknownWorsening = searchByParameterPair(27, 0)
    assert.isNotNull(unknownWorsening.improving)
    assert.isNull(unknownWorsening.worsening)
    assert.isFalse(unknownWorsening.matched)
    assert.lengthOf(unknownWorsening.mappings, 0)

    const bothUnknown = searchByParameterPair(Number.NaN, 41)
    assert.isNull(bothUnknown.improving)
    assert.isNull(bothUnknown.worsening)
    assert.isFalse(bothUnknown.matched)
    assert.lengthOf(bothUnknown.mappings, 0)
  })

  test('两侧参数合法但无命中映射时同样是中性空结果', ({ assert }) => {
    const result = searchByParameterPair(1, 2)
    assert.isNotNull(result.improving)
    assert.isNotNull(result.worsening)
    assert.isFalse(result.matched)
    assert.lengthOf(result.mappings, 0)
  })
})

test.group('TRIZ 知识包检索 · 确定性与元信息', () => {
  test('同一输入两次调用结果完全一致（三条路径）', ({ assert }) => {
    assert.deepEqual(searchPrincipleByNumber(13), searchPrincipleByNumber(13))
    assert.deepEqual(searchParameterByNumber(13), searchParameterByNumber(13))
    assert.deepEqual(searchByKeyword('变更'), searchByKeyword('变更'))
    assert.deepEqual(searchByParameterPair(39, 27), searchByParameterPair(39, 27))
    assert.deepEqual(searchByParameterPair(1, 2), searchByParameterPair(1, 2))
  })

  test('元信息版本、条数与来源文档可读', ({ assert }) => {
    const metadata = getKnowledgePackMetadata()
    assert.equal(metadata.version, TRIZ_KNOWLEDGE_PACK_VERSION)
    assert.isTrue(metadata.version.length > 0)
    assert.equal(metadata.principleCount, 40)
    assert.equal(metadata.parameterCount, 39)
    assert.equal(metadata.pairCount, 14)
    assert.equal(metadata.classicScenarioCount, 3)
    assert.lengthOf(metadata.researchDocs, 2)
    assert.isTrue(metadata.researchDocs[0].endsWith('triz-fundamentals.md'))
    assert.isTrue(metadata.researchDocs[1].endsWith('triz-application-ai-pm.md'))
  })
})

test.group('TRIZ 知识包 · 静态红线断言', () => {
  test('模块文件全部可读（避免静态扫描空转）', ({ assert }) => {
    for (const relativePath of MODULE_PATHS) {
      const source = readSource(relativePath)
      assert.isAbove(source.length, 500, `${relativePath} 内容异常短`)
    }
  })

  test('三类红线特征表本身有效（护栏不空转）', ({ assert }) => {
    const probes: ReadonlyArray<[ReadonlyArray<[RegExp, string]>, string]> = [
      [WRITE_PATTERNS, 'await TaskModel.create({ organizationId: orgId })'],
      [PERMISSION_PATTERNS, "policy.can(user, 'ai:trigger')"],
      [SCOPE_PATTERNS, 'function run(number: number, projectId: number)'],
    ]
    for (const [patterns, probe] of probes) {
      assert.isTrue(
        patterns.some(([pattern]) => pattern.test(probe)),
        `特征表未命中探针样本：${probe}`,
      )
    }
  })

  test('检索链路内无写库调用与数据访问层依赖', ({ assert }) => {
    for (const relativePath of MODULE_PATHS) {
      const source = readSource(relativePath)
      for (const [pattern, label] of WRITE_PATTERNS) {
        assert.isFalse(pattern.test(source), `${relativePath} 命中写库特征：${label}`)
      }
    }
  })

  test('检索链路内无权限判定', ({ assert }) => {
    for (const relativePath of MODULE_PATHS) {
      const source = readSource(relativePath)
      for (const [pattern, label] of PERMISSION_PATTERNS) {
        assert.isFalse(pattern.test(source), `${relativePath} 命中权限判定特征：${label}`)
      }
    }
  })

  test('检索链路内不接受任何作用域参数', ({ assert }) => {
    for (const relativePath of MODULE_PATHS) {
      const source = readSource(relativePath)
      for (const [pattern, label] of SCOPE_PATTERNS) {
        assert.isFalse(pattern.test(source), `${relativePath} 命中作用域特征：${label}`)
      }
    }
  })

  test('检索服务只依赖知识包模块（不引入控制器 / 策略 / 模型 / 网关）', ({ assert }) => {
    const source = readSource(SERVICE_RELATIVE_PATH)
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
    assert.isAbove(specifiers.length, 0, '未解析到任何 import，静态断言可能空转')
    for (const specifier of specifiers) {
      assert.isTrue(
        specifier.startsWith('./knowledge/'),
        `检索服务引入了知识包以外的依赖：${specifier}`,
      )
    }
  })

  test('检索函数签名不接受作用域 / 权限类入参', ({ assert }) => {
    const source = readSource(SERVICE_RELATIVE_PATH)
    const exportedFunctions = [...source.matchAll(/export function (\w+)\(([^)]*)\)/g)].map(
      (match) => ({ name: match[1], params: match[2].trim() }),
    )
    assert.isAbove(exportedFunctions.length, 0)
    for (const { name, params } of exportedFunctions) {
      for (const [pattern, label] of SCOPE_PATTERNS) {
        assert.isFalse(pattern.test(params), `${name} 的入参命中作用域特征：${label}`)
      }
      for (const [pattern, label] of PERMISSION_PATTERNS) {
        assert.isFalse(pattern.test(params), `${name} 的入参命中权限特征：${label}`)
      }
    }
  })
})
