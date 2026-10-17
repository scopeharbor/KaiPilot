import { describe, expect, test } from 'vitest'
import { parseApiError } from './errors.js'

describe('v2-5-typescript-sdk-core API error parsing', () => {
  test('parses { error: { code, message, details } } envelope on 401', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'token expired', details: {} } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
    const err = await parseApiError(res)
    expect(err.status).toBe(401)
    expect(err.code).toBe('AUTH_REQUIRED')
    expect(err.message).toBe('token expired')
    expect(err.details).toEqual({})
  })

  test('parses 403 PERMISSION_DENIED', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'PERMISSION_DENIED', message: 'forbidden' } }),
      { status: 403 },
    )
    const err = await parseApiError(res)
    expect(err.status).toBe(403)
    expect(err.code).toBe('PERMISSION_DENIED')
  })

  test('parses 404 RESOURCE_NOT_FOUND', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'RESOURCE_NOT_FOUND', message: 'no such project' } }),
      { status: 404 },
    )
    const err = await parseApiError(res)
    expect(err.status).toBe(404)
    expect(err.code).toBe('RESOURCE_NOT_FOUND')
  })

  test('parses 422 VALIDATION_ERROR with field-level details', async () => {
    const res = new Response(
      JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'bad input', details: { name: ['required'] } },
      }),
      { status: 422 },
    )
    const err = await parseApiError(res)
    expect(err.status).toBe(422)
    expect(err.details).toEqual({ name: ['required'] })
  })

  test('parses 500 AI_SERVICE_ERROR', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'AI_SERVICE_ERROR', message: 'upstream down' } }),
      { status: 500 },
    )
    const err = await parseApiError(res)
    expect(err.status).toBe(500)
    expect(err.code).toBe('AI_SERVICE_ERROR')
  })

  test('falls back to statusText on malformed JSON body', async () => {
    const res = new Response('not-json-at-all', { status: 502, statusText: 'Bad Gateway' })
    const err = await parseApiError(res)
    expect(err.status).toBe(502)
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('Bad Gateway')
    expect(err.details).toBeUndefined()
  })

  test('preserves details when present, omits details when absent', async () => {
    const withDetails = await parseApiError(
      new Response(JSON.stringify({ error: { code: 'X', message: 'm', details: [1, 2] } }), {
        status: 400,
      }),
    )
    expect(withDetails.details).toEqual([1, 2])
    const withoutDetails = await parseApiError(
      new Response(JSON.stringify({ error: { code: 'X', message: 'm' } }), { status: 400 }),
    )
    expect(withoutDetails.details).toBeUndefined()
  })

  test('does not leak sensitive body: result carries only status/code/message/details', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'X', message: 'm' }, secret: 'leak', token: 'abc' }),
      { status: 400 },
    )
    const err = await parseApiError(res)
    const keys = Object.keys(err).sort()
    expect(keys).toEqual(['code', 'details', 'message', 'status'])
    expect(JSON.stringify(err)).not.toMatch('leak')
    expect(JSON.stringify(err)).not.toMatch('abc')
  })
})
