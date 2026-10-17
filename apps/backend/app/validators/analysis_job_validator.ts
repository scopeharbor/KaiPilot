import vine from '@vinejs/vine'

export const analysisJobRequestValidator = vine.create({ requestKey: vine.string().uuid() })
export const analysisJobIdValidator = vine.create({ jobId: vine.string().uuid() })
