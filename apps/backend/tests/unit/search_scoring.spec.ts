import { test } from '@japa/runner'
import {
  calculateHitScore,
  calculateCompositeScore,
  mergeAndSortResults,
  paginateResults,
  assignScores,
} from '#services/search/search_scoring'
import type { SearchResultItem } from '@aiproj/types'

test.group('search scoring - calculateHitScore', () => {
  test('returns 0 for empty keyword', ({ assert }) => {
    assert.equal(calculateHitScore('', ['name']), 0)
  })

  test('returns 0 for empty matched fields', ({ assert }) => {
    assert.equal(calculateHitScore('test', []), 0)
  })

  test('scores name field with weight 10', ({ assert }) => {
    const score = calculateHitScore('test', ['name'])
    assert.isAbove(score, 0)
  })

  test('scores description field with weight 5', ({ assert }) => {
    const score = calculateHitScore('test', ['description'])
    assert.equal(score, 5)
  })

  test('accumulates multiple field matches', ({ assert }) => {
    const score = calculateHitScore('test', ['name', 'description'])
    assert.equal(score, 15)
  })
})

test.group('search scoring - calculateCompositeScore', () => {
  test('produces higher score for recent updates', ({ assert }) => {
    const recent = calculateCompositeScore(10, new Date().toISOString(), 'task', 100)
    const old = calculateCompositeScore(10, '2020-01-01', 'task', 100)
    assert.isAbove(recent, old)
  })

  test('project has higher type priority score than activity', ({ assert }) => {
    const project = calculateCompositeScore(10, null, 'project', 100)
    const activity = calculateCompositeScore(10, null, 'activity', 100)
    assert.isAbove(project, activity)
  })
})

test.group('search scoring - mergeAndSortResults', () => {
  test('sorts by score descending', ({ assert }) => {
    const items: SearchResultItem[] = [
      {
        entityType: 'task',
        entityId: 1,
        title: 'B',
        summary: null,
        matchedFields: [],
        updatedAt: null,
        target: '/',
        source: 'test',
        score: 10,
        projectId: null,
        status: null,
      },
      {
        entityType: 'task',
        entityId: 2,
        title: 'A',
        summary: null,
        matchedFields: [],
        updatedAt: null,
        target: '/',
        source: 'test',
        score: 20,
        projectId: null,
        status: null,
      },
    ]
    const sorted = mergeAndSortResults(items)
    assert.equal(sorted[0].entityId, 2)
    assert.equal(sorted[1].entityId, 1)
  })

  test('stable sort by ID when scores equal', ({ assert }) => {
    const items: SearchResultItem[] = [
      {
        entityType: 'task',
        entityId: 10,
        title: 'B',
        summary: null,
        matchedFields: [],
        updatedAt: null,
        target: '/',
        source: 'test',
        score: 10,
        projectId: null,
        status: null,
      },
      {
        entityType: 'task',
        entityId: 20,
        title: 'A',
        summary: null,
        matchedFields: [],
        updatedAt: null,
        target: '/',
        source: 'test',
        score: 10,
        projectId: null,
        status: null,
      },
    ]
    const sorted = mergeAndSortResults(items)
    assert.equal(sorted[0].entityId, 20) // Higher ID first
  })
})

test.group('search scoring - paginateResults', () => {
  const items: SearchResultItem[] = Array.from({ length: 25 }, (_, i) => ({
    entityType: 'task' as const,
    entityId: i + 1,
    title: `Task ${i + 1}`,
    summary: null,
    matchedFields: [] as string[],
    updatedAt: null,
    target: '/',
    source: 'test',
    score: i,
    projectId: null,
    status: null,
  }))

  test('returns first page of 10', ({ assert }) => {
    const { items: page, total, totalPages } = paginateResults(items, 1, 10)
    assert.equal(page.length, 10)
    assert.equal(total, 25)
    assert.equal(totalPages, 3)
  })

  test('returns second page', ({ assert }) => {
    const { items: page } = paginateResults(items, 2, 10)
    assert.equal(page.length, 10)
  })

  test('returns last partial page', ({ assert }) => {
    const { items: page } = paginateResults(items, 3, 10)
    assert.equal(page.length, 5)
  })
})

test.group('search scoring - assignScores', () => {
  test('assigns scores based on keyword and fields', ({ assert }) => {
    const items: SearchResultItem[] = [
      {
        entityType: 'task',
        entityId: 1,
        title: 'Test Task',
        summary: null,
        matchedFields: ['name'],
        updatedAt: null,
        target: '/',
        source: 'test',
        score: 0,
        projectId: null,
        status: null,
      },
    ]
    const scored = assignScores(items, 'Test')
    assert.isAbove(scored[0].score, 0)
  })
})
