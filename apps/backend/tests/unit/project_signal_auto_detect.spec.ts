import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const detectAndPersist = vi.fn()
vi.mock('#services/project_signal/project_signal_service', () => ({
  default: class {
    detectAndPersist = detectAndPersist
  },
}))
vi.mock('@adonisjs/core/services/logger', () => ({ default: { warn: vi.fn() } }))

const { scheduleProjectSignalDetection, resetSignalAutoDetectThrottle } =
  await import('#services/project_signal/signal_auto_detect')

describe('项目数据变化后自动检测信号', () => {
  const user = { id: 1 } as never

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    resetSignalAutoDetectThrottle()
    detectAndPersist.mockReset().mockResolvedValue({ created: [], refreshed: [] })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('写操作后在后台检测，不阻塞调用方；同一项目 5 分钟内只检测一次', async () => {
    scheduleProjectSignalDetection({ organizationId: 1, projectId: 6, user })
    expect(detectAndPersist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(detectAndPersist).toHaveBeenCalledWith({ organizationId: 1, projectId: 6, user })
    scheduleProjectSignalDetection({ organizationId: 1, projectId: 6, user })
    scheduleProjectSignalDetection({ organizationId: 1, projectId: 7, user })
    await vi.advanceTimersByTimeAsync(0)
    expect(detectAndPersist).toHaveBeenCalledTimes(2)
  })

  it('检测失败只记日志、不抛出，并放开节流以便下次重试', async () => {
    detectAndPersist.mockRejectedValueOnce(new Error('db down'))
    scheduleProjectSignalDetection({ organizationId: 1, projectId: 6, user })
    await vi.advanceTimersByTimeAsync(0)
    scheduleProjectSignalDetection({ organizationId: 1, projectId: 6, user })
    await vi.advanceTimersByTimeAsync(0)
    expect(detectAndPersist).toHaveBeenCalledTimes(2)
  })

  it('测试环境不做后台检测', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    scheduleProjectSignalDetection({ organizationId: 1, projectId: 6, user })
    await vi.advanceTimersByTimeAsync(0)
    expect(detectAndPersist).not.toHaveBeenCalled()
  })
})
