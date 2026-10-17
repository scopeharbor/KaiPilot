import { test } from '@japa/runner'
import OcrPreviewService from '#services/ai_ocr/ocr_preview_service'
import {
  AIGateway,
  type AdapterOcrPreviewResult,
  type OcrPreviewOptions,
} from '#services/ai_m0/gateway'
import AiConnectionModel from '#models/ai_connection_model'
import { createAiConnection, createOrganization, createUser, useAiDatabase } from './ai/_helpers.js'

const IMAGE = 'data:image/png;base64,SGVsbG8='

function stubOcrPreview(handler: (options: OcrPreviewOptions) => Promise<AdapterOcrPreviewResult>) {
  const original = AIGateway.prototype.ocrPreview
  AIGateway.prototype.ocrPreview = handler
  return () => {
    AIGateway.prototype.ocrPreview = original
  }
}

test.group('OcrPreviewService', (group) => {
  useAiDatabase(group)

  test('calls an OCR-capable model and returns preview candidate data only', async ({ assert }) => {
    const { conn, org } = await createAiConnection({ model: 'PaddlePaddle/PaddleOCR-VL-1.5' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    model.capabilities = ['ocr', 'vision']
    await model.save()
    let called = false
    const restore = stubOcrPreview(async (options) => {
      called = true
      assert.equal(options.imageDataUrl, IMAGE)
      return {
        ok: true,
        extractedText: '开项 OCR 测试 123',
        usage: { inputTokens: 226, outputTokens: 11, totalTokens: 237 },
      }
    })

    try {
      const result = await new OcrPreviewService().preview(
        {
          connectionId: conn.id,
          modelId: model.id,
          image: { dataUrl: IMAGE },
          promptHint: '只读中文',
        },
        Number(org.id),
      )

      assert.isTrue(called)
      assert.equal(result.status, 'succeeded')
      assert.equal(result.extractedText, '开项 OCR 测试 123')
      assert.equal(result.provider.model, 'PaddlePaddle/PaddleOCR-VL-1.5')
      assert.equal(result.provider.usage?.totalTokens, 237)
      assert.equal(result.image.mimeType, 'image/png')
    } finally {
      restore()
    }
  })

  test('rejects models without OCR or vision capability without provider call', async ({
    assert,
  }) => {
    const { conn, org } = await createAiConnection()
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    let called = false
    const restore = stubOcrPreview(async () => {
      called = true
      return { ok: true, extractedText: 'should not happen' }
    })

    try {
      await assert.rejects(
        () =>
          new OcrPreviewService().preview(
            { connectionId: conn.id, modelId: model.id, image: { dataUrl: IMAGE } },
            Number(org.id),
          ),
        /OCR 模型不可用/,
      )
      assert.isFalse(called)
    } finally {
      restore()
    }
  })

  test('rejects cross-organization model access', async ({ assert }) => {
    const { conn } = await createAiConnection({ model: 'ocr-model' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    model.capabilities = ['ocr']
    await model.save()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    await assert.rejects(
      () =>
        new OcrPreviewService().preview(
          { connectionId: conn.id, modelId: model.id, image: { dataUrl: IMAGE } },
          Number(otherOrg.id),
        ),
      /OCR 模型不可用/,
    )
  })

  test('maps provider failures to safe API errors', async ({ assert }) => {
    const { conn, org } = await createAiConnection({ model: 'ocr-model' })
    const model = await AiConnectionModel.query().where('connection_id', conn.id).firstOrFail()
    model.capabilities = ['ocr']
    await model.save()
    const restore = stubOcrPreview(async () => ({
      ok: false,
      errorKind: 'PROVIDER_TIMEOUT',
      errorMessage: '供应商响应超时',
    }))

    try {
      await assert.rejects(
        () =>
          new OcrPreviewService().preview(
            { connectionId: conn.id, modelId: model.id, image: { dataUrl: IMAGE } },
            Number(org.id),
          ),
        /供应商响应超时/,
      )
    } finally {
      restore()
    }
  })
})
