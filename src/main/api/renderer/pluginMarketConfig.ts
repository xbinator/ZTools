import type { HttpRequestOptions, HttpResponse } from '../../utils/httpRequest'
import { httpRequest } from '../../utils/httpRequest.js'

export const OFFICIAL_SERVICE_HTTP_BASE = 'https://z.zosen.link'
export const DEFAULT_PLUGIN_MARKET_API_BASE = `${OFFICIAL_SERVICE_HTTP_BASE}/api/market`

/**
 * 获取匿名插件市场 API 根地址。
 * @returns 插件市场 HTTPS 根地址。
 */
export function getPluginMarketApiBase(): string {
  return DEFAULT_PLUGIN_MARKET_API_BASE
}

/**
 * 发起不携带账号凭据的插件市场请求。
 * @param path 市场相对路径或完整 URL。
 * @param options HTTP 请求选项。
 * @returns 成功的 HTTP 响应。
 * @throws 响应状态码不在 2xx 范围时抛出错误。
 */
export async function requestPluginMarket(
  path: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse> {
  const url = path.startsWith('http') ? path : `${getPluginMarketApiBase()}${path}`

  // 无论调用方使用何种大小写，都不允许账号鉴权头离开设备。
  const anonymousHeaders = Object.fromEntries(
    Object.entries(options.headers || {}).filter(([key]) => key.toLowerCase() !== 'authorization')
  )
  const response = await httpRequest(url, {
    ...options,
    headers: anonymousHeaders,
    validateStatus: () => true
  })
  assertOK(response)
  return response
}

/**
 * 校验市场响应是否成功。
 * @param response 待校验的 HTTP 响应。
 * @returns 无返回值。
 * @throws 响应状态码不在 2xx 范围时抛出服务端或通用错误。
 */
function assertOK(response: HttpResponse): void {
  if (response.status >= 200 && response.status < 300) return
  const data = typeof response.data === 'string' ? safeParseJSON(response.data) : response.data
  throw new Error(data?.error || `Request failed with status code ${response.status}`)
}

/**
 * 安全解析可能不是 JSON 的响应文本。
 * @param value 待解析的字符串。
 * @returns 解析结果，格式无效时返回空对象。
 */
function safeParseJSON(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}
