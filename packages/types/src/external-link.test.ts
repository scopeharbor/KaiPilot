import { describe, expect, test } from 'vitest'
import {
  EXTERNAL_LINK_PROVIDERS,
  EXTERNAL_LINK_TYPES,
  EXTERNAL_LINK_STATUSES,
  EXTERNAL_LINK_STATUS_ORDER,
  EXTERNAL_LINK_STATUS_SOURCES,
  EXTERNAL_LINK_REFRESH_RESULTS,
  isValidExternalLinkProvider,
  isValidExternalLinkType,
  isValidExternalLinkStatus,
  isValidExternalLinkStatusSource,
  isValidExternalLinkRefreshResult,
} from './external-link.js'

describe('v2-github-gitlab-light-links shared types', () => {
  test('EXTERNAL_LINK_PROVIDERS covers GitHub and GitLab', () => {
    expect(EXTERNAL_LINK_PROVIDERS).toEqual(['github', 'gitlab'])
  })

  test('EXTERNAL_LINK_TYPES covers issue, pull_request, merge_request', () => {
    expect(EXTERNAL_LINK_TYPES).toEqual(['issue', 'pull_request', 'merge_request'])
  })

  test('EXTERNAL_LINK_STATUSES covers all mapped statuses', () => {
    expect(EXTERNAL_LINK_STATUSES).toEqual([
      'open',
      'closed',
      'merged',
      'locked',
      'draft',
      'unknown',
    ])
  })

  test('EXTERNAL_LINK_STATUS_ORDER has correct ordering', () => {
    expect(EXTERNAL_LINK_STATUS_ORDER.open).toBe(0)
    expect(EXTERNAL_LINK_STATUS_ORDER.draft).toBe(1)
    expect(EXTERNAL_LINK_STATUS_ORDER.merged).toBe(2)
    expect(EXTERNAL_LINK_STATUS_ORDER.locked).toBe(3)
    expect(EXTERNAL_LINK_STATUS_ORDER.closed).toBe(4)
    expect(EXTERNAL_LINK_STATUS_ORDER.unknown).toBe(99)
  })

  test('EXTERNAL_LINK_STATUS_SOURCES covers all source types', () => {
    expect(EXTERNAL_LINK_STATUS_SOURCES).toEqual([
      'manual',
      'pre_connection_only',
      'not_configured',
      'refresh_success',
      'refresh_degraded',
      'readonly_connection_ready',
      'github_readonly',
      'gitlab_readonly',
      'connection_required',
      'reauthorization_required',
      'not_found',
      'forbidden',
      'rate_limited',
      'temporarily_unavailable',
      'unsupported_link',
    ])
  })

  test('EXTERNAL_LINK_REFRESH_RESULTS covers all result types', () => {
    expect(EXTERNAL_LINK_REFRESH_RESULTS).toEqual([
      'not_configured',
      'pre_connection_only',
      'success',
      'degraded',
      'readonly_connection_ready',
      'connection_required',
      'reauthorization_required',
      'not_found',
      'forbidden',
      'rate_limited',
      'temporarily_unavailable',
      'unsupported_link',
    ])
  })

  test('isValidExternalLinkProvider validates correctly', () => {
    expect(isValidExternalLinkProvider('github')).toBe(true)
    expect(isValidExternalLinkProvider('gitlab')).toBe(true)
    expect(isValidExternalLinkProvider('bitbucket')).toBe(false)
    expect(isValidExternalLinkProvider('')).toBe(false)
  })

  test('isValidExternalLinkType validates correctly', () => {
    expect(isValidExternalLinkType('issue')).toBe(true)
    expect(isValidExternalLinkType('pull_request')).toBe(true)
    expect(isValidExternalLinkType('merge_request')).toBe(true)
    expect(isValidExternalLinkType('pr')).toBe(false)
  })

  test('isValidExternalLinkStatus validates correctly', () => {
    expect(isValidExternalLinkStatus('open')).toBe(true)
    expect(isValidExternalLinkStatus('closed')).toBe(true)
    expect(isValidExternalLinkStatus('merged')).toBe(true)
    expect(isValidExternalLinkStatus('locked')).toBe(true)
    expect(isValidExternalLinkStatus('draft')).toBe(true)
    expect(isValidExternalLinkStatus('unknown')).toBe(true)
    expect(isValidExternalLinkStatus('in_progress')).toBe(false)
  })

  test('isValidExternalLinkStatusSource validates correctly', () => {
    expect(isValidExternalLinkStatusSource('manual')).toBe(true)
    expect(isValidExternalLinkStatusSource('refresh_success')).toBe(true)
    expect(isValidExternalLinkStatusSource('not_configured')).toBe(true)
    expect(isValidExternalLinkStatusSource('auto_synced')).toBe(false)
  })

  test('isValidExternalLinkRefreshResult validates correctly', () => {
    expect(isValidExternalLinkRefreshResult('not_configured')).toBe(true)
    expect(isValidExternalLinkRefreshResult('pre_connection_only')).toBe(true)
    expect(isValidExternalLinkRefreshResult('success')).toBe(true)
    expect(isValidExternalLinkRefreshResult('degraded')).toBe(true)
    expect(isValidExternalLinkRefreshResult('failed')).toBe(false)
  })
})
