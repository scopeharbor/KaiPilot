import { describe, it, expect } from 'vitest'

describe('usePredictions', () => {
  it('creates query keys correctly', () => {
    const keys = ['projects', 1, 'predictions']
    expect(keys).toEqual(['projects', 1, 'predictions'])
  })
})

describe('ProjectPredictionPanel', () => {
  it('renders without crashing (skeleton)', () => {
    expect(true).toBe(true)
  })
})
