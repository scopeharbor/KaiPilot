/**
 * Ace 命令：ai:draft-eval —— AI 草案固定回归评测。
 *
 * 默认走确定性引擎（不调用模型），只验证评测链路；真实模型评测按项目规则需要用户明确授权：
 * 必须同时传 `--real` 并设置环境变量 AI_DRAFT_EVAL_ALLOW_REAL=1，否则拒绝执行。
 *
 * 报告写入 tmp/ai-draft-eval/<时间戳>.{json,md}；传 `--baseline` 时与基线比较并列出退化，
 * 有退化时退出码为 1；`--update-baseline` 把本次结果写成新基线。
 *
 * 示例：
 *   node ace ai:draft-eval
 *   AI_DRAFT_EVAL_ALLOW_REAL=1 node ace ai:draft-eval --real --organization-id=1 --connection-id=3 --cases=bank-payment-clearing
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

const DEFAULT_BASELINE = 'tests/fixtures/ai_draft_eval/baseline.json'

export default class AiDraftEvalCommand extends BaseCommand {
  static commandName = 'ai:draft-eval'
  static description = 'AI 草案固定回归评测（默认确定性引擎；真实模型需显式授权）'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  @flags.boolean({ description: '调用真实模型（需同时设置 AI_DRAFT_EVAL_ALLOW_REAL=1）' })
  declare real?: boolean

  @flags.string({ description: '只跑指定案例，逗号分隔（默认全部 7 个）' })
  declare cases?: string

  @flags.number({ description: '真实模型：组织 ID' })
  declare organizationId?: number

  @flags.number({ description: '真实模型：AI 连接 ID' })
  declare connectionId?: number

  @flags.number({ description: '真实模型：模型 ID' })
  declare modelId?: number

  @flags.string({ description: `与基线比较（默认 ${DEFAULT_BASELINE}，文件不存在则跳过）` })
  declare baseline?: string

  @flags.boolean({ description: '把本次结果写成新基线' })
  declare updateBaseline?: boolean

  async run(): Promise<void> {
    const { DRAFT_EVAL_CASES } = await import('#services/ai_draft/eval/cases')
    const { compareDraftEvalReports, formatDraftEvalMarkdown, runDraftEvalSuite } =
      await import('#services/ai_draft/eval/draft_eval_runner')
    const { AIGateway } = await import('#services/ai_m0/gateway')
    const { MockAdapter } = await import('#services/ai_m0/mock_adapter')

    const wanted = this.cases
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const cases = wanted?.length
      ? DRAFT_EVAL_CASES.filter((item) => wanted.includes(item.id))
      : DRAFT_EVAL_CASES
    if (cases.length === 0) {
      this.logger.error(`没有匹配的案例：${this.cases}`)
      this.exitCode = 1
      return
    }

    let mode: 'deterministic' | 'real' = 'deterministic'
    let resolved
    if (this.real) {
      if (process.env.AI_DRAFT_EVAL_ALLOW_REAL !== '1') {
        this.logger.error(
          '真实模型评测会产生模型调用费用，需设置 AI_DRAFT_EVAL_ALLOW_REAL=1 明确授权',
        )
        this.exitCode = 1
        return
      }
      if (!this.organizationId) {
        this.logger.error('真实模型评测需要 --organization-id')
        this.exitCode = 1
        return
      }
      const { resolveAdapter } = await import('#services/ai_m0/resolver')
      resolved = await resolveAdapter({
        connectionId: this.connectionId ?? null,
        modelId: this.modelId ?? null,
        organizationId: this.organizationId,
        requiredCapabilities: ['project_draft'],
        recordContext: {
          organizationId: this.organizationId,
          capability: 'project_draft',
          surface: 'ai-draft-eval',
          workflowName: 'ai-draft-regression-eval',
        },
      })
      if (!resolved.usingRealAdapter || resolved.unavailable) {
        this.logger.error('未解析到可用的真实模型连接，已停止（不会退回模拟模型冒充真实结果）')
        this.exitCode = 1
        return
      }
      mode = 'real'
    } else {
      resolved = {
        gateway: new AIGateway(new MockAdapter()),
        provider: 'mock',
        model: 'mock-deterministic-v1',
        usingRealAdapter: false,
        source: 'mock' as const,
      }
    }

    this.logger.info(
      `开始评测 ${cases.length} 个案例（${mode === 'real' ? `真实模型 ${resolved.model}` : '确定性引擎'}）`,
    )
    const report = await runDraftEvalSuite({
      cases,
      resolved,
      mode,
      onCaseDone: (metrics) =>
        this.logger.info(
          `  ${metrics.caseId}：${metrics.status === 'completed' ? '完成' : '失败'} · 阻断 ${metrics.blocking} · 重跑 ${metrics.retries} · 循环 ${metrics.repetitionLoops} · ${Math.round(metrics.elapsedMs / 1000)} 秒`,
        ),
    })

    const baselinePath = this.app.makePath(this.baseline ?? DEFAULT_BASELINE)
    let regressions: ReturnType<typeof compareDraftEvalReports> = []
    try {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
      if (baseline.mode === report.mode) regressions = compareDraftEvalReports(baseline, report)
      else this.logger.warning(`基线模式（${baseline.mode}）与本次（${report.mode}）不同，跳过比较`)
    } catch {
      this.logger.info('未找到基线，跳过比较')
    }

    const stamp = report.startedAt.replace(/[:.]/g, '-')
    const outDir = this.app.makePath('tmp', 'ai-draft-eval')
    await mkdir(outDir, { recursive: true })
    const markdown = formatDraftEvalMarkdown(report, regressions)
    await writeFile(join(outDir, `${stamp}.json`), JSON.stringify(report, null, 2))
    await writeFile(join(outDir, `${stamp}.md`), markdown)
    this.logger.info(`报告：${join(outDir, `${stamp}.md`)}`)

    if (this.updateBaseline) {
      await mkdir(dirname(baselinePath), { recursive: true })
      await writeFile(baselinePath, JSON.stringify(report, null, 2))
      this.logger.info(`已更新基线：${baselinePath}`)
    }

    if (regressions.length > 0) {
      for (const item of regressions) {
        this.logger.error(
          `退化 · ${item.caseId} · ${item.metric}：${item.baseline ?? '—'} → ${item.current ?? '—'}（${item.detail}）`,
        )
      }
      this.exitCode = 1
    } else {
      this.logger.info('✅ 相对基线无退化')
    }
  }
}
