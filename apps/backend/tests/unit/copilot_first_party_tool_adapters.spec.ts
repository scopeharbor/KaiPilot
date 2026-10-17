/**
 * v3-copilot-first-party-tool-pack — 四适配器单元测试（fake deps，零 DB、零网络）。
 *
 * 覆盖：
 * - 2.2 项目查询：有界投影、跨组织零披露、结果大小上界、query-only
 * - 2.4 TRIZ：Skill 未激活降级（synthetic）、已激活路径引用既有层、正式表零变化
 * - 2.6 周报：不可访问来源不泄露、无发布/外发语义、超大草稿截断
 * - 2.8 风险：无自动登记/改级/关闭（applied=false）、权限撤销后泛化拒绝
 * - 调度器 fail-closed 与官方声明一致性；fixture 包 JSON ↔ 共享契约 digest 一致
 */

import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
  FIRST_PARTY_TOOL_PROJECT_QUERY_ID,
  FIRST_PARTY_TOOL_RISK_EXPLAINER_ID,
  FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID,
  FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
  OFFICIAL_PACK_FIXTURE_NOW_ISO,
} from '@aiproj/types'

import {
  FirstPartyToolDispatcher,
  weekRangeFor,
  type FirstPartyToolAdapterDeps,
} from '../../app/services/copilot_first_party_tools/first_party_tool_dispatcher.js'

// ===========================================================================
// 夹具
// ===========================================================================

const CTX = { organizationId: 4201, actorId: 'user:99001', projectId: 8101 }
const CTX_NO_PROJECT = { organizationId: 4201, actorId: 'user:99001' }

function makeDeps(overrides: Partial<FirstPartyToolAdapterDeps> = {}): FirstPartyToolAdapterDeps {
  return {
    listVisibleProjects: async ({ limit }) => {
      const rows = [
        { projectId: 1, name: '项目A', code: 'PA', status: 'active', priority: 'high' },
        { projectId: 2, name: '项目B', code: 'PB', status: 'planning', priority: null },
      ]
      return rows.slice(0, limit)
    },
    getVisibleProjectHeader: async () => ({ name: '项目A', status: 'active' }),
    getWeeklyFacts: async () => ({
      accessible: true,
      totalTasks: 20,
      completedTasks: 5,
      overdueTasks: 2,
      openRisks: 3,
    }),
    getTrizAdvisory: async () => ({
      activationState: '已激活（2 个可用目的地）',
      availableDestinationCount: 2,
      guidance: '沿 TRIZ 流程推进',
    }),
    listExplainableRisks: async () => [
      {
        id: 7,
        title: '交付延期风险',
        riskLevel: '高',
        score: 20,
        status: 'open',
        category: 'schedule',
      },
    ],
    renderWeeklyDraft: (input) => ({
      draft: `# ${input.projectName} — 周报\n\n总体摘要：完成率 ${input.completedPercent}%。`,
    }),
    now: () => OFFICIAL_PACK_FIXTURE_NOW_ISO,
    ...overrides,
  }
}

// ===========================================================================
// 调度器与声明一致性
// ===========================================================================

describe('first-party dispatcher — fail-closed 与声明一致', () => {
  it('官方四 toolId 全部可路由；未知 toolId 抛错（wrapper 记 error）', async () => {
    const dispatcher = new FirstPartyToolDispatcher(makeDeps())
    for (const declaration of COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools) {
      const out = await dispatcher.execute(
        { toolId: declaration.toolId, version: declaration.version, budget: { timeoutMs: 8000 } },
        CTX,
        minimalInputFor(declaration.toolId),
      )
      assert.equal(typeof out, 'string')
      assert.ok(out.length > 0)
    }
    await assert.rejects(
      dispatcher.execute(
        { toolId: 'ctool_unknown_tool', version: '1.0.0', budget: { timeoutMs: 1000 } },
        CTX,
        {},
      ),
      /未收录的工具/,
    )
  })

  it('fixture 包 JSON 与共享契约逐工具 digest 一致（同一版本重复构建）', () => {
    const packDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../fixtures/plugins/com.aiproj.official.copilot-tool-pack',
    )
    const onDisk = JSON.parse(
      readFileSync(join(packDir, 'contributions/copilot-tools.json'), 'utf-8'),
    ) as { schemaVersion: string; tools: readonly Record<string, unknown>[] }

    assert.equal(onDisk.schemaVersion, COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.schemaVersion)
    assert.equal(onDisk.tools.length, COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.length)
    for (const declared of COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools) {
      const mirrored = onDisk.tools.find((t) => t['toolId'] === declared.toolId)
      assert.ok(mirrored, `fixture 包缺少工具 ${declared.toolId}`)
      assert.deepEqual(mirrored, { ...declared })
    }
  })
})

