/**
 * v3-copilot-citations — §7 外部检索可观测性服务。
 *
 * 职责：
 * - 记录引用展示/激活/注入拦截指标（§7.2, §7.3）
 * - 仅存储域名，不存储完整 URL（§7.4 — query params 含搜索词）
 * - 组织级数据隔离（§7.8）
 * - 敏感数据泄露校验
 *
 * 纯逻辑服务，零 DB / 网络依赖。当前为内存存储，
 * 生产环境需接入持久化层。
 */
import type { CopilotExternalRetrievalObservabilityRecord } from '@aiproj/types'
import { generateObservabilityRecordId, validateObservabilityLowSensitivity } from '@aiproj/types'

export interface CitationActivationEvent {
  readonly organizationId: string
  readonly domain: string
  readonly citationId: string
}

export interface CitationPresentationEvent {
  readonly organizationId: string
  readonly domain: string
  readonly citationCount: number
}

export interface InjectionInterceptionEvent {
  readonly organizationId: string
  readonly domain: string
}

export class CopilotCitationObservabilityService {
  private records: CopilotExternalRetrievalObservabilityRecord[] = []

  /**
   * Record a citation presentation (§7.2).
   * Only stores domain, not full URL (§7.4).
   */
  recordPresentation(
    event: CitationPresentationEvent,
  ): CopilotExternalRetrievalObservabilityRecord {
    const now = new Date().toISOString()
    const record: CopilotExternalRetrievalObservabilityRecord = {
      recordId: generateObservabilityRecordId(event.domain, now),
      organizationId: event.organizationId,
      domain: event.domain,
      citationsPresented: event.citationCount,
      citationsActivated: 0,
      injectionInterceptions: 0,
      recordedAt: now,
    }
    this.records.push(record)
    return record
  }

  /**
   * Record a citation activation/click (§7.2).
   * Only stores domain, not full URL (query params may contain search terms).
   */
  recordActivation(event: CitationActivationEvent): void {
    // Find the most recent record for this domain + org, or create new
    const existing = this.records.find(
      (r) => r.organizationId === event.organizationId && r.domain === event.domain,
    )
    if (existing) {
      // Update in place (immutable update pattern)
      const idx = this.records.indexOf(existing)
      this.records[idx] = {
        ...existing,
        citationsActivated: existing.citationsActivated + 1,
      }
    } else {
      const now = new Date().toISOString()
      this.records.push({
        recordId: generateObservabilityRecordId(event.domain, now),
        organizationId: event.organizationId,
        domain: event.domain,
        citationsPresented: 0,
        citationsActivated: 1,
        injectionInterceptions: 0,
        recordedAt: now,
      })
    }
  }

  /**
   * Record an injection interception (§7.3).
   */
  recordInjectionInterception(event: InjectionInterceptionEvent): void {
    const existing = this.records.find(
      (r) => r.organizationId === event.organizationId && r.domain === event.domain,
    )
    if (existing) {
      const idx = this.records.indexOf(existing)
      this.records[idx] = {
        ...existing,
        injectionInterceptions: existing.injectionInterceptions + 1,
      }
    } else {
      const now = new Date().toISOString()
      this.records.push({
        recordId: generateObservabilityRecordId(event.domain, now),
        organizationId: event.organizationId,
        domain: event.domain,
        citationsPresented: 0,
        citationsActivated: 0,
        injectionInterceptions: 1,
        recordedAt: now,
      })
    }
  }

  /**
   * Get observability records for an organization (§7.8 - org isolation).
   */
  getRecordsForOrganization(
    organizationId: string,
  ): readonly CopilotExternalRetrievalObservabilityRecord[] {
    return this.records.filter((r) => r.organizationId === organizationId)
  }

  /**
   * Get domain distribution for an organization.
   */
  getDomainDistribution(
    organizationId: string,
  ): ReadonlyMap<string, { presented: number; activated: number; intercepted: number }> {
    const dist = new Map<string, { presented: number; activated: number; intercepted: number }>()
    for (const r of this.getRecordsForOrganization(organizationId)) {
      const existing = dist.get(r.domain) ?? { presented: 0, activated: 0, intercepted: 0 }
      dist.set(r.domain, {
        presented: existing.presented + r.citationsPresented,
        activated: existing.activated + r.citationsActivated,
        intercepted: existing.intercepted + r.injectionInterceptions,
      })
    }
    return dist
  }

  /**
   * Validate that a record is safe (no sensitive data leakage).
   */
  validateRecordSafety(record: Record<string, unknown>): {
    valid: boolean
    violations: string[]
  } {
    return validateObservabilityLowSensitivity(record)
  }
}
