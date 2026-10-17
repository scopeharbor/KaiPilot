/**
 * AI 反幻觉 · 结构化回归门禁（ai-anti-hallucination task 11.1）
 *
 * 复用 `ai-structured-output-baseline`（M0 归档）定义的确定性数据集契约：
 *   1. 4 类项目类型（software / event / research / product）+ general 兜底类。
 *   2. 每类都有固定的简体中文一句话输入（`AI_INTENT_EVALUATION_CASES`）与
 *      期望关键字段清单（`expectedCritical`）。
 *   3. 每类都有固定确定性草案样本（`DRAFT_BLUEPRINTS` / `fixtureDraft`），
 *      纯字面量、无随机源、无外部 fetch。
 *
 * 本套件把两份夹具锁定为「CI 结构化回归门禁」：
 *   - 输入集分布不漂移（4 类必需项目类型全覆盖）。
 *   - 每类 fixtureDraft 通过 schema 校验 + 高影响 AIMarker 覆盖率 100%。
 *   - 相同输入 → `DraftValidationService.validate` 产出完全一致的
 *     `confidenceScore`、`dimensionScores`、blocking/warning/info 分桶（快照）。
 *   - 快照数字变动 = 规则/权重/夹具发生结构性变化，必须人工审查后更新。
 *
 * 快照数字锁定为「当前主干确定性输出」。规则或权重任何有意变动都需要在
 * 变更评审里显式更新这里的 EXPECTED_BASELINE。
 */

import { test } from '@japa/runner'
import { PROJECT_TYPES, type ProjectType } from '@aiproj/types'
import { DRAFT_VALIDATION_DIMENSIONS, DRAFT_VALIDATION_RULE_PHASE } from '@aiproj/types'
import { AI_INTENT_EVALUATION_CASES } from '../fixtures/ai_intent_cases.js'
import { DRAFT_BLUEPRINTS, fixtureDraft } from '#services/ai_draft/fixtures'
import { validateProjectDraft } from '#services/ai_draft/schema'
import { DraftValidationService } from '#services/ai_draft/validation_service'

/** M0 数据集必须覆盖的项目类型（软件/活动/研究/产品）——`general` 只作兜底类。 */
const REQUIRED_PROJECT_TYPES: readonly ProjectType[] = [
  'software',
  'event',
  'research',
  'product',
] as const

/**
 * 主干确定性回归快照。数字由当前确定性规则集在固定夹具上计算得出，
 * **一旦规则/权重/夹具变动，本表必须由变更 PR 显式更新**——这是门禁的意义。
 *
 * 结构：{ [projectType]: { confidenceScore, blocking, warning, info } }
 * blocking/warning/info 是**按 ruleId 排序**的 issue 桶，只锁 ruleId 与数量，
 * 不锁 message 文本以避免国际化/文案微调误伤门禁。
 */
type Bucket = readonly string[]
interface ExpectedReport {
  confidenceScore: number
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical'
  canConfirm: boolean
  blocking: Bucket
  warning: Bucket
  info: Bucket
}

// 快照占位——先跑一次 `pnpm test` 由 assert.deepEqual 报错吐出实际值，
// 再回填到这里锁死。首次落地流程见文件末尾说明。
//
// 2026-07-11 更新（本次修复）：`buildDraftFromBlueprint` 引入工作日排布
// （`nextWorkingDay`，与校验用的 `snapToWorkingDay` 工作日历对齐）并把验收条目
// 挂接到任务（`linkedTaskId` 不再为 null）。这是确定性 fallback 生成器的质量改进：
// 五类蓝图产出的草案不再触发 HL-006（任务落非工作日）与 VE-005（验收条目无挂接任务），
// 因此全部收敛为「零问题」快照（confidenceScore 100 / low / canConfirm）。
// HL-006、VE-005 规则本身的命中/不命中由 `ai_draft_validation_gateway.spec.ts` 专用用例
// 独立锁定，快照收敛不损失规则覆盖；本门禁在此锁定「改进后生成器不自触发反幻觉规则」。
const CLEAN_REPORT: ExpectedReport = {
  confidenceScore: 100,
  overallRiskLevel: 'low',
  canConfirm: true,
  blocking: [],
  warning: [],
  info: [],
}
const EXPECTED_BASELINE: Record<ProjectType, ExpectedReport> = {
  software: { ...CLEAN_REPORT },
  event: { ...CLEAN_REPORT },
  research: { ...CLEAN_REPORT },
  product: { ...CLEAN_REPORT },
  general: { ...CLEAN_REPORT },
}

function sortedRuleIds(bucket: { ruleId: string }[]): string[] {
  return bucket.map((issue) => issue.ruleId).sort()
}

