import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerPluginApiServices: vi.fn()
}))

vi.mock('../../src/main/api/plugin/pluginApiDispatcher', () => ({
  registerPluginApiServices: mocks.registerPluginApiServices
}))

import pluginUserAPI from '../../src/main/api/plugin/user'

describe('plugin user API registration', () => {
  it('keeps compatibility methods local and accountless', async () => {
    pluginUserAPI.init()

    const services = mocks.registerPluginApiServices.mock.calls[0][0]
    const event = { returnValue: undefined } as unknown as Electron.IpcMainEvent
    services.getUser(event)

    expect(event.returnValue).toBeNull()
    await expect(services.getUserTempToken({ sender: {} })).rejects.toThrow(
      'ZTools 官方账号服务未提供'
    )
  })
})
