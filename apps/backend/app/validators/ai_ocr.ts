import vine from '@vinejs/vine'

export const ocrPreviewValidator = vine.create({
  contractVersion: vine.string().trim().maxLength(20).optional(),
  connectionId: vine.unionOfTypes([
    vine.number().withoutDecimals().positive(),
    vine.string().trim().minLength(1).maxLength(40),
  ]),
  modelId: vine.unionOfTypes([
    vine.number().withoutDecimals().positive(),
    vine.string().trim().minLength(1).maxLength(40),
  ]),
  image: vine.object({
    dataUrl: vine.string().trim().minLength(1).maxLength(3_000_000),
    fileName: vine.string().trim().maxLength(255).nullable().optional(),
  }),
  promptHint: vine.string().trim().maxLength(500).nullable().optional(),
})
