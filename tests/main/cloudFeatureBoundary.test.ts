import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 读取项目内源文件用于静态隐私边界断言。
 * @param relativePath 相对于项目根目录的文件路径。
 * @returns 文件的 UTF-8 文本内容。
 */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

describe('removed cloud feature source boundaries', () => {
  it('does not start remote sync or activity heartbeat', () => {
    const appMainSource = readSource('src/main/appMain.ts')
    const apiIndexSource = readSource('src/main/api/index.ts')

    expect(appMainSource).not.toContain('activityHeartbeatService')
    expect(appMainSource).not.toContain('/api/activity/heartbeat')
    expect(apiIndexSource).not.toContain('./renderer/sync')
    expect(apiIndexSource).not.toContain('syncAPI.init')

    expect(apiIndexSource).toContain('aiModelsAPI.init()')
    expect(apiIndexSource).toContain('pluginsAPI.init(')
    expect(apiIndexSource).toContain('storageAPI.init()')
  })

  it('does not expose comments, the official notification center, or official AI', () => {
    const internalApiSource = readSource('src/main/api/plugin/internal.ts')
    const pluginMarketSource = readSource('src/main/api/renderer/pluginMarket.ts')
    const pluginAiSource = readSource('src/main/api/plugin/ai.ts')
    const aiModelsSource = readSource('src/main/api/renderer/aiModels.ts')
    const preloadSource = readSource('resources/preload.js')
    const combinedSource = [
      internalApiSource,
      pluginMarketSource,
      pluginAiSource,
      aiModelsSource,
      preloadSource
    ].join('\n')

    for (const removedText of [
      'fetch-plugin-market-comments',
      'create-plugin-market-comment',
      'notification-summary',
      '/plugins/comments',
      '/api/notifications',
      'officialAIService',
      'getOfficialProvider',
      'ai-providers:get-official'
    ]) {
      expect(combinedSource).not.toContain(removedText)
    }

    expect(internalApiSource).toContain('internal:fetch-plugin-market')
    expect(internalApiSource).toContain('internal:install-plugin-from-market')
    expect(aiModelsSource).toContain('ai-providers:get-all')
    expect(pluginAiSource).toContain('getModelChoices')
    expect(pluginAiSource).toContain('resolveModel')
  })

  it('keeps only local settings navigation and redirects legacy cloud routes', () => {
    const routerSource = readSource('internal-plugins/setting/src/router/router.ts')
    const leftMenuSource = readSource(
      'internal-plugins/setting/src/components/LeftMenu/LeftMenu.vue'
    )
    const aiModelsSource = readSource(
      'internal-plugins/setting/src/views/AiModelsSetting/AiModelsSetting.vue'
    )
    const marketDetailSource = readSource(
      'internal-plugins/setting/src/views/PluginMarketSetting/components/PluginDetail/PluginDetail.vue'
    )
    const manifestSource = readSource('internal-plugins/setting/public/plugin.json')
    const settingsTypesSource = readSource('internal-plugins/setting/src/env.d.ts')
    const combinedSource = [
      leftMenuSource,
      aiModelsSource,
      marketDetailSource,
      manifestSource,
      settingsTypesSource
    ].join('\n')

    for (const removedText of [
      'AccountSetting',
      'SyncSetting',
      'NotificationCenter',
      'AccountLoginDialog',
      'OfficialAiCredits',
      '注册/登录 ZTools',
      '数据同步',
      '消息中心',
      'fetchPluginMarketComments',
      'syncGetAccountCredits',
      'accountGetSession'
    ]) {
      expect(combinedSource).not.toContain(removedText)
    }

    expect(routerSource).toContain("path: '/account'")
    expect(routerSource).toContain("path: '/sync'")
    expect(routerSource).toContain("path: '/notifications'")
    expect(manifestSource).toContain('ui.router?router=GeneralSetting')
    expect(manifestSource).toContain('ui.router?router=Market')
    expect(manifestSource).toContain('ui.router?router=Data')
    expect(manifestSource).toContain('function.local-launch-add?router=LocalLaunch')
  })
})
