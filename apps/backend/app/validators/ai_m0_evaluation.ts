import vine from '@vinejs/vine'

const mode = vine.enum(['dry_run', 'real'])
const strategy = vine.enum(['prompt', 'native', 'tool'])

export const evaluationPlanValidator = vine.create({
  mode,
  repetitions: vine.number().min(1).max(20).optional(),
})

export const executeEvaluationValidator = vine.create({
  stepId: vine.string().trim().minLength(1).maxLength(100),
  inputId: vine.string().trim().minLength(1).maxLength(32),
  requestedStrategy: strategy,
  repetition: vine.number().min(1).max(20),
  mode,
  connectionId: vine.number().positive().optional(),
})
