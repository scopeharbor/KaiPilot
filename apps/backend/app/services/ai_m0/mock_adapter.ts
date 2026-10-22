/**
 * ai-structured-output-poc / M0 —— Mock Adapter。
 *
 * 用途：**仅联调**——OPENAI_API_KEY 未配置时自动降级到本 Adapter，让 sandbox
 * 端点仍能返回一个「结构上合法」的最小草案，供前端 UI（DraftReviewPanel）联调。
 *
 * spec 硬约束（红线）：`isReal = false`。M0 判定禁止使用 MockAdapter 的结果，
 * `judge.ts` 会拒绝 `usingRealAdapter = false` 的 outcome 计入门禁。
 *
 * 生成策略：确定性 + 无随机源（跟 gantt-m0 一样用固定 seed 派生），保证同输入同输出，
 * 便于前端单元测试与快照对比。
 */

import type { Adapter, GenerateOptions, StreamChunk } from './gateway.ts'
import type { AiProjectDraft, AiMarker } from '@aiproj/types'
import { DRAFT_BLUEPRINTS, buildDraftFromBlueprint } from '#services/ai_draft/fixtures'

/**
 * 简单确定性草案生成器：把「一句话」哈希后派生名字与日期，避免任何随机源。
 * 目标只有一个：让前端骨架有 JSON 可读，不追求内容合理。
 */
function buildMockDraft(sentence: string): AiProjectDraft {
  const hash = simpleHash(sentence)
  const start = '2026-01-01'
  const end = '2026-06-30'
  const mk = (source: 'inferred' | 'default', reason: string, needs = false): AiMarker => ({
    confidence: source === 'default' ? 0.5 : 0.8,
    source,
    reason,
    needsConfirmation: needs,
  })
  const wbsId1 = `w-${hash}-1`
  const wbsId2 = `w-${hash}-2`
  return {
    charter: {
      title: { value: `模拟项目 #${hash}`, marker: mk('inferred', '来自一句话摘要') },
      vision: { value: '本项目仅用于联调 M0 sandbox', marker: mk('default', '兜底文案') },
      scope: { value: '前后端骨架 + AIMarker 展示', marker: mk('default', '兜底文案') },
      successCriteria: {
        value: ['完成骨架联调', '覆盖 6 类错误', 'AIMarker 100%'],
        marker: mk('inferred', '从一句话拆分'),
      },
      startDate: { value: start, marker: mk('inferred', '当前季度起点', true) },
      endDate: { value: end, marker: mk('inferred', '默认 6 个月', true) },
    },
    wbs: [
      {
        id: wbsId1,
        parentId: null,
        outlineCode: '1',
        name: { value: '需求梳理', marker: mk('inferred', '常见起始阶段') },
        description: { value: '梳理输入与约束', marker: mk('default', '兜底') },
        children: [
          {
            id: `${wbsId1}-1`,
            parentId: wbsId1,
            outlineCode: '1.1',
            name: { value: '收集访谈材料', marker: mk('inferred', '子任务') },
            description: { value: '', marker: mk('default', '兜底') },
            children: [],
          },
        ],
      },
      {
        id: wbsId2,
        parentId: null,
        outlineCode: '2',
        name: { value: '交付', marker: mk('inferred', '常见收尾阶段') },
        description: { value: '', marker: mk('default', '兜底') },
        children: [],
      },
    ],
    tasks: [
      {
        id: `t-${hash}-1`,
        wbsNodeId: `${wbsId1}-1`,
        name: { value: '首轮访谈', marker: mk('inferred', '典型开局任务') },
        description: { value: '', marker: mk('default', '兜底') },
        status: 'not_started',
        durationDays: { value: 5, marker: mk('inferred', '经验估算', true) },
        startDate: { value: start, marker: mk('inferred', '项目起点', true) },
        endDate: { value: '2026-01-08', marker: mk('inferred', '按 5 天推算', true) },
        dependencies: [],
        assigneeHint: { value: 'PM', marker: mk('default', '兜底角色') },
      },
    ],
    acceptanceCriteria: [
      {
        id: `a-${hash}-1`,
        statement: { value: '前端能读到并渲染 AIMarker', marker: mk('inferred', 'POC 目标') },
        linkedSuccessIndex: 0,
      },
    ],
  }
}

function simpleHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h.toString(36).slice(0, 6)
}

