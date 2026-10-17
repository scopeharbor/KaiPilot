import { test } from '@japa/runner'
import { parseOcrImagePayload } from '#services/ai_ocr/payload'

test.group('OCR payload validation', () => {
  test('accepts supported data URL payloads', ({ assert }) => {
    const parsed = parseOcrImagePayload('data:image/png;base64,SGVsbG8=')

    assert.equal(parsed.mimeType, 'image/png')
    assert.equal(parsed.sizeBytes, 5)
    assert.equal(parsed.dataUrl, 'data:image/png;base64,SGVsbG8=')
  })

  test('rejects invalid payloads before provider calls', ({ assert }) => {
    assert.throws(() => parseOcrImagePayload(null), /OCR 图片无效/)
    assert.throws(() => parseOcrImagePayload('not-a-data-url'), /OCR 图片无效/)
    assert.throws(() => parseOcrImagePayload('data:text/plain;base64,SGVsbG8='), /OCR 图片无效/)
    assert.throws(() => parseOcrImagePayload('data:image/png;base64,AAAA', 2), /OCR 图片无效/)
  })
})
