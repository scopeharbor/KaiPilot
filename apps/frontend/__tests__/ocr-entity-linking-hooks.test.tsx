/**
 * OCR Entity Linking — TanStack Query Hooks 测试
 */
import { describe, it, expect } from 'vitest'
import { ocrEntityLinkingKeys } from '../hooks/use-ocr-entity-linking'

describe('ocrEntityLinkingKeys', () => {
  const projectId = 1

  it('generates correct all key', () => {
    expect(ocrEntityLinkingKeys.all).toEqual(['ocr-entity-linking'])
  })

  it('generates correct runs key', () => {
    const key = ocrEntityLinkingKeys.runs(projectId)
    expect(key).toEqual(['ocr-entity-linking', 'runs', projectId, {}])
  })

  it('generates correct runs key with filters', () => {
    const key = ocrEntityLinkingKeys.runs(projectId, { status: 'completed' })
    expect(key).toEqual(['ocr-entity-linking', 'runs', projectId, { status: 'completed' }])
  })

  it('generates correct detail key', () => {
    expect(ocrEntityLinkingKeys.detail(projectId, 5)).toEqual([
      'ocr-entity-linking',
      'detail',
      projectId,
      5,
    ])
  })

  it('generates correct candidates key', () => {
    expect(ocrEntityLinkingKeys.candidates(projectId, 5)).toEqual([
      'ocr-entity-linking',
      'candidates',
      projectId,
      5,
    ])
  })

  it('generates correct candidatePage key', () => {
    expect(ocrEntityLinkingKeys.candidatePage(projectId, 5, 2)).toEqual([
      'ocr-entity-linking',
      'candidates',
      projectId,
      5,
      2,
    ])
  })

  it('all key is base for all others', () => {
    const runs = ocrEntityLinkingKeys.runs(projectId)
    expect(runs[0]).toBe(ocrEntityLinkingKeys.all[0])
  })
})
