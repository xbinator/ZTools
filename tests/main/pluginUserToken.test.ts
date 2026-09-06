import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerPluginApiServices: vi.fn()
}))

vi.mock('../../src/main/api/plugin/pluginApiDispatcher', () => ({
  registerPluginApiServices: mocks.registerPluginApiServices
}))

import { PluginUserAPI } from '../../src/main/api/plugin/user'

describe('plugin getUserTempToken privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects repeated requests without contacting an account service', async () => {
    const api = new PluginUserAPI()
    api.init()
    const handler = mocks.registerPluginApiServices.mock.calls[0][0].getUserTempToken

    await expect(handler({ sender: {} })).rejects.toThrow('ZTools 官方账号服务未提供')
    await expect(handler({ sender: {} })).rejects.toThrow('ZTools 官方账号服务未提供')
  })
})