test.group('AI 反幻觉 · 结构化回归门禁（M0 baseline 数据集）', () => {
  const service = new DraftValidationService()

  test('输入集覆盖 4 类必需项目类型（software/event/research/product）且逐次加载一致', ({
    assert,
  }) => {
    const seen = new Set<ProjectType>()
    for (const c of AI_INTENT_EVALUATION_CASES) seen.add(c.expectedType)
    for (const required of REQUIRED_PROJECT_TYPES) {
      assert.isTrue(seen.has(required), `M0 输入集缺少 ${required} 类`)
    }

    // 逐次加载一致：确定性字面量，两次读取相同数量与相同 id 序列。
    const first = AI_INTENT_EVALUATION_CASES.map((c) => c.id)
    const second = AI_INTENT_EVALUATION_CASES.map((c) => c.id)
    assert.deepEqual(first, second)
    // 至少每类项目类型 1 条（general 也计入）。
    for (const projectType of PROJECT_TYPES) {
      assert.isAtLeast(
        AI_INTENT_EVALUATION_CASES.filter((c) => c.expectedType === projectType).length,
        1,
        `M0 输入集缺 ${projectType} 类样本`,
      )
    }
  })

  test('固定草案夹具覆盖全部 5 类，每类都通过 schema 校验', ({ assert }) => {
    assert.deepEqual(Object.keys(DRAFT_BLUEPRINTS).sort(), [...PROJECT_TYPES].sort())
    for (const projectType of PROJECT_TYPES) {
      const draft = fixtureDraft(projectType)
      const result = validateProjectDraft(draft)
      const errors = result.ok ? '' : result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
      assert.isTrue(result.ok, `${projectType} 草案 schema 校验失败: ${errors}`)
    }
  })

  test('每条规则 ID 有明确阶段归属：HL→self_checking / VE→validating', ({ assert }) => {
    // 门禁避免规则漂移到错误阶段，与 gateway 阶段编排耦合。
    for (const [id, phase] of Object.entries(DRAFT_VALIDATION_RULE_PHASE)) {
      const isHL = id.startsWith('HL-')
      const isVE = id.startsWith('VE-')
      if (isHL) assert.equal(phase, 'self_checking', `${id} 应属 self_checking`)
      if (isVE) assert.equal(phase, 'validating', `${id} 应属 validating`)
      assert.isTrue(isHL || isVE, `未知规则前缀: ${id}`)
    }
  })

  test('相同输入两次调用产出完全一致的报告（跨运行复现）', ({ assert }) => {
    for (const projectType of PROJECT_TYPES) {
      const draft = fixtureDraft(projectType)
      const a = service.validate(draft, { phase: 'all' })
      const b = service.validate(draft, { phase: 'all' })
      assert.equal(a.confidenceScore, b.confidenceScore, `${projectType}: score 漂移`)
      assert.deepEqual(a.dimensionScores, b.dimensionScores, `${projectType}: dim 漂移`)
      assert.deepEqual(sortedRuleIds(a.blocking), sortedRuleIds(b.blocking))
      assert.deepEqual(sortedRuleIds(a.warning), sortedRuleIds(b.warning))
      assert.deepEqual(sortedRuleIds(a.info), sortedRuleIds(b.info))
    }
  })

  test('报告基本结构一致：dimensionScores 覆盖 5 维、桶总数等于 ruleResults', ({ assert }) => {
    for (const projectType of PROJECT_TYPES) {
      const draft = fixtureDraft(projectType)
      const report = service.validate(draft, { phase: 'all' })
      for (const dim of DRAFT_VALIDATION_DIMENSIONS) {
        assert.property(report.dimensionScores, dim, `${projectType}: 缺维度 ${dim}`)
      }
      assert.equal(
        report.ruleResults.length,
        report.blocking.length + report.warning.length + report.info.length,
        `${projectType}: 桶总数与 ruleResults 不等`,
      )
      assert.equal(report.canConfirm, report.blocking.length === 0)
    }
  })

  test('主干快照锁定：每类 confidenceScore、桶 ruleId 分布不漂移', ({ assert }) => {
    // 这条是「结构化回归门禁」的落地。任何规则/权重变动都会打破这里，
    // 需要在 PR 里显式更新 EXPECTED_BASELINE。
    for (const projectType of PROJECT_TYPES) {
      const draft = fixtureDraft(projectType)
      const report = service.validate(draft, { phase: 'all' })
      const actual: ExpectedReport = {
        confidenceScore: report.confidenceScore,
        overallRiskLevel: report.overallRiskLevel,
        canConfirm: report.canConfirm,
        blocking: sortedRuleIds(report.blocking),
        warning: sortedRuleIds(report.warning),
        info: sortedRuleIds(report.info),
      }
      assert.deepEqual(actual, EXPECTED_BASELINE[projectType], `${projectType} baseline 快照漂移`)
    }
  })
})

/**
 * 快照维护流程（人工审查用）：
 *   1. 有意变更规则/权重/夹具后，本 spec 的最后一条会失败并吐出 actual。
 *   2. 复查 diff：确认是**预期**行为变动（规则新增/严重级别调整/权重迁移）
 *      而不是意外副作用。
 *   3. 把 actual 值回填到 EXPECTED_BASELINE 表并在 PR 描述里说明为什么变了。
 *   4. 禁止在 CI 里自动 --update-snapshots。
 */
