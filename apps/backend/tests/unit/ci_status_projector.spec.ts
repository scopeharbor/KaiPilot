import { test } from '@japa/runner'
import type { Group } from '@japa/runner/core'
import {
  projectGithubChecks,
  projectGithubStatus,
  projectGitlabPipeline,
  ciEventMatchesLink,
  projectWebhookCiEvent,
  type CiEventLocator,
  type CiProjectionContext,
  type WebhookCiEvent,
} from '#services/integrations/ci_status_projector'

/**
 * v2-5-code-repository-ci-status-display 任务 3.2 + 3.4 —— projector 脱敏与对象绑定/SSRF 加固。
 *
 * 证明：① 原始 provider payload 中的 token/Authorization/log/artifact/diff/仓库文件/私有评论/
 *   完整 payload 绝不进入投影后的 summary；② targetUrl 仅接受 provider host 的 https URL 并剥离
 *   query/fragment；③ CI 事件必须绑定已存链接 locator（provider/repo/number），任意跨对象不匹配。
 */

const GH_CTX: CiProjectionContext = {
  source: 'github_checks',
  allowedHost: 'github.com',
  observedAt: '2026-07-23T10:00:00.000Z',
}

// summary 的完整白名单键集合（多一个键即视为泄露风险）
const ALLOWED_SUMMARY_KEYS = [
  'state',
  'conclusion',
  'label',
  'source',
  'targetUrl',
  'observedAt',
  'updatedAt',
  'reasonCode',
  'isStale',
].sort()

test.group('CI projector —— 脱敏（任务 3.2）', (group: Group) => {
  void group

  test('GitHub check-runs 脏 payload 不泄露 token/log/artifact/完整 payload', ({ assert }) => {
    const dirty = {
      _token: 'gho_topsecret_should_never_leak',
      _authorization: 'Bearer gho_secret_header',
      check_runs: [
        {
          status: 'completed',
          conclusion: 'success',
          name: 'build',
          html_url:
            'https://github.com/owner/repo/runs/123?check_suite_focus=true&access_token=LEAKED',
          details_url: 'https://github.com/owner/repo/runs/123/details',
          // 敏感字段：workflow log / artifact / app secret / 私有评论
          output: { title: 'internal', summary: 'sensitive log body', text: 'FULL_LOG_OUTPUT' },
          app: { client_id: 'x', client_secret: 'CLIENT_SECRET_LEAK' },
          artifacts_url: 'https://api.github.com/owner/repo/artifacts',
          pull_request: { diff_url: 'https://github.com/owner/repo/pull/1.diff' },
          private_comment: 'confidential reviewer note',
        },
      ],
    }

    const summary = projectGithubChecks(dirty, GH_CTX)
    assert.equal(summary.state, 'passed')
    assert.equal(summary.conclusion, 'success')

    // 白名单键集合精确，绝不多带敏感字段
    assert.deepEqual(Object.keys(summary).sort(), ALLOWED_SUMMARY_KEYS)

    // 序列化后不得包含任何敏感字符串（token/header/log/secret/diff/评论/artifacts/query 参数）
    const serialized = JSON.stringify(summary)
    for (const leak of [
      'gho_topsecret_should_never_leak',
      'Bearer',
      'gho_secret_header',
      'FULL_LOG_OUTPUT',
      'sensitive log body',
      'CLIENT_SECRET_LEAK',
      'artifacts',
      'diff_url',
      '.diff',
      'confidential reviewer note',
      'access_token',
      'LEAKED',
      'check_suite_focus',
    ]) {
      assert.notInclude(serialized, leak, `summary 不应包含敏感串: ${leak}`)
    }

    // targetUrl 只保留 origin+pathname，query（含 access_token）被剥离
    assert.equal(summary.targetUrl, 'https://github.com/owner/repo/runs/123')
  })

  test('GitHub combined status 脏 payload 只投影白名单', ({ assert }) => {
    const dirty = {
      state: 'failure',
      target_url: 'https://github.com/owner/repo/commit/abc?token=SECRET',
      // 敏感：完整 commit / statuses 内部字段
      commit: { sha: 'abc', message: 'internal commit message', author: { email: 'a@b.com' } },
      statuses: [{ context: 'ci', description: 'private', creator: { email: 'x@y.com' } }],
      _bearer: 'gho_leak',
    }
    const summary = projectGithubStatus(dirty, {
      ...GH_CTX,
      source: 'github_status',
    })
    assert.equal(summary.state, 'failed')
    assert.deepEqual(Object.keys(summary).sort(), ALLOWED_SUMMARY_KEYS)
    const serialized = JSON.stringify(summary)
    for (const leak of [
      'gho_leak',
      'a@b.com',
      'x@y.com',
      'internal commit message',
      'token=SECRET',
    ]) {
      assert.notInclude(serialized, leak)
    }
    assert.equal(summary.targetUrl, 'https://github.com/owner/repo/commit/abc')
  })

  test('GitLab pipeline 脏 payload 不泄露 user.email/yaml_errors/private_token', ({ assert }) => {
    const dirty = {
      status: 'failed',
      web_url: 'https://gitlab.com/group/proj/-/pipelines/9?private_token=GLPAT_LEAK',
      yaml_errors: 'jobs:build config contains SECRET_ENV',
      user: { email: 'dev@corp.com', name: 'Dev' },
      detailed_status: { details_path: '/private', private_token: 'glpat_leak' },
      before_sha: 'deadbeef',
    }
    const summary = projectGitlabPipeline(dirty, {
      source: 'gitlab_pipeline',
      allowedHost: 'gitlab.com',
      observedAt: GH_CTX.observedAt,
    })
    assert.equal(summary.state, 'failed')
    assert.deepEqual(Object.keys(summary).sort(), ALLOWED_SUMMARY_KEYS)
    const serialized = JSON.stringify(summary)
    for (const leak of [
      'GLPAT_LEAK',
      'glpat_leak',
      'dev@corp.com',
      'SECRET_ENV',
      'yaml_errors',
      'deadbeef',
    ]) {
      assert.notInclude(serialized, leak)
    }
    assert.equal(summary.targetUrl, 'https://gitlab.com/group/proj/-/pipelines/9')
  })
})