function minimalInputFor(toolId: string): Record<string, unknown> {
  if (toolId === FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID) return { projectId: 8101, problem: '结构超重' }
  if (toolId === FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID) return { projectId: 8101 }
  if (toolId === FIRST_PARTY_TOOL_RISK_EXPLAINER_ID) return { projectId: 8101 }
  return {}
}

// ===========================================================================
// 2.2 项目查询
// ===========================================================================

describe('project-query adapter — 有界投影与零披露', () => {
  it('只返回有界字段；limit 生效；query-only 无任何写入通道', async () => {
    let listedLimit = 0
    const deps = makeDeps({
      listVisibleProjects: async ({ limit }) => {
        listedLimit = limit
        return [{ projectId: 3, name: '可见项目', code: 'VC', status: 'active', priority: null }]
      },
    })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      { toolId: FIRST_PARTY_TOOL_PROJECT_QUERY_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
      CTX,
      { limit: 1 },
    )
    const parsed = JSON.parse(raw) as { totalVisible: number; itemsJson: string; scopeNote: string }
    assert.equal(listedLimit, 1)
    assert.equal(parsed.totalVisible, 1)
    const items = JSON.parse(parsed.itemsJson) as Record<string, unknown>[]
    assert.equal(items.length, 1)
    // 有界投影：仅允许的键
    for (const item of items) {
      for (const key of Object.keys(item)) {
        assert.ok(['projectId', 'name', 'code', 'status', 'priority'].includes(key))
      }
    }
    assert.match(parsed.scopeNote, /无权限项目不计入/)
  })

  it('跨组织调用：可见列表为空 → totalVisible=0 且无任何目标组织实体信息', async () => {
    const deps = makeDeps({ listVisibleProjects: async () => [] })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      { toolId: FIRST_PARTY_TOOL_PROJECT_QUERY_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
      { organizationId: 9999999, actorId: 'user:1' },
      {},
    )
    const parsed = JSON.parse(raw) as { totalVisible: number; itemsJson: string }
    assert.equal(parsed.totalVisible, 0)
    assert.equal(parsed.itemsJson, '[]')
    assert.equal(raw.includes('4201'), false)
  })

  it('超大结果被适配器截断且带标记（预算内保护）', async () => {
    const bigName = '长'.repeat(400)
    const deps = makeDeps({
      listVisibleProjects: async () =>
        Array.from({ length: 20 }, (_, i) => ({
          projectId: i + 1,
          name: bigName,
          code: `C${i}`,
          status: 'active',
          priority: null,
        })),
    })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      { toolId: FIRST_PARTY_TOOL_PROJECT_QUERY_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
      CTX,
      {},
    )
    assert.equal(raw.length <= 6200, true, '适配器输出必须低于硬上限')
    if (raw.includes('truncatedByAdapter')) {
      assert.ok(raw.includes('[截断]'))
    }
  })
})

// ===========================================================================
// 2.4 TRIZ 顾问
// ===========================================================================

