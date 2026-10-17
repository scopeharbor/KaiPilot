/**
 * v3-plugin-action-preview-boundary —— pilot fixture domain adapter（design.md 首个试点）。
 *
 * action kind = plugin.pilot.item.create：向专用低风险 fixture 表 plugin_pilot_items
 * 追加一条记录。目标 revision = 该组织当前 pilot 条目数（追加即变化），
 * 使「确认前目标被并发修改 → stale 阻断」具备真实语义。
 *
 * 红线：
 * - apply 只在宿主传入的事务内写本表，绝不自行建事务、不触碰其他正式表；
 * - preview/revalidate 零写入。
 */
import type { PluginActionKind } from '@aiproj/types'
import {
  pluginActionAdapterRegistry,
  type PluginActionAdapterContext,
  type PluginActionApplyContext,
  type PluginActionHostAdapter,
  type PluginActionPreviewDraft,
} from './adapter_registry.js'

async function countPilotItems(
  organizationId: number,
  trx?: import('@adonisjs/lucid/types/database').TransactionClientContract,
): Promise<number> {
  const { default: dbModule } = await import('@adonisjs/lucid/services/db')
  const db = trx ?? dbModule
  const row = await db
    .from('plugin_pilot_items')
    .where('organization_id', organizationId)
    .count('* as total')
  return Number(row[0]?.total ?? 0)
}

function revisionOf(count: number, organizationId: number): string {
  return `pilot-items@org${organizationId}-n${count}`
}

export const pilotItemCreateAdapter: PluginActionHostAdapter = {
  descriptor: {
    actionKind: 'plugin.pilot.item.create' as PluginActionKind,
    owner: 'host-core',
    batchPolicy: 'per-item',
    reversibility: 'reversible',
    requiredPermissions: ['plugin_action:confirm'],
  },

  async preview(ctx: PluginActionAdapterContext): Promise<PluginActionPreviewDraft> {
    const title = typeof ctx.inputPayload.title === 'string' ? ctx.inputPayload.title : ''
    const content = typeof ctx.inputPayload.content === 'string' ? ctx.inputPayload.content : ''
    const count = await countPilotItems(ctx.organizationId, ctx.trx)
    return {
      diffEntries: [
        { targetRef: 'plugin_pilot_item:new', field: 'title', before: null, after: title },
        { targetRef: 'plugin_pilot_item:new', field: 'content', before: null, after: content },
      ],
      assumptions: ['标题与内容按提案原样创建到试点清单'],
      compatibilitySummary: null,
      dryRunFindings: [],
      reversibility: 'reversible',
      affectedItemRefs: [`plugin_pilot_item:org${ctx.organizationId}:next`],
      targetRevision: revisionOf(count, ctx.organizationId),
    }
  },

  async revalidate(
    ctx: PluginActionAdapterContext & { expectedRevision: string },
  ): Promise<{ fresh: boolean; currentRevision: string }> {
    const count = await countPilotItems(ctx.organizationId, ctx.trx)
    const current = revisionOf(count, ctx.organizationId)
    return { fresh: current === ctx.expectedRevision, currentRevision: current }
  },

  async apply(ctx: PluginActionApplyContext): Promise<{ writtenRefs: readonly string[] }> {
    const title = typeof ctx.inputPayload.title === 'string' ? ctx.inputPayload.title : ''
    const content = typeof ctx.inputPayload.content === 'string' ? ctx.inputPayload.content : ''
    const { DateTime } = await import('luxon')
    await ctx.trx.table('plugin_pilot_items').insert({
      organization_id: ctx.organizationId,
      project_id: ctx.projectId,
      title,
      content,
      source_proposal_uid: ctx.proposalUid,
      created_by: ctx.actorUserId,
      created_at: DateTime.now().toSQL(),
    })
    return { writtenRefs: [`plugin_pilot_item:${ctx.proposalUid}`] }
  },
}

/** 宿主启动时登记（幂等）。 */
export function registerPilotActionAdapter(): void {
  if (!pluginActionAdapterRegistry.has(pilotItemCreateAdapter.descriptor.actionKind)) {
    pluginActionAdapterRegistry.register(pilotItemCreateAdapter)
  }
}
