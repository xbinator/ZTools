import { registerPluginApiServices } from './pluginApiDispatcher'

export interface PluginTemporaryToken {
  token: string
  expiredAt: number
}

/**
 * 插件用户 API，仅保留不访问网络的兼容接口。
 */
export class PluginUserAPI {
  /**
   * 注册账号兼容 API。
   * @returns 无返回值。
   */
  public init(): void {
    registerPluginApiServices({
      getUser: this.handleGetUser,
      getUserTempToken: this.handleGetUserTempToken
    })
  }

  /**
   * 向插件返回无账号状态。
   * @param event 插件发起的同步 IPC 事件。
   * @returns 无返回值。
   */
  private handleGetUser(event: Electron.IpcMainEvent): void {
    event.returnValue = null
  }

  /**
   * 拒绝已移除的官方账号临时令牌请求。
   * @param _event 插件发起的异步 IPC 事件。
   * @returns 永远拒绝的临时令牌 Promise。
   * @throws 始终抛出官方账号服务未提供错误。
   */
  private async handleGetUserTempToken(
    _event: Electron.IpcMainInvokeEvent
  ): Promise<PluginTemporaryToken> {
    throw new Error('ZTools 官方账号服务未提供')
  }
}

export default new PluginUserAPI()
