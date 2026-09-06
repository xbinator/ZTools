import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

test('settings stay accountless and do not request removed cloud endpoints', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-privacy-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null
  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 使用隔离数据目录启动源码 Electron，禁止访问真实用户数据。
    electronApp = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })

    await electronApp.evaluate(({ session }) => {
      const requestLog: string[] = []
      ;(globalThis as any).__ztoolsPrivacyRequestLog = requestLog
      const forbiddenPathPattern =
        /\/(api\/activity\/heartbeat|api\/auth(?:\/|$)|api\/account(?:\/|$)|api\/sync(?:\/|$)|api\/notifications(?:\/|$)|plugins\/comments(?:\/|$))/

      // 只记录本次测试关心的已移除端点，不干预匿名市场和更新请求。
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (forbiddenPathPattern.test(new URL(details.url).pathname)) requestLog.push(details.url)
        callback({})
      })
    })

    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('通用设置')
    const settingsResult = page
      .locator('.app-item, .list-item')
      .filter({ hasText: '通用设置' })
      .first()
    await expect(settingsResult).toBeVisible()
    await settingsResult.click()

    await expect
      .poll(
        () =>
          electronApp!.evaluate(async ({ webContents }) => {
            const contents = webContents
              .getAllWebContents()
              .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))
            if (!contents || contents.isLoading()) return ''
            return contents.executeJavaScript('document.body.innerText')
          }),
        { timeout: 15_000 }
      )
      .toContain('开机自动启动')

    const settingsText = await electronApp.evaluate(async ({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))
      if (!contents) throw new Error('未找到设置插件 WebContentsView')
      return contents.executeJavaScript('document.body.innerText')
    })
    for (const removedText of [
      '注册/登录 ZTools',
      '个人中心',
      '数据同步',
      '消息中心',
      '留言',
      '官方模型',
      '积分'
    ]) {
      expect(settingsText).not.toContain(removedText)
    }

    for (const routeCheck of [
      { hash: '#/market', selector: '.plugin-market' },
      { hash: '#/providers', selector: '.providers-container' },
      { hash: '#/data', selector: '.data-management' }
    ]) {
      await electronApp.evaluate(async ({ webContents }, target) => {
        const contents = webContents
          .getAllWebContents()
          .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))
        if (!contents) throw new Error('未找到设置插件 WebContentsView')
        await contents.executeJavaScript(`window.location.hash = ${JSON.stringify(target.hash)}`)
      }, routeCheck)
      await expect
        .poll(() =>
          electronApp!.evaluate(async ({ webContents }, selector) => {
            const contents = webContents
              .getAllWebContents()
              .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))
            if (!contents || contents.isLoading()) return false
            return contents.executeJavaScript(
              `Boolean(document.querySelector(${JSON.stringify(selector)}))`
            )
          }, routeCheck.selector)
        )
        .toBe(true)
    }

    const forbiddenRequests = await electronApp.evaluate(
      () => ((globalThis as any).__ztoolsPrivacyRequestLog || []) as string[]
    )
    expect(forbiddenRequests).toEqual([])
  } finally {
    // 始终关闭隔离实例并删除测试专用目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
