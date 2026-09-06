import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHttpRequest = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/utils/httpRequest.js', () => ({
  httpRequest: mockHttpRequest
}))

import { requestPluginMarket } from '../../src/main/api/renderer/pluginMarketConfig'

describe('requestPluginMarket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always performs one anonymous request and strips authorization headers', async () => {
    mockHttpRequest.mockResolvedValue({ status: 200, data: { items: [] } })

    await requestPluginMarket('/plugins', {
      headers: {
        Authorization: 'Bearer must-not-leave-device',
        'X-Request-ID': 'keep-this-header'
      }
    })

    expect(mockHttpRequest).toHaveBeenCalledOnce()
    expect(mockHttpRequest.mock.calls[0][1].headers).toEqual({
      'X-Request-ID': 'keep-this-header'
    })
  })

  it('does not retry unauthorized anonymous requests', async () => {
    mockHttpRequest.mockResolvedValue({ status: 401, data: {} })

    await expect(requestPluginMarket('/plugins')).rejects.toThrow(
      'Request failed with status code 401'
    )
    expect(mockHttpRequest).toHaveBeenCalledOnce()
  })
})
