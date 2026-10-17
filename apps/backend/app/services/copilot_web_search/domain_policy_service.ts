/**
 * v3-copilot-web-search-tool §4 — 域名策略服务。
 *
 * 设计纪律 D2：域名白名单是准入制而非黑名单排除制。
 * 黑名单意味着"没列出的都可以抓"，在开放互联网上不可维护。
 *
 * 职责：
 * - 白名单准入制：不在白名单内一律不抓
 * - 黑名单在白名单之上再排除
 * - 后缀通配匹配（*.gov.cn），不支持任意正则
 * - 被拒域名计数可见，但不暴露被拒的具体 URL 全文
 * - 组织隔离：域名策略附加 organization_id
 */

import type { DomainPolicy, DomainPolicyEntry, RetrievalRejectionReason } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 域名策略服务输入/输出
// ---------------------------------------------------------------------------

/** 域名判定输入。 */
export interface DomainPolicyCheckInput {
  /** 目标 URL 的域名 */
  domain: string
  /** 组织 ID */
  organizationId: number
}

/** 域名判定结果。 */
export interface DomainPolicyCheckResult {
  /** 是否允许抓取 */
  allowed: boolean
  /** 拒绝原因（仅 allowed=false 时有值） */
  rejectionReason: RetrievalRejectionReason | null
  /** 匹配的白名单条目（仅 allowed=true 时有值） */
  matchedEntry: DomainPolicyEntry | null
}

// ---------------------------------------------------------------------------
// 域名策略服务
// ---------------------------------------------------------------------------

/**
 * 域名策略服务。
 *
 * 实现白名单准入制 + 黑名单排除 + 后缀通配。
 * 不支持任意正则（避免配置出错即放行全网）。
 */
export class DomainPolicyService {
  /**
   * 判定域名是否允许抓取。
   *
   * @param input 判定输入
   * @param policy 组织级域名策略
   * @returns 判定结果
   */
  check(input: DomainPolicyCheckInput, policy: DomainPolicy): DomainPolicyCheckResult {
    const { domain } = input

    // 1. 先检查黑名单（黑名单在白名单之上再排除）
    for (const entry of policy.denylist) {
      if (this.matchDomain(domain, entry)) {
        return {
          allowed: false,
          rejectionReason: 'domain_in_denylist',
          matchedEntry: null,
        }
      }
    }

    // 2. 白名单留空 = 不限制域名（黑名单仍生效）。组织设置页即按此语义说明；
    //    否则默认空白名单下任何网页都不会被采用，开了网页搜索也永远没有结果。
    if (policy.allowlist.length === 0) {
      return { allowed: true, rejectionReason: null, matchedEntry: null }
    }

    // 3. 检查白名单（设置了白名单即准入制：不在白名单内一律不抓）
    for (const entry of policy.allowlist) {
      if (this.matchDomain(domain, entry)) {
        return {
          allowed: true,
          rejectionReason: null,
          matchedEntry: entry,
        }
      }
    }

    // 3. 不在白名单内
    return {
      allowed: false,
      rejectionReason: 'domain_not_in_allowlist',
      matchedEntry: null,
    }
  }

  /**
   * 批量判定域名列表。
   *
   * @param domains 域名列表
   * @param policy 组织级域名策略
   * @returns 每个域名的判定结果
   */
  checkBatch(
    domains: string[],
    organizationId: number,
    policy: DomainPolicy,
  ): DomainPolicyCheckResult[] {
    return domains.map((domain) => this.check({ domain, organizationId }, policy))
  }

  /**
   * 匹配域名与策略条目。
   *
   * 支持两种匹配模式：
   * - exact：精确匹配（如 "example.com"）
   * - suffix_wildcard：后缀通配匹配（如 "*.gov.cn" 匹配 "www.gov.cn"）
   *
   * 不支持任意正则（配置中若出现正则式应被拒绝）。
   */
  private matchDomain(domain: string, entry: DomainPolicyEntry): boolean {
    switch (entry.type) {
      case 'exact':
        return domain === entry.pattern

      case 'suffix_wildcard': {
        // "*.gov.cn" → 匹配 "www.gov.cn"、"sub.gov.cn"，不匹配 "gov.cn"
        const suffix = entry.pattern.replace(/^\*\./, '')
        return domain.endsWith('.' + suffix)
      }

      default:
        // 不支持的类型，拒绝匹配
        return false
    }
  }

  /**
   * 验证策略条目是否包含非法正则。
   *
   * 正则式配置被拒绝（避免配置出错即放行全网）。
   */
  static validateEntry(entry: DomainPolicyEntry): { valid: boolean; reason?: string } {
    // 后缀通配只允许 "*.domain.tld" 格式
    if (entry.type === 'suffix_wildcard') {
      if (!entry.pattern.startsWith('*.')) {
        return { valid: false, reason: '后缀通配必须以 "*." 开头' }
      }
      const suffix = entry.pattern.slice(2)
      if (
        suffix.includes('*') ||
        suffix.includes('^') ||
        suffix.includes('$') ||
        suffix.includes('\\')
      ) {
        return { valid: false, reason: '后缀通配不支持任意正则字符' }
      }
      // 检查是否包含正则特殊字符
      const regexChars = /[()[\]{}|+?]/
      if (regexChars.test(suffix)) {
        return { valid: false, reason: '后缀通配不支持正则特殊字符' }
      }
    }

    // 精确匹配不允许通配符
    if (entry.type === 'exact') {
      if (
        entry.pattern.includes('*') ||
        entry.pattern.includes('^') ||
        entry.pattern.includes('$')
      ) {
        return { valid: false, reason: '精确匹配不允许通配符或正则字符' }
      }
    }

    return { valid: true }
  }
}
