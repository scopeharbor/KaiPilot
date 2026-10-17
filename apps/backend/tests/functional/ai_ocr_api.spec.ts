import { test } from '@japa/runner'
import { AIGateway, type AdapterOcrPreviewResult } from '#services/ai_m0/gateway'
import AiConnectionModel from '#models/ai_connection_model'
import {
  STRONG_PASSWORD,
  createAiConnection,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'

const BASE = '/api/v1/ai/ocr/preview'
const IMAGE = 'data:image/png;base64,SGVsbG8='

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

function stubOcrPreview(result: AdapterOcrPreviewResult) {
  const original = AIGateway.prototype.ocrPreview
  AIGateway.prototype.ocrPreview = async () => result
  return () => {
    AIGateway.prototype.ocrPreview = original
  }
}

test.group('AiOcrController API', (group) => {
  useAiDatabase(group)

  test('requires authentication', async ({ client }) => {
    const res = await client.post(BASE).json({} as any)
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('returns OCR preview candidate for an OCR-capable model', async ({ client, assert }) => {
    const { conn, org, user } = await createAiConnection({ model: 'PaddlePaddle/PaddleOCR-VL-1.5' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    model.capabilities = ['ocr', 'vision']
    await model.save()
    const token = await login(client, user.email)
    const restore = stubOcrPreview({
      ok: true,
      extractedText: '开项 OCR 测试 123',
      usage: { inputTokens: 226, outputTokens: 11, totalTokens: 237 },
    })

    try {
      const res = await client
        .post(BASE)
        .bearerToken(token)
        .json({
          connectionId: conn.id,
          modelId: model.id,
          image: { dataUrl: IMAGE },
        })
      res.assertStatus(200)
      const data = res.body().data
      assert.equal(data.status, 'succeeded')
      assert.equal(data.extractedText, '开项 OCR 测试 123')
      assert.equal(data.provider.model, 'PaddlePaddle/PaddleOCR-VL-1.5')
      assert.equal(data.provider.usage?.totalTokens, 237)
      assert.equal(Number(org.id), Number(conn.organizationId))
      assert.notProperty(data, 'apiKey')
      assert.notInclude(JSON.stringify(data), 'data:image')
    } finally {
      restore()
    }
  })

  test('rejects invalid image payload with unified error envelope', async ({ client }) => {
    const { conn, user } = await createAiConnection({ model: 'ocr-model' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    model.capabilities = ['ocr']
    await model.save()
    const token = await login(client, user.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        connectionId: conn.id,
        modelId: model.id,
        image: { dataUrl: 'data:text/plain;base64,SGVsbG8=' },
      })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('does not call provider when model lacks OCR capability', async ({ client, assert }) => {
    const { conn, user } = await createAiConnection()
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    let called = false
    const original = AIGateway.prototype.ocrPreview
    AIGateway.prototype.ocrPreview = async () => {
      called = true
      return { ok: true, extractedText: 'should not happen' }
    }
    const token = await login(client, user.email)

    try {
      const res = await client
        .post(BASE)
        .bearerToken(token)
        .json({
          connectionId: conn.id,
          modelId: model.id,
          image: { dataUrl: IMAGE },
        })
      res.assertStatus(404)
      res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
      assert.isFalse(called)
    } finally {
      AIGateway.prototype.ocrPreview = original
    }
  })

  test('rejects cross-organization connection without leaking existence', async ({ client }) => {
    const { conn } = await createAiConnection({ model: 'ocr-model' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    model.capabilities = ['ocr']
    await model.save()
    const otherUser = await createUser()
    await createOrganization(otherUser)
    const token = await login(client, otherUser.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        connectionId: conn.id,
        modelId: model.id,
        image: { dataUrl: IMAGE },
      })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })
})
