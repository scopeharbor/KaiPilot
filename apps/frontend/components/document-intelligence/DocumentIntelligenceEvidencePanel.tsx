'use client'

import type { DocumentIntelligenceSourceDetail } from '@aiproj/types'
import {
  DIMENSION_LABELS,
  DIMENSION_STATE_LABELS,
  REASON_LABELS,
} from './DocumentIntelligenceSourceList'

/**
 * 来源级「证据与治理」视图（v3-document-intelligence-workbench §4.9 / §4.10）。
 *
 * 红线：只渲染低敏投影——引用、计数、时间戳、reason code 与 profile provenance。
 * 全文、原始 provider payload、prompt、模型输出、secret/token、绝对路径一律不在契约内，
 * 因此也无从渲染；`null` 计数必须显示为「不可用」而非 0。
 */

const AUDIT_LABELS: Record<'available' | 'restricted' | 'unavailable', string> = {
  available: '可查看',
  restricted: '受限',
  unavailable: '不可用',
}

const PROVENANCE_LABELS: Record<'builtin' | 'enabled_plugin' | 'organization_owned', string> = {
  builtin: '内置',
  enabled_plugin: '已启用插件',
  organization_owned: '组织自有',
}

const PROFILE_STATUS_LABELS: Record<'active' | 'disabled' | 'invalid' | 'missing', string> = {
  active: '生效中',
  disabled: '已停用',
  invalid: '无效',
  missing: '未配置',
}

function CountValue({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-amber-700 dark:text-amber-300">不可用</span>
  ) : (
    <span>{value}</span>
  )
}

interface DocumentIntelligenceEvidencePanelProps {
  detail: DocumentIntelligenceSourceDetail
}

export function DocumentIntelligenceEvidencePanel({
  detail,
}: DocumentIntelligenceEvidencePanelProps) {
  const { evidence, governance, profileProvenance } = detail

  return (
    <div className="space-y-4 text-sm" data-testid="di-evidence-panel">
      <section aria-labelledby="di-evidence-heading">
        <h3
          id="di-evidence-heading"
          className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          证据摘要
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">作业数</dt>
            <dd data-testid="di-evidence-jobCount">
              <CountValue value={evidence.jobCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">已接受提取数</dt>
            <dd data-testid="di-evidence-extractionCount">
              <CountValue value={evidence.extractionCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Provider 摘要</dt>
            <dd data-testid="di-evidence-provider">{evidence.providerSummary ?? '不可用'}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">成本摘要</dt>
            <dd>{evidence.costSummaryPresent ? '已记录' : '无'}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">来源哈希前缀</dt>
            <dd data-testid="di-evidence-hash">{evidence.sourceHashPrefix ?? '不可用'}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">最近活动</dt>
            <dd>{evidence.freshness.lastActivityAt ?? '不可用'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="di-downstream-heading">
        <h3
          id="di-downstream-heading"
          className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          下游产物
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">搜索索引状态</dt>
            <dd data-testid="di-downstream-index">
              {evidence.downstream.searchIndexStatus ?? '暂无'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">结构化快照（当前）</dt>
            <dd data-testid="di-downstream-snapshot">
              <CountValue value={evidence.downstream.structuredSnapshotCurrentCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">结构化快照（历史）</dt>
            <dd>
              <CountValue value={evidence.downstream.structuredSnapshotSupersededCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">实体关联（有效）</dt>
            <dd data-testid="di-downstream-links">
              <CountValue value={evidence.downstream.entityLinkActiveCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">实体关联（已取代）</dt>
            <dd>
              <CountValue value={evidence.downstream.entityLinkSupersededCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">不可见目标</dt>
            <dd data-testid="di-downstream-hidden">
              <CountValue value={evidence.downstream.entityLinkHiddenTargetCount} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="di-governance-heading">
        <h3
          id="di-governance-heading"
          className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          治理状态
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">权限裁决</dt>
            <dd data-testid="di-gov-permission">
              {DIMENSION_STATE_LABELS[governance.permissionDecision]}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">隐私状态</dt>
            <dd data-testid="di-gov-privacy">{DIMENSION_STATE_LABELS[governance.privacyStatus]}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">保留冻结</dt>
            <dd data-testid="di-gov-hold">
              {governance.retentionHoldActive === null
                ? '不可用'
                : governance.retentionHoldActive
                  ? '进行中'
                  : '无'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">过期/待清除记录</dt>
            <dd>
              <CountValue value={governance.retentionExpiredCount} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">审计明细</dt>
            <dd data-testid="di-gov-audit">{AUDIT_LABELS[governance.auditAccess]}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">原因</dt>
            <dd data-testid="di-gov-reason">{REASON_LABELS[governance.reasonCode]}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="di-profile-heading">
        <h3
          id="di-profile-heading"
          className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          Profile 溯源
        </h3>
        {profileProvenance ? (
          <dl
            className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3"
            data-testid="di-profile-provenance"
          >
            <div>
              <dt className="text-gray-500 dark:text-gray-400">标识</dt>
              <dd>{profileProvenance.identity}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">版本</dt>
              <dd>{profileProvenance.version}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">来源</dt>
              <dd data-testid="di-profile-kind">
                {PROVENANCE_LABELS[profileProvenance.provenanceKind]}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">状态</dt>
              <dd data-testid="di-profile-status">
                {PROFILE_STATUS_LABELS[profileProvenance.status]}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">凭据引用</dt>
              <dd>{profileProvenance.receiptRef ?? '无'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">未解析到 profile 溯源信息。</p>
        )}
      </section>

      <section aria-labelledby="di-dimensions-heading">
        <h3
          id="di-dimensions-heading"
          className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          维度状态
        </h3>
        <ul className="flex flex-wrap gap-1.5 text-[11px]">
          {Object.entries(detail.dimensionStates).map(([dim, state]) => (
            <li
              key={dim}
              data-testid={`di-detail-dim-${dim}`}
              data-state={state}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              {DIMENSION_LABELS[dim as keyof typeof DIMENSION_LABELS]}·
              {DIMENSION_STATE_LABELS[state as keyof typeof DIMENSION_STATE_LABELS]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default DocumentIntelligenceEvidencePanel
