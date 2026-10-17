/**
 * streaming-evidence-catalog —— 流式发布场景目录（V2.5 W7）。
 *
 * 定义 AI Draft 与 Compiler 两个领域的共享与领域专属场景。
 */

import type { StreamingScenario, StreamingScenarioCatalog } from './streaming-evidence.js'

const SHARED_SCENARIOS: StreamingScenario[] = [
  {
    id: 'shared-sequence-monotonic',
    domain: 'ai-draft',
    level: 'contract',
    title: '事件 sequence 严格单调递增',
    fixtureRef: 'shared/sequence-monotonic',
    requiredBrowsers: ['chromium'],
    assertion: '所有事件的 sequence 必须严格递增',
    attachmentStrategy: 'none',
  },
  {
    id: 'shared-no-duplicate-event-id',
    domain: 'ai-draft',
    level: 'contract',
    title: '无重复 eventId',
    fixtureRef: 'shared/no-duplicate-event-id',
    requiredBrowsers: ['chromium'],
    assertion: '所有事件的 eventId 全局唯一',
    attachmentStrategy: 'none',
  },
  {
    id: 'shared-unique-terminal',
    domain: 'ai-draft',
    level: 'contract',
    title: '唯一终态',
    fixtureRef: 'shared/unique-terminal',
    requiredBrowsers: ['chromium'],
    assertion: 'completed/failed/cancelled 最多一个',
    attachmentStrategy: 'none',
  },
  {
    id: 'shared-heartbeat-no-semantic-payload',
    domain: 'ai-draft',
    level: 'contract',
    title: 'heartbeat 不含语义 payload',
    fixtureRef: 'shared/heartbeat-no-semantic-payload',
    requiredBrowsers: ['chromium'],
    assertion: 'heartbeat 事件只含 timestamp 和 sequence',
    attachmentStrategy: 'none',
  },
  {
    id: 'shared-gap-pause-rest-replay',
    domain: 'ai-draft',
    level: 'integration',
    title: 'Gap 时暂停、REST replay、收敛后继续 realtime',
    fixtureRef: 'shared/gap-pause-rest-replay',
    requiredBrowsers: ['chromium', 'firefox'],
    assertion: 'gap 期间前端暂停更新，replay 后从 gap 后恢复',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'shared-reconnect-resume',
    domain: 'ai-draft',
    level: 'integration',
    title: '断开重连后恢复光标',
    fixtureRef: 'shared/reconnect-resume',
    requiredBrowsers: ['chromium', 'firefox', 'webkit'],
    assertion: '断线重连后 cursor 不丢失',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'shared-terminal-freeze',
    domain: 'ai-draft',
    level: 'contract',
    title: '终态冻结不再接受新事件',
    fixtureRef: 'shared/terminal-freeze',
    requiredBrowsers: ['chromium'],
    assertion: 'reached terminal → 拒绝后续非 heartbeat 事件',
    attachmentStrategy: 'none',
  },
]

const AI_DRAFT_SCENARIOS: StreamingScenario[] = [
  {
    id: 'ai-draft-started-before-model',
    domain: 'ai-draft',
    level: 'integration',
    title: '模型开始前发出 started',
    fixtureRef: 'ai-draft/started-before-model',
    requiredBrowsers: ['chromium'],
    assertion: 'SSE started 事件先于第一个 model chunk',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'ai-draft-real-module-progress',
    domain: 'ai-draft',
    level: 'integration',
    title: '真实模块推进',
    fixtureRef: 'ai-draft/real-module-progress',
    requiredBrowsers: ['chromium', 'firefox'],
    assertion: '模块进度随扫描器递增',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'ai-draft-failed-with-reason-code',
    domain: 'ai-draft',
    level: 'integration',
    title: '失败返回 reason code',
    fixtureRef: 'ai-draft/failed-with-reason-code',
    requiredBrowsers: ['chromium'],
    assertion: 'failed 事件携带低敏 reason code',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'ai-draft-user-reject-no-import',
    domain: 'ai-draft',
    level: 'integration',
    title: '用户拒绝不触发导入',
    fixtureRef: 'ai-draft/user-reject-no-import',
    requiredBrowsers: ['chromium'],
    assertion: '用户拒绝后无正式数据写入',
    attachmentStrategy: 'screenshot',
  },
]

const COMPILER_SCENARIOS: StreamingScenario[] = [
  {
    id: 'compiler-persist-then-publish',
    domain: 'compiler',
    level: 'integration',
    title: '持久化后 publish',
    fixtureRef: 'compiler/persist-then-publish',
    requiredBrowsers: ['chromium'],
    assertion: 'Stage Event DB 保存后发出 realtime envelope',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'compiler-publish-fallback-rest-replay',
    domain: 'compiler',
    level: 'integration',
    title: 'publish 失败后 REST replay 恢复',
    fixtureRef: 'compiler/publish-fallback-rest-replay',
    requiredBrowsers: ['chromium', 'firefox'],
    assertion: 'realtime 不可用 → REST replay → 数据一致',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'compiler-snapshot-subscribe-replay-race',
    domain: 'compiler',
    level: 'integration',
    title: 'snapshot → subscribe → replay 竞态安全',
    fixtureRef: 'compiler/snapshot-subscribe-replay-race',
    requiredBrowsers: ['chromium'],
    assertion: '三条操作按序执行无事件丢失',
    attachmentStrategy: 'screenshot',
  },
  {
    id: 'compiler-cross-org-no-leak',
    domain: 'compiler',
    level: 'integration',
    title: '跨组织不泄漏 run 存在性',
    fixtureRef: 'compiler/cross-org-no-leak',
    requiredBrowsers: ['chromium'],
    assertion: '非成员收到统一 RESOURCE_NOT_FOUND',
    attachmentStrategy: 'none',
  },
  {
    id: 'compiler-terminal-only-artifact',
    domain: 'compiler',
    level: 'integration',
    title: 'completed 只展示待审查 artifact',
    fixtureRef: 'compiler/terminal-only-artifact',
    requiredBrowsers: ['chromium'],
    assertion: 'completed 后前端只展示 artifact，不触发 apply',
    attachmentStrategy: 'screenshot',
  },
]

export const STREAMING_EVIDENCE_CATALOG: StreamingScenarioCatalog = {
  version: '1.0',
  scenarios: [...SHARED_SCENARIOS, ...AI_DRAFT_SCENARIOS, ...COMPILER_SCENARIOS],
  hash: computeCatalogHash([...SHARED_SCENARIOS, ...AI_DRAFT_SCENARIOS, ...COMPILER_SCENARIOS]),
}

function computeCatalogHash(scenarios: StreamingScenario[]): string {
  const raw = JSON.stringify(scenarios.map((s) => s.id).sort())
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i)
    hash |= 0
  }
  return `cat_${Math.abs(hash).toString(36)}`
}
