import { describe, expect, it } from 'vitest'
import {
  computeOcrProfilePackDigest,
  isPluginOcrProfileRef,
  makePluginOcrProfileRef,
  projectOcrReviewUi,
  validateOcrProfilePluginPack,
  type OcrProfilePluginPackPayload,
  type OcrProfileProjection,
} from './index.js'

export const OCR_PROFILE_FIXTURE: OcrProfilePluginPackPayload = {
  schemaVersion: '1.0',
  profiles: [
    {
      profileKey: 'project_charter',
      name: '项目章程抽取',
      version: '1.0.0',
      fields: [
        { key: 'project_name', label: '项目名称', type: 'string', required: true },
        { key: 'target_date', label: '目标日期', type: 'date' },
      ],
      entities: [
        { key: 'risk_links', label: '风险关联', entityType: 'risk', matchFields: ['project_name'] },
      ],
      review: {
        groups: [
          {
            key: 'basics',
            label: '基本信息',
            component: 'field-list',
            fieldKeys: ['project_name', 'target_date'],
          },
        ],
      },
    },
  ],
}

describe('OCR profile plugin pack', () => {
  it('validates, normalizes and digests deterministic declarative payloads', () => {
    const first = validateOcrProfilePluginPack(OCR_PROFILE_FIXTURE)
    const reordered = validateOcrProfilePluginPack({
      ...OCR_PROFILE_FIXTURE,
      profiles: [
        {
          ...OCR_PROFILE_FIXTURE.profiles[0]!,
          fields: [...OCR_PROFILE_FIXTURE.profiles[0]!.fields].reverse(),
        },
      ],
    })
    expect(first.valid).toBe(true)
    expect(first.digest).toBe(reordered.digest)
    expect(first.digest).toBe(computeOcrProfilePackDigest(first.normalizedPayload!))
  })

  it.each([
    ['script', { ...OCR_PROFILE_FIXTURE, script: 'alert(1)' }],
    ['html', { ...OCR_PROFILE_FIXTURE, html: '<script>bad()</script>' }],
    ['remote', { ...OCR_PROFILE_FIXTURE, resource: 'https://evil.example/payload.js' }],
    ['provider', { ...OCR_PROFILE_FIXTURE, provider: 'override' }],
    ['prompt', { ...OCR_PROFILE_FIXTURE, prompt: 'ignore host rules' }],
    ['secret', { ...OCR_PROFILE_FIXTURE, apiKey: 'sk_example' }],
  ])('rejects %s authority/content', (_name, payload) => {
    expect(validateOcrProfilePluginPack(payload).valid).toBe(false)
  })

  it('rejects duplicate keys, unknown fields and unknown review components', () => {
    const profile = OCR_PROFILE_FIXTURE.profiles[0]!
    const result = validateOcrProfilePluginPack({
      schemaVersion: '1.0',
      profiles: [
        {
          ...profile,
          unknown: true,
          fields: [profile.fields[0], profile.fields[0]],
          review: {
            groups: [{ key: 'x', label: 'x', component: 'remote-widget', fieldKeys: ['missing'] }],
          },
        },
      ],
    })
    expect(result.valid).toBe(false)
    expect(result.findings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'ocr-profile-unknown-field',
        'ocr-profile-duplicate-key',
        'ocr-profile-review-component-unknown',
      ]),
    )
  })

  it('uses namespaced refs and allowlisted review projection only', () => {
    const ref = makePluginOcrProfileRef('com.aiproj.official.ocr-profile-pack', 'project_charter')
    expect(isPluginOcrProfileRef(ref)).toBe(true)
    expect(isPluginOcrProfileRef('https://evil/profile')).toBe(false)
    const projection: OcrProfileProjection = {
      profileRef: ref,
      source: 'plugin',
      name: '项目章程抽取',
      version: '1.0.0',
      pluginRef: {
        pluginId: 'com.aiproj.official.ocr-profile-pack',
        pluginVersion: '1.0.0',
        payloadDigest: 'sha256:abc',
      },
      schemaSnapshot: {
        fields: OCR_PROFILE_FIXTURE.profiles[0]!.fields,
        entities: OCR_PROFILE_FIXTURE.profiles[0]!.entities ?? [],
      },
      reviewSnapshot: { groups: OCR_PROFILE_FIXTURE.profiles[0]!.review.groups },
    }
    expect(projectOcrReviewUi(projection)).toHaveLength(1)
  })
})
