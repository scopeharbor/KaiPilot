import type { QueryClientContract } from '@adonisjs/lucid/types/database'

type CleanupClient = ReturnType<QueryClientContract['getWriteClient']>

/** 子表先删，保留连接、模型/价格/Prompt/实验设置及正式业务数据。 */
export const AI_RECORD_TABLES = [
  'copilot_memory_entries',
  'copilot_messages',
  'copilot_session_retention_tombstones',
  'copilot_session_retention_deletion_records',
  'copilot_session_retention_cleanup_runs',
  'copilot_suggestion_inbox',
  'copilot_context_observations',
  'copilot_routing_decisions',
  'copilot_sessions',
  'ai_project_draft_validations',
  'ai_project_draft_confirmations',
  'ai_project_draft_events',
  'ai_project_draft_versions',
  'ai_project_drafts',
  'ai_draft_layer_apply_results',
  'ai_draft_layer_previews',
  'ai_draft_layer_changes',
  'ai_draft_layer_sessions',
  'triz_assistant_feedback',
  'triz_copilot_analyses',
  'pmo_ai_priority_recommendations',
  'ai_analysis_jobs',
  'unified_ai_feedback_events',
  'ai_trace_spans',
  'ai_model_usage_snapshots',
  'ai_offline_regression_runs',
  'ai_shadow_runs',
  'unified_ai_invocation_ledger',
] as const

/** 默认仅盘点；apply 在单一事务中删除，失败全部回滚，不输出任何记录正文。 */
export async function cleanupAiRecords(client: CleanupClient, apply = false) {
  return client.transaction(async (trx) => {
    const report: Array<{ table: string; count: number }> = []
    for (const table of AI_RECORD_TABLES) {
      if (!(await trx.schema.hasTable(table))) continue
      const row = await trx(table).count('* as total').first()
      report.push({ table, count: Number(row?.total ?? 0) })
    }
    if (apply) {
      if (!(await trx.schema.hasTable('audit_logs')))
        throw new Error('缺少审计表，拒绝清除 AI 记录')
      for (const { table } of report) await trx(table).delete()
      await trx('audit_logs').insert({
        action: 'delete',
        entity_type: 'ai_records',
        severity: 'critical',
        metadata: JSON.stringify({ source: 'maintenance-cli', tables: report }),
        created_at: trx.fn.now(),
      })
    }
    return {
      applied: apply,
      total: report.reduce((sum, row) => sum + row.count, 0),
      tables: report,
    }
  })
}