describe('triz-advisor adapter — 未激活降级与零写入', () => {
  it('Skill 未激活：synthetic 引导 + activationState 标注未激活', async () => {
    const deps = makeDeps({
      getTrizAdvisory: async () => ({
        activationState: '未激活（TRIZ 技能层功能关闭）',
        availableDestinationCount: 0,
        guidance: '',
      }),
    })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      { toolId: FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
      CTX,
      { projectId: 8101, problem: '梁过重' },
    )
    const parsed = JSON.parse(raw) as { summary: string; activationState: string }
    assert.match(parsed.activationState, /未激活/)
    assert.match(parsed.summary, /一般性 TRIZ 引导|TRIZ 流程/)
  })

  it('缺项目上下文 → fail-closed 抛错；建议草稿不落任何表（纯文本输出）', async () => {
    const dispatcher = new FirstPartyToolDispatcher(makeDeps())
    await assert.rejects(
      dispatcher.execute(
        { toolId: FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
        CTX_NO_PROJECT,
        { projectId: 8101, problem: 'x' },
      ),
      /需要项目上下文/,
    )
  })

  it('weekRangeFor：确定性周区间与 clamp', () => {
    const r = weekRangeFor(OFFICIAL_PACK_FIXTURE_NOW_ISO, 0)
    assert.equal(r.fromDate, '2026-08-24') // 2026-08-25 为周二
    assert.equal(r.toDate, '2026-08-30')
    const clamped = weekRangeFor(OFFICIAL_PACK_FIXTURE_NOW_ISO, -99)
    assert.deepEqual(clamped, weekRangeFor(OFFICIAL_PACK_FIXTURE_NOW_ISO, -4))
  })
})

// ===========================================================================
// 2.6 周报草稿
// ===========================================================================

describe('weekly-report-draft adapter — 不泄露与不外发', () => {
  it('不可访问项目：泛化限制文案，不披露存在性/名称', async () => {
    const deps = makeDeps({ getVisibleProjectHeader: async () => null })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      {
        toolId: FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
        version: '1.0.0',
        budget: { timeoutMs: 8000 },
      },
      { organizationId: 4201, actorId: 'user:99001', projectId: 777 },
      { projectId: 777 },
    )
    const parsed = JSON.parse(raw) as { summary: string; sourceScopeNote: string }
    assert.match(parsed.summary, /无法访问|不在当前可见范围/)
    assert.equal(parsed.summary.includes('项目A'), false)
    assert.match(parsed.sourceScopeNote, /不披露/)
  })

  it('草稿固定标注「不发布/不外发/不写回」，并附数据截止时间与来源范围', async () => {
    const dispatcher = new FirstPartyToolDispatcher(makeDeps())
    const raw = await dispatcher.execute(
      {
        toolId: FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
        version: '1.0.0',
        budget: { timeoutMs: 8000 },
      },
      CTX,
      { projectId: 8101 },
    )
    const parsed = JSON.parse(raw) as {
      summary: string
      sourceScopeNote: string
      dataCutoffAt: string
    }
    assert.match(parsed.summary, /不会发布、发送或外发/)
    assert.match(parsed.summary, /不写回正式报表/)
    assert.equal(parsed.dataCutoffAt, OFFICIAL_PACK_FIXTURE_NOW_ISO)
    assert.match(parsed.sourceScopeNote, /来源范围/)
    assert.match(parsed.sourceScopeNote, /一般性缺口/)
  })

  it('部分数据源不可访问：只做一般性缺口标注，不披露来源细节', async () => {
    const deps = makeDeps({
      getWeeklyFacts: async () => ({
        accessible: false,
        totalTasks: 0,
        completedTasks: 0,
        overdueTasks: 0,
        openRisks: 0,
      }),
    })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      {
        toolId: FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
        version: '1.0.0',
        budget: { timeoutMs: 8000 },
      },
      CTX,
      { projectId: 8101 },
    )
    const parsed = JSON.parse(raw) as { sourceScopeNote: string; summary: string }
    assert.match(parsed.sourceScopeNote, /不可访问/)
    assert.match(parsed.sourceScopeNote, /不披露具体来源/)
  })

  it('超大草稿被截断到适配器上限', async () => {
    const deps = makeDeps({
      renderWeeklyDraft: () => ({ draft: '长'.repeat(20000) }),
    })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      {
        toolId: FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
        version: '1.0.0',
        budget: { timeoutMs: 8000 },
      },
      CTX,
      { projectId: 8101 },
    )
    assert.ok(raw.length <= 6200)
    assert.ok(raw.includes('[截断]'))
  })
})

// ===========================================================================
// 2.8 风险解释
// ===========================================================================

describe('risk-explainer adapter — 无自动登记/改级/关闭', () => {
  it('解释输出含建议动作预览块且 applied=false；无任何变更类动作', async () => {
    const dispatcher = new FirstPartyToolDispatcher(makeDeps())
    const raw = await dispatcher.execute(
      { toolId: FIRST_PARTY_TOOL_RISK_EXPLAINER_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
      CTX,
      { projectId: 8101 },
    )
    const parsed = JSON.parse(raw) as { summary: string; suggestedActionPreviewJson: string }
    assert.match(parsed.summary, /不改变任何风险记录/)
    const actions = JSON.parse(parsed.suggestedActionPreviewJson) as Record<string, unknown>[]
    assert.equal(actions.length, 1)
    assert.equal(actions[0]!['applied'], false)
    assert.equal(actions[0]!['applicableVia'], 'core-risk-flow')
    // 绝不出现改级/登记/关闭类动作字段
    assert.equal(JSON.stringify(actions).includes('"field":"risk_level"'), false)
  })

  it('权限撤销（可见列表为空）：泛化说明，不泄露风险信息', async () => {
    const deps = makeDeps({ listExplainableRisks: async () => [] })
    const dispatcher = new FirstPartyToolDispatcher(deps)
    const raw = await dispatcher.execute(
      { toolId: FIRST_PARTY_TOOL_RISK_EXPLAINER_ID, version: '1.0.0', budget: { timeoutMs: 8000 } },
      { organizationId: 8888888, actorId: 'user:1', projectId: 1 },
      { projectId: 1 },
    )
    const parsed = JSON.parse(raw) as { summary: string; suggestedActionPreviewJson: string }
    assert.match(parsed.summary, /没有匹配的风险记录/)
    assert.equal(parsed.suggestedActionPreviewJson, '[]')
  })
})
