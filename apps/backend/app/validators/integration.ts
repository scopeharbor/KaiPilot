import vine from '@vinejs/vine'

export const integrationCallbackValidator = vine.compile(
  vine.object({
    code: vine.string().trim().optional(),
    state: vine.string().trim().optional(),
    error: vine.string().trim().optional(),
    error_description: vine.string().trim().optional(),
  }),
)
