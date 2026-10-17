/**
 * v3-plugin-action-preview-boundary —— 跨宿主 conformance 源码级断言（task 3.4）。
 *
 * 与既有 Copilot draft-layer 行为无回归 + 无第二套实现：
 * - 统一边界复用共享契约 primitive（幂等派生 / 来源新鲜度 / dry-run 门禁），
 *   不复制 Copilot 决策/会话/UI 层逻辑；
 * - server hook 旧直执旁路已移除（confirmProposal 不再产生 accepted:true）；
 * - 核心提交门只经宿主事务写入 pilot fixture 表，不触碰其他正式表；
 * - Copilot 族文件零反向依赖插件边界（单向复用，无耦合环）；
 * - 插件执行路径无领域 Model 写依赖（registry/pilot adapter 仅宿主持有）。
 *
 * 纯本地：零网络、零数据库、零 provider。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(currentDir, rel), 'utf-8')

const BOUNDARY_SERVICE = read('../../app/services/plugin_action_boundary/boundary_service.ts')
const ADAPTER_REGISTRY = read('../../app/services/plugin_action_boundary/adapter_registry.ts')
const PILOT_ADAPTER = read('../../app/services/plugin_action_boundary/pilot_adapter.ts')
const HOOK_SERVICE = read('../../app/services/plugin_server_hook_invocation_service.ts')
const COPILOT_DECISION = read(
  '../../app/services/copilot_action/copilot_action_decision_service.ts',
)
const COPILOT_VALIDATOR = read('../../app/services/copilot_action/confirmation_validator_core.ts')
const CONTRACT = resolve(
  currentDir,
  '../../../../packages/types/src/plugin-action-preview-boundary.ts',
)

describe('v3-plugin-action-preview-boundary conformance', () => {
  it('统一边界复用共享契约 primitive（幂等派生 + 新鲜度重校验 + dry-run 门禁）', () => {
    expect(BOUNDARY_SERVICE).toContain('revalidateActionSourceRefs')
    expect(BOUNDARY_SERVICE).toContain('validateActionHandleBinding')
    expect(BOUNDARY_SERVICE).toContain('isActionPreviewConfirmable')
    expect(BOUNDARY_SERVICE).toContain('buildPluginActionConfirmHandle')
    // 幂等键由服务端派生，不接受客户端键
    expect(BOUNDARY_SERVICE).toContain('assemblePluginActionPreview')
  })

  it('契约模块显式复用 Copilot primitive 且不复制其决策/UI 层', () => {
    const src = readFileSync(CONTRACT, 'utf-8')
    expect(src).toContain("from './copilot-action-boundary.js'")
    expect(src).toContain('deriveCopilotActionIdempotencyKey')
    expect(src).toContain('isCopilotActionSourceSignatureFresh')
    expect(src).toContain('assertCopilotDryRunGate')
    // 不引入 UI / 会话层概念
    expect(src).not.toContain('ActionCard')
    expect(src).not.toContain('draft_layer')
    expect(src).not.toContain('DraftLayer')
  })

  it('server hook 旧直执旁路已移除（摘要匹配不再 accepted:true）', () => {
    expect(HOOK_SERVICE).not.toContain('accepted: true')
    expect(HOOK_SERVICE).toContain('unified-boundary-required')
    expect(HOOK_SERVICE).toContain('preview-required')
    // 确认路径必须经由统一边界服务
    expect(HOOK_SERVICE).toContain('actionBoundary.registerProposal')
  })

  it('核心提交门只写 pilot fixture 表；adapter 不触碰其他正式表', () => {
    // pilot adapter 中出现的全部表名只允许是 plugin_pilot_items
    const tableRefs = [...PILOT_ADAPTER.matchAll(/(?:from|table|into)\(['"]([a-z_]+)['"]/g)].map(
      (m) => m[1],
    )
    expect(tableRefs.length).toBeGreaterThan(0)
    for (const t of tableRefs) {
      expect(t).toBe('plugin_pilot_items')
    }
    // 边界服务本体不做任何领域表读写（只操作提案行与事务委托）
    expect(BOUNDARY_SERVICE).not.toMatch(/trx\.(?:from|table)\('(?!(?:plugin_action_proposals))/)
  })

  it('Copilot 族零反向依赖插件边界（单向复用无耦合环）', () => {
    expect(COPILOT_DECISION).not.toContain('plugin_action_boundary')
    expect(COPILOT_VALIDATOR).not.toContain('plugin_action_boundary')
  })

  it('插件执行路径无领域 Model 写依赖（adapter registry 宿主持有）', () => {
    // registry 拒绝非 host-core 归属
    expect(ADAPTER_REGISTRY).toContain("f.code === 'adapter-not-host-owned'")
    // 边界服务仅导入安装态/提案行/审计三类模型，不含任务/项目等领域模型
    const modelImports = [
      ...BOUNDARY_SERVICE.matchAll(/import\s+\w+\s+from\s+'#models\/([a-z_]+)'/g),
    ].map((m) => m[1])
    for (const model of modelImports) {
      expect(['audit_log', 'plugin_installation', 'plugin_action_proposal']).toContain(model)
    }
  })
})
