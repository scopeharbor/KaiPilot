import { describe, expect, test } from 'vitest'
import type { AiModelCatalogModelDto } from '@aiproj/types'
import {
  buildPrefillPrompt,
  classifyCandidate,
  normalizeEndpoint,
  parsePrefillSelection,
  pickDeterministicCandidate,
  PREFILL_MAX_CANDIDATES,
  type PricingCandidate,
} from '#services/ai_pricing/model_pricing_prefill_service'

/**
 * 定价自动预填纯逻辑单测（无 DB、无网络）。
 *
 * 三条要守住的边界：
 * 1. 「近似」必须能被识别——端点没命中就不算该中转的真实挂牌价；
 * 2. 模型输出不可解析时**不得猜测**，一律返回 null 交给确定性回退；
 * 3. 回退结果必须可复现（同一输入同一选择）。
 */

function catalogModel(overrides: Partial<AiModelCatalogModelDto> = {}): AiModelCatalogModelDto {
  return {
    id: 'vendor-x/vendor-x-model-1',
    name: 'Vendor X Model 1',
    providerId: 'relay-b',
    providerName: 'NanoGPT',
    providerApi: 'https://api.relay-b.example/v1',
    providerDocsUrl: null,
    providerEnvKeys: [],
    providerLogoUrl: '',
    npmPackage: null,
    protocol: 'openai_compatible',
    supportLevel: 'native',
    baseUrl: 'https://api.relay-b.example/v1',
    baseUrlNeedsManualEdit: false,
    family: null,
    description: null,
    modalities: { input: ['text'], output: ['text'] },
    capabilities: ['chat'],
    limit: { context: null, input: null, output: null },
    cost: {
      input: 0.13,
      output: 0.52,
      cacheRead: 0.006,
      cacheWrite: null,
      inputAudio: null,
      outputAudio: null,
      reasoning: null,
      contextOver200k: null,
      tiers: null,
    },
    knowledgeCutoff: null,
    releaseDate: null,
    lastUpdated: null,
    status: null,
    attachment: null,
    reasoning: null,
    reasoningOptions: null,
    toolCall: null,
    structuredOutput: null,
    temperature: null,
    openWeights: null,
    weights: null,
    benchmarks: null,
    license: null,
    links: null,
    experimentalModes: null,
    providerOverride: null,
    pricingSnapshotId: null,
    rawModel: null,
    ...overrides,
  } as AiModelCatalogModelDto
}

describe('pricing prefill · normalizeEndpoint', () => {
  test('忽略协议与尾斜杠差异，只比主机 + 路径', () => {
    expect(normalizeEndpoint('https://api.relay-a.example/v1/')).toBe('api.relay-a.example/v1')
    expect(normalizeEndpoint('http://API.Relay-A.example/v1')).toBe('api.relay-a.example/v1')
    expect(normalizeEndpoint(null)).toBe('')
    expect(normalizeEndpoint('api.relay-a.example/v1')).toBe('api.relay-a.example/v1')
  })
})

describe('pricing prefill · classifyCandidate', () => {
  test('端点与模型名双命中，且模型 id 以供应商 id 开头 → 三项都为真', () => {
    const candidate = classifyCandidate(
      catalogModel({
        id: 'relay-a/vendor-x-model-1',
        providerId: 'relay-a',
        providerName: 'Relay A',
        baseUrl: 'https://api.relay-a.example/v1',
      }),
      { modelName: 'relay-a/vendor-x-model-1', baseUrl: 'https://api.relay-a.example/v1' },
    )
    expect(candidate.endpointMatched).toBe(true)
    expect(candidate.nameMatched).toBe(true)
    // 「自有条目」是纯字符串判定：id 以 providerId 开头即成立，与是哪家厂商无关
    expect(candidate.providerBranded).toBe(true)
  })

  test('第三方端点 + 同名但非自有条目 → 端点不命中、名字命中、自有条目为假', () => {
    const candidate = classifyCandidate(
      catalogModel({
        id: 'vendor-x-model-1',
        providerId: 'vendor-x',
        providerName: 'Vendor X',
        baseUrl: 'https://api.vendor-x.example/v1',
      }),
      { modelName: 'vendor-x-model-1', baseUrl: 'https://api.relay-b.example/provider/v1' },
    )
    expect(candidate.endpointMatched).toBe(false)
    expect(candidate.nameMatched).toBe(true)
    // id 以 providerId 开头（vendor-x-model-1 ← vendor-x）→ 仍是该供应商自有条目
    expect(candidate.providerBranded).toBe(true)
  })

  test('中转转售别人的模型时不算自有条目（id 前缀 ≠ providerId）', () => {
    const candidate = classifyCandidate(
      catalogModel({
        id: 'vendor-x/vendor-x-model-1',
        providerId: 'relay-c',
        providerName: 'Relay C',
        baseUrl: 'https://api.relay-c.example/v1',
      }),
      { modelName: 'vendor-x/vendor-x-model-1', baseUrl: 'https://api.relay-d.example/v1' },
    )
    expect(candidate.nameMatched).toBe(true)
    expect(candidate.endpointMatched).toBe(false)
    expect(candidate.providerBranded).toBe(false)
  })

  test('中转带自己的前缀时按末段识别同名', () => {
    const candidate = classifyCandidate(
      catalogModel({
        id: 'relay-e/vendor-x/vendor-x-model-1',
        providerId: 'relay-e',
        baseUrl: 'https://api.relay-e.example/v1',
      }),
      { modelName: 'vendor-x/vendor-x-model-1', baseUrl: 'https://api.relay-f.example/v1' },
    )
    expect(candidate.nameMatched).toBe(true)
    expect(candidate.endpointMatched).toBe(false)
    expect(candidate.providerBranded).toBe(true)
  })

  test('短模型名只允许精确匹配，o3/r1 不再被长度门槛漏掉', () => {
    expect(
      classifyCandidate(catalogModel({ id: 'openai/o3', name: 'o3' }), {
        modelName: 'relay/openai/o3',
        baseUrl: null,
      }).nameMatched,
    ).toBe(true)
    expect(
      classifyCandidate(catalogModel({ id: 'vendor/r10', name: 'r10' }), {
        modelName: 'r1',
        baseUrl: null,
      }).nameMatched,
    ).toBe(false)
  })
})

