import vine from '@vinejs/vine'
import { DIAGRAM_TYPES } from '@aiproj/types'

const diagramType = () => vine.enum([...DIAGRAM_TYPES] as const)

export const createDiagramValidator = vine.compile(
  vine.object({
    type: diagramType(),
    title: vine.string().trim().minLength(1).maxLength(255),
    spec: vine.any(),
  }),
)

export const updateDiagramValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    spec: vine.any().optional(),
  }),
)

export const listDiagramsValidator = vine.compile(
  vine.object({
    type: diagramType().optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