/**
 * 项目描述里带上这个标记时（出现在 sentence 或用户 prompt 中），Mock 在首个生成阶段 charter_scope 的首个 chunk
 * 延迟 {@link MOCK_SLOW_FIRST_CHUNK_DEFAULT_MS}。
 */
export const MOCK_SLOW_FIRST_CHUNK_MARKER = '【模拟慢模型】'
export const MOCK_SLOW_FIRST_CHUNK_DEFAULT_MS = 25_000

/**
 * 测试专用：Mock 首个 chunk 的延迟（毫秒），用来验证静默窗口内心跳保活、浏览器不误报断线（E2E-031）。
 * 环境变量 AI_DRAFT_SLOW_FIRST_CHUNK_MS 对整个进程的每次调用生效；描述里带标记只影响这一次生成，
 * 不拖慢同一后端上的其他端到端用例。两者都没有时不延迟。
 *
 * 标记只在首个阶段 charter_scope 生效：后续阶段与质量闭环（prompt 不带阶段信封）会再调用
 * 模型十几次，每次都等 25s 会让生成远超测试等待时间。
 */
export function resolveSlowFirstChunkMs(
  text: string | undefined,
  envValue: string | undefined,
  stage: string | null = null,
) {
  const fromEnv = Number(envValue ?? 0)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  if (stage !== 'charter_scope') return 0
  return text?.includes(MOCK_SLOW_FIRST_CHUNK_MARKER) ? MOCK_SLOW_FIRST_CHUNK_DEFAULT_MS : 0
}

/**
 * 五阶段生成启用后，离线 adapter 也必须遵守「本阶段只返回本阶段字段」协议。
 * 这里复用确定性 fixture 仅为了本机 UI / CI 联调；`isReal=false` 与生成元数据门禁
 * 会继续阻止它被确认导入。
 */
function parseStageRequest(options: GenerateOptions): Record<string, unknown> | null {
  try {
    const stageRequestText = options.promptSet?.userPrompt.split('\n\n【定向修复信封】', 1)[0]
    const parsed = JSON.parse(stageRequestText ?? '') as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 旧单次生成 prompt 不是 JSON 时保留原有联调响应。
  }
  return null
}

function stageOf(request: Record<string, unknown> | null): string | null {
  return typeof request?.stage === 'string' ? request.stage : null
}

function stageAwarePayload(options: GenerateOptions): unknown {
  const request = parseStageRequest(options)
  const stage = stageOf(request)
  if (!stage) return buildMockDraft(options.sentence)

  const draft = buildDraftFromBlueprint(DRAFT_BLUEPRINTS.software)
  if (stage === 'reconcile_review') return draft

  const fields = Array.isArray(request?.requiredOutputFields)
    ? request.requiredOutputFields.filter((field): field is string => typeof field === 'string')
    : []
  return Object.fromEntries(
    fields
      .filter((field) => field in draft)
      .map((field) => [field, (draft as unknown as Record<string, unknown>)[field]]),
  )
}

export class MockAdapter implements Adapter {
  readonly providerName = 'mock'
  readonly modelName = 'mock-deterministic-v1'
  readonly isReal = false

  async ping() {
    return { ok: true }
  }

  async ocrPreview() {
    return {
      ok: true,
      extractedText: '模拟 OCR 文本',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const json = JSON.stringify(stageAwarePayload(options))
    // 分成 4 片模拟 SSE chunk，让前端能看到流式效果。
    const size = Math.ceil(json.length / 4)
    // 草案各阶段的 sentence 是固定标签，用户描述在 prompt 里，两处都要看
    const slowFirstChunkMs = resolveSlowFirstChunkMs(
      [options.sentence, options.promptSet?.userPrompt].filter(Boolean).join('\n'),
      process.env.AI_DRAFT_SLOW_FIRST_CHUNK_MS,
      stageOf(parseStageRequest(options)),
    )
    let seq = 0
    for (let i = 0; i < json.length; i += size) {
      if (i === 0 && slowFirstChunkMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, slowFirstChunkMs))
      }
      seq += 1
      // 兼容 abort 语义（用户取消）
      if (options.signal?.aborted) {
        yield { kind: 'error', errorKind: 'sse_interrupted', errorMessage: 'aborted' }
        return
      }
      yield { kind: 'text', text: json.slice(i, i + size), eventId: String(seq) }
    }
    yield { kind: 'done', eventId: String(seq + 1) }
  }
}
