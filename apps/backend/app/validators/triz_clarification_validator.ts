import vine from '@vinejs/vine'

const trizClarificationAnswer = vine.object({
  cardId: vine.string().trim(),
  action: vine.enum(['answer', 'adopt_default', 'skip', 'defer_review']),
  value: vine.any().nullable(),
  adoptedDefault: vine.boolean(),
  sourceHash: vine.string().trim(),
  marker: vine
    .object({
      confidence: vine.number().min(0).max(1),
      source: vine.enum(['explicit', 'inferred', 'default']),
      reason: vine.string().trim(),
      needsConfirmation: vine.boolean(),
    })
    .nullable()
    .optional(),
  note: vine.string().trim().optional(),
})

export const trizClarificationAnswersValidator = vine.create({
  trizAnswers: vine.array(trizClarificationAnswer).optional(),
})
