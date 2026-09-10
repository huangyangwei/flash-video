// 房间页解析（纯逻辑，无 IO）：从抖音房间页 HTML 提取开播状态与 flv 拉流地址。
// 内嵌数据是转义 JSON（引号写作 \"，& 写作 &），形如：
//   \"stream_url\":{\"flv_pull_url\":{\"FULL_HD1\":\"http://...flv?expire=..\\u0026sign=..\"}}
// 策略（design D2）：宽容解析——找不到字段返回明确失败，不抛异常；
// 宁可漏报不可误报（误报会弹浏览器），没有 flv 地址时绝不判定为开播。

const FLV_BLOCK_RE = /\\?"flv_pull_url\\?"\s*:\s*\\?{/g;
const KV_RE = /\\?"([A-Z0-9_]+)\\?"\s*:\s*\\?"(https?(?:\\u0026|[^"\\])+?)\\?"/g;
const STATUS_RE = /\\?"status\\?"\s*:\s*(\d+)/g;

// 已知枚举：2 = 直播中，4 = 已结束（spike 5.1 抓到离播样本后据此复核）
const STATUS_ENDED = 4;

// 风控验证码中间页（实测 2026-09-09：6KB 壳页，标题"验证码中间页"，
// 高频轮询会触发）。单独归类，与"格式改版"区分——前者等退避/过验证可自愈。
const CAPTCHA_RE = /验证码中间页|captcha/i;

// 只解码 URL 里真实出现的转义（& = &），其余字符原样保留
function decodeUrl(raw) {
  return raw.replace(/\\u0026/g, '&');
}

/**
 * @param {string} html 房间页完整 HTML
 * @returns {{ok:true, live:boolean, firstUrl?:string, bestUrl?:string, flvUrls?:Object}
 *           |{ok:false, reason:string}}
 */
export function parseRoomPage(html) {
  if (!html || typeof html !== 'string') {
    return { ok: false, reason: 'empty' };
  }
  if (CAPTCHA_RE.test(html)) {
    return { ok: false, reason: 'captcha' };
  }

  const flvUrls = {};
  let firstUrl = null;
  FLV_BLOCK_RE.lastIndex = 0;
  for (let block; (block = FLV_BLOCK_RE.exec(html)); ) {
    // 块边界取到第一个 "}"（内嵌 JSON 中 } 不转义，块内只有键值对）
    const end = html.indexOf('}', block.index + block[0].length);
    const body = end === -1 ? html.slice(block.index) : html.slice(block.index, end);
    KV_RE.lastIndex = 0;
    for (let m; (m = KV_RE.exec(body)); ) {
      const url = decodeUrl(m[2]);
      if (!firstUrl) firstUrl = url;
      if (!flvUrls[m[1]]) flvUrls[m[1]] = url;
    }
  }

  // 拿到签名 flv 地址本身就是开播的铁证（未开播页面不会有）
  if (firstUrl) {
    return {
      ok: true,
      live: true,
      firstUrl,
      // 清晰度优先 FULL_HD1（探测样本中的最高档），缺失则用第一个
      bestUrl: flvUrls.FULL_HD1 ?? firstUrl,
      flvUrls,
    };
  }

  // 没有 flv 地址：只有明确出现"已结束"枚举才判定未开播；
  // 页面上找不到任何已知状态字段时按解析失败处理（可能格式改版）
  const statuses = [...html.matchAll(STATUS_RE)].map((m) => Number(m[1]));
  if (statuses.includes(STATUS_ENDED)) {
    return { ok: true, live: false };
  }
  return { ok: false, reason: 'no-stream-no-status' };
}