describe('pricing prefill · pickDeterministicCandidate', () => {
  const base: PricingCandidate = {
    providerId: 'p',
    providerName: 'P',
    modelId: 'm',
    api: null,
    cost: null as never,
    endpointMatched: false,
    nameMatched: false,
    providerBranded: false,
  }

  test('端点+名字双命中优先于供应商自有条目', () => {
    const picked = pickDeterministicCandidate([
      { ...base, providerId: 'vendor-x', providerBranded: true, nameMatched: true },
      { ...base, providerId: 'relay-a', endpointMatched: true, nameMatched: true },
    ])
    expect(picked?.providerId).toBe('relay-a')
  })

  test('没有双命中时自有条目优先于别家转售', () => {
    const picked = pickDeterministicCandidate([
      { ...base, providerId: 'relay-b', nameMatched: true },
      { ...base, providerId: 'vendor-x', nameMatched: true, providerBranded: true },
    ])
    expect(picked?.providerId).toBe('vendor-x')
  })

  test('空候选返回 null，且结果可复现', () => {
    expect(pickDeterministicCandidate([])).toBeNull()
    const candidates = [
      { ...base, providerId: 'b', nameMatched: true },
      { ...base, providerId: 'a', nameMatched: true },
    ]
    expect(pickDeterministicCandidate(candidates)?.providerId).toBe(
      pickDeterministicCandidate(candidates)?.providerId,
    )
  })
})

describe('pricing prefill · parsePrefillSelection', () => {
  const candidates: PricingCandidate[] = Array.from({ length: 3 }, (_, index) => ({
    providerId: `p${index}`,
    providerName: `P${index}`,
    modelId: `m${index}`,
    api: null,
    cost: null as never,
    endpointMatched: false,
    nameMatched: true,
    providerBranded: false,
  }))

  test('标准 JSON 选择', () => {
    const parsed = parsePrefillSelection('{"index": 2, "reason": "端点同域"}', candidates)
    expect(parsed).toEqual({ index: 2, reason: '端点同域' })
  })

  test('带代码围栏与前后废话也能解析', () => {
    const parsed = parsePrefillSelection(
      '好的：\n```json\n{"index":1,"reason":"自有条目"}\n```',
      candidates,
    )
    expect(parsed?.index).toBe(1)
  })

  test('接受 providerId + modelId 形态', () => {
    const parsed = parsePrefillSelection('{"providerId":"p2","modelId":"m2"}', candidates)
    expect(parsed?.index).toBe(2)
  })

  test('裸序号可用', () => {
    expect(parsePrefillSelection('2', candidates)?.index).toBe(2)
  })

  test('越界/垃圾输出返回 null，绝不猜', () => {
    expect(parsePrefillSelection('{"index": 9}', candidates)).toBeNull()
    expect(parsePrefillSelection('我觉得第二家比较合适', candidates)).toBeNull()
    expect(parsePrefillSelection('', candidates)).toBeNull()
    expect(parsePrefillSelection('{"index":1}', [])).toBeNull()
  })
})

describe('pricing prefill · buildPrefillPrompt', () => {
  test('候选带端点、单价与命中标记，并要求只回 JSON', () => {
    const prompt = buildPrefillPrompt(
      [
        {
          providerId: 'relay-a',
          providerName: 'Relay A',
          modelId: 'relay-a/vendor-x-model-1',
          api: 'https://api.relay-a.example/v1',
          cost: {
            input: 0.15,
            output: 0.6,
            cacheRead: 0.003,
            cacheWrite: null,
            inputAudio: null,
            outputAudio: null,
            reasoning: null,
            contextOver200k: null,
            tiers: null,
          },
          endpointMatched: true,
          nameMatched: true,
          providerBranded: true,
        },
      ],
      'relay-a/vendor-x-model-1',
    )
    expect(prompt.userPrompt).toContain('relay-a/vendor-x-model-1')
    expect(prompt.userPrompt).toContain('输入 0.15')
    expect(prompt.userPrompt).toContain('端点命中')
    expect(prompt.userPrompt).toContain('自有条目')
    expect(prompt.systemPrompt).toContain('"index"')
    // 候选上限是送给模型的硬约束
    expect(PREFILL_MAX_CANDIDATES).toBeLessThanOrEqual(12)
  })
})