test.group('CI projector —— targetUrl SSRF 加固（任务 3.4）', (group: Group) => {
  void group

  function checkUrl(htmlUrl: string): string | null {
    const summary = projectGithubChecks(
      {
        check_runs: [{ status: 'completed', conclusion: 'success', name: 'x', html_url: htmlUrl }],
      },
      GH_CTX,
    )
    return summary.targetUrl
  }

  test('拒绝跨 host 的任意 CI URL（attacker 域）', ({ assert }) => {
    assert.isNull(checkUrl('https://evil.example.com/owner/repo/runs/1'))
  })

  test('拒绝非 https（http/ftp/file/javascript）', ({ assert }) => {
    assert.isNull(checkUrl('http://github.com/owner/repo/runs/1'))
    assert.isNull(checkUrl('ftp://github.com/x'))
    assert.isNull(checkUrl('file:///etc/passwd'))
    assert.isNull(checkUrl('javascript:alert(1)'))
  })

  test('拒绝 host 混淆（子域/用户名注入/端口）', ({ assert }) => {
    assert.isNull(checkUrl('https://github.com.evil.com/x'))
    assert.isNull(checkUrl('https://github.com@evil.com/x'))
    // 正确 host 但带端口 → hostname 严格等于 github.com 才通过（带端口 hostname 仍是 github.com）
    // 这里验证内网地址不被接受
    assert.isNull(checkUrl('https://127.0.0.1/x'))
    assert.isNull(checkUrl('https://169.254.169.254/latest/meta-data'))
  })

  test('接受合法 https 同 host 并剥离 query/fragment', ({ assert }) => {
    assert.equal(
      checkUrl('https://github.com/owner/repo/runs/1?workflow_run_id=999&token=abc#step:2'),
      'https://github.com/owner/repo/runs/1',
    )
  })

  test('畸形 URL 返回 null 不抛错', ({ assert }) => {
    assert.isNull(checkUrl('not a url'))
    assert.isNull(checkUrl(''))
  })
})

test.group('CI 事件对象绑定（任务 3.4）', (group: Group) => {
  void group

  const link: CiEventLocator = {
    provider: 'github',
    repositoryOwner: 'acme',
    repositoryName: 'web',
    externalNumber: 7,
    linkType: 'pull_request',
  }

  function evt(overrides: Partial<WebhookCiEvent> = {}): WebhookCiEvent {
    return {
      provider: 'github',
      eventType: 'check_suite',
      repositoryFullName: 'acme/web',
      externalNumber: 7,
      status: 'completed',
      conclusion: 'success',
      name: 'CI',
      targetUrl: 'https://github.com/acme/web/runs/1',
      observedAt: '2026-07-23T10:00:00.000Z',
      ...overrides,
    }
  }

  test('完整匹配 → true', ({ assert }) => {
    assert.isTrue(ciEventMatchesLink(evt(), link))
  })

  test('provider 不匹配 → false', ({ assert }) => {
    assert.isFalse(ciEventMatchesLink(evt({ provider: 'gitlab' }), link))
  })

  test('跨仓库 / 仓库 path 注入 → false', ({ assert }) => {
    assert.isFalse(ciEventMatchesLink(evt({ repositoryFullName: 'other/web' }), link))
    assert.isFalse(ciEventMatchesLink(evt({ repositoryFullName: 'acme/other' }), link))
    assert.isFalse(ciEventMatchesLink(evt({ repositoryFullName: 'acme/web/../../etc' }), link))
    assert.isFalse(ciEventMatchesLink(evt({ repositoryFullName: 'acme/web/extra' }), link))
  })

  test('缺失编号（无法安全绑定）→ false', ({ assert }) => {
    assert.isFalse(ciEventMatchesLink(evt({ externalNumber: undefined }), link))
  })

  test('跨对象编号（不同 PR/MR）→ false', ({ assert }) => {
    assert.isFalse(ciEventMatchesLink(evt({ externalNumber: 999 }), link))
  })

  test('projectWebhookCiEvent 对不匹配事件返回 matched:false 且 summary:null', ({ assert }) => {
    const r = projectWebhookCiEvent(evt({ externalNumber: 999 }), link, 'github.com')
    assert.isFalse(r.matched)
    assert.isNull(r.summary)
  })

  test('projectWebhookCiEvent 匹配事件产出脱敏 summary（跨 host targetUrl 被拒）', ({ assert }) => {
    const r = projectWebhookCiEvent(
      evt({ targetUrl: 'https://evil.com/acme/web/runs/1' }),
      link,
      'github.com',
    )
    assert.isTrue(r.matched)
    assert.equal(r.summary?.state, 'passed')
    assert.isNull(r.summary?.targetUrl) // 跨 host 被剥离
    assert.deepEqual(Object.keys(r.summary as object).sort(), ALLOWED_SUMMARY_KEYS)
  })
})
