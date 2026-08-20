const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ACC = process.env.ACC || process.env.EML;
const ACC_PWD = process.env.ACC_PWD || process.env.PWD;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_ID = process.env.TG_ID;

// 代理与网络状态环境引入
const rawProxy = process.env.USE_PROXY || process.env.IS_PROXY;
const USE_PROXY = rawProxy === 'true' || rawProxy === '1' || (typeof rawProxy === 'string' && rawProxy.length > 0 && rawProxy !== 'false' && rawProxy !== '0');
const PROXY_STATUS = process.env.PROXY_STATUS || '直连';

// T 延迟控制（单位：分钟）
const T = process.env.T;
const IS_MANUAL = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.GITHUB_ACTIONS;
let DELAY_MS = 0;
if (T && !IS_MANUAL) {
  const range = T.match(/^(\d+)\s*-\s*(\d+)$/);
  const fixed = T.match(/^(\d+)$/);
  if (range) {
    const lo = parseInt(range[1]), hi = parseInt(range[2]);
    DELAY_MS = (Math.floor(Math.random() * (hi - lo + 1)) + lo) * 60000;
    console.log('🎲 随机延迟 ' + (DELAY_MS / 60000) + ' 分钟（范围 ' + lo + '-' + hi + '）');
  } else if (fixed) {
    DELAY_MS = parseInt(fixed[1]) * 60000;
    console.log('⏳ 固定延迟 ' + (DELAY_MS / 60000) + ' 分钟');
  }
}
if (IS_MANUAL) console.log('🖱️ 手动触发模式，跳过延迟');

const LOGIN_URL = 'https://secure.xserver.ne.jp/xapanel/login/xmgame';

// 时区：续期页面时间为日本时间 (JST, UTC+9)
const TZ_OFFSET = 9;

// ── 日期与工具函数 ──

function getNowJST() {
  return new Date(Date.now() + TZ_OFFSET * 3600000);
}

function fmtHours(h) {
  if (h === null || h === undefined || isNaN(h)) return '?';
  if (h >= 10) return Math.round(h) + 'h';
  if (h >= 1) return h.toFixed(1) + 'h';
  return Math.round(h * 60) + 'm';
}

function fmtMinutes(min) {
  if (min === null || min === undefined || isNaN(min)) return '?';
  var h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? h + 'h' + m + 'm' : m + 'm';
}

// ── Cloudflare Cron 自动更新 ──

async function updateCfCron(totalRemainingMinutes, thresholdHours) {
  const cfAccountId = process.env.CF_ACCOUNT_ID;
  const cfScriptName = process.env.CF_SCRIPT_NAME;
  const cfApiToken = process.env.CF_API_TOKEN;

  if (!cfAccountId || !cfScriptName || !cfApiToken) {
    console.log('\n⚠️ 未配置完整的 Cloudflare 变量，跳过 Cron 更新');
    return;
  }

  let cronStr = '';
  if (totalRemainingMinutes === null || totalRemainingMinutes < 0 || isNaN(totalRemainingMinutes)) {
    cronStr = '0 */2 * * *';
    console.log('\n⚠️ 账号状态异常或未取得剩余时间，Cron 兜底设为每 2 小时运行: 0 */2 * * *');
  } else {
    const thresholdMins = (thresholdHours || 16) * 60;
    // 提前 30 分钟触发，确保在可续期窗口内触发
    const waitMinutes = Math.max(10, totalRemainingMinutes - (thresholdMins - 30));
    const nextRunUtc = new Date(Date.now() + waitMinutes * 60000);

    const min = nextRunUtc.getUTCMinutes();
    const hour = nextRunUtc.getUTCHours();
    const day = nextRunUtc.getUTCDate();
    const month = nextRunUtc.getUTCMonth() + 1; // getUTCMonth 返回 0-11，需加 1

    cronStr = `${min} ${hour} ${day} ${month} *`;
    console.log(`\n⏱️ 预计下次续期触发时间 (UTC): ${nextRunUtc.toISOString().replace('T', ' ').slice(0, 19)}`);
    console.log(`⏱️ 写入 Cloudflare Worker 的 Cron 表达式: ${cronStr}`);
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/workers/scripts/${cfScriptName}/schedules`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${cfApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ cron: cronStr }])
    });
    if (res.ok) {
      console.log('✅ 成功更新 Cloudflare Worker 的定时触发器！');
    } else {
      console.log(`❌ 更新 Cloudflare Cron 失败: ${res.status} - ${await res.text()}`);
    }
  } catch (e) {
    console.log(`❌ 调用 Cloudflare API 出错: ${e.message}`);
  }
}

// ── Telegram 通知 ──

async function sendTG(statusIcon, statusText, extra, imagePath, proxyStatus) {
  if (!TG_TOKEN || !TG_ID) return;
  extra = extra || '';
  imagePath = imagePath || null;
  proxyStatus = proxyStatus || PROXY_STATUS;
  try {
    var time = getNowJST().toISOString().replace('T', ' ').slice(0, 19);
    var cnTime = new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').slice(11, 16);
    
    var text = 'XServer 延期提醒\n' + statusIcon + ' ' + statusText + '\n' + extra + '\n🌐 网络: ' + proxyStatus + '\n账号: ' + ACC + '\n时间: ' + time + ' (JST) / ' + cnTime + ' (CST)';
    
    if (imagePath && fs.existsSync(imagePath)) {
      var fileData = fs.readFileSync(imagePath);
      var fd = new FormData();
      fd.append('chat_id', TG_ID);
      fd.append('caption', text);
      fd.append('photo', new Blob([fileData], { type: 'image/png' }), path.basename(imagePath));
      var res = await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendPhoto', { method: 'POST', body: fd });
      if (res.ok) console.log('✅ TG 通知已发送');
      else console.log('⚠️ TG 发送失败:', res.status, await res.text());
    } else {
      var res2 = await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_ID, text: text })
      });
      if (res2.ok) console.log('✅ TG 通知已发送');
      else console.log('⚠️ TG 发送失败:', res2.status, await res2.text());
    }
  } catch (e) { console.log('⚠️ TG 发送失败:', e.message); }
}

// ── 页面解析 ──

async function parseRemainingMinutes(page) {
  try {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    var text = await page.evaluate(function() {
      var el = document.querySelector('[class*="remain"], [class*="time"], [class*="period"]');
      if (el) return el.innerText;
      return document.body.innerText;
    });
    var m = text.match(/残り(\d+)時間(\d+)分/);
    if (m) { console.log('⏱️ 剩余时间: ' + m[1] + '小时' + m[2] + '分钟'); return parseInt(m[1]) * 60 + parseInt(m[2]); }
    m = text.match(/残り(\d+)時間/);
    if (m) { console.log('⏱️ 剩余时间: ' + m[1] + '小时'); return parseInt(m[1]) * 60; }
    m = text.match(/(\d+)時間(\d+)分/);
    if (m) { console.log('⏱️ 剩余时间: ' + m[1] + '小时' + m[2] + '分钟'); return parseInt(m[1]) * 60 + parseInt(m[2]); }
    console.log('⚠️ 未找到剩余时间');
    return null;
  } catch (e) { console.log('⚠️ 解析失败:', e.message); return null; }
}

async function parseExtendPage(page) {
  try {
    await page.waitForTimeout(2000);
    var text = await page.textContent('body');
  } catch (e) {
    console.log('⚠️ 未能读取续期页面');
    return { restricted: null, thresholdHours: null, nextDate: null, nextTime: null, nextMinutes: null };
  }

  var thresholdMatch = text.match(/残り契約時間が(\d+)時間を切るまで/);
  var nextMatch = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})以降/);

  if (thresholdMatch) {
    var thresholdHours = parseInt(thresholdMatch[1]);
    var nextDate = nextMatch ? nextMatch[1] : null;
    var nextTime = nextMatch ? nextMatch[2] : null;
    var nextMinutes = nextMatch ? parseInt(nextMatch[2].split(':')[0]) * 60 + parseInt(nextMatch[2].split(':')[1]) : null;
    console.log('🧊 受限: 阈值=' + thresholdHours + 'h, 可续期=' + (nextTime ? nextDate + ' ' + nextTime : '未知'));
    return { restricted: true, thresholdHours: thresholdHours, nextDate: nextDate, nextTime: nextTime, nextMinutes: nextMinutes };
  }

  console.log('✅ 可执行续期');
  return { restricted: false, thresholdHours: null, nextDate: null, nextTime: null, nextMinutes: null };
}

// ── 续期操作 ──

async function tryRenew(page, beforeMins, thresholdHours, proxyStatus) {
  try {
    console.log('🔄 滚动到页面底部...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // 增加 .first() 防御严格模式
    await page.getByRole('link', { name: '期限を延長する' }).first().waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('link', { name: '期限を延長する' }).first().click();
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: '確認画面に進む' }).first().click();
    await page.waitForLoadState('domcontentloaded');

    console.log('🖱️ 执行延期...');
    await page.getByRole('button', { name: '期限を延長する' }).first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: '5_before_back.png' });

    console.log('✅ 延期成功，获取新剩余时间...');
    await page.getByRole('link', { name: '戻る' }).first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: 'success.png' });

    var afterMins = await parseRemainingMinutes(page);
    var beforeH = beforeMins ? fmtHours(beforeMins / 60) : '?';
    var afterH = afterMins ? fmtHours(afterMins / 60) : '?';
    var timeInfo = '续签前 ' + beforeH + ' → 续签后 ' + afterH;
    console.log('⏱️ ' + timeInfo);

    await sendTG('✅', '续签成功', timeInfo, 'success.png', proxyStatus);
    await updateCfCron(afterMins, thresholdHours || 16);
  } catch (e) {
    console.log('⚠️ 未找到延期按钮');
    await page.screenshot({ path: 'skip.png' });
    await sendTG('⚠️', '跳过', '未到时间或无法点击续期按钮', 'skip.png', proxyStatus);
    await updateCfCron(beforeMins, thresholdHours || 16);
  }
}

// ── 主流程 ──

async function runRenew(useProxy) {
  let proxyStatus = useProxy ? (process.env.PROXY_STATUS || '代理') : '直连';
  let proxyInfo = '';
  
  console.log('==================================================');
  console.log('XServer 自动延期 (Cloudflare Cron 版)');
  console.log('==================================================');
  console.log('🌐 网络模式: ' + proxyStatus);

  var launchOpts = { headless: true, channel: 'chrome' };
  
  if (useProxy) {
    // 修正：兼容读取 PROXY_URL 环境变量
    const proxyServer = (typeof process.env.IS_PROXY === 'string' && process.env.IS_PROXY.includes('://'))
      ? process.env.IS_PROXY
      : (process.env.PROXY_URL || process.env.PROXY_SERVER || 'socks5://127.0.0.1:1080');
    launchOpts.proxy = { server: proxyServer };
  }
  
  var browser = await chromium.launch(launchOpts);
  var context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  var page = await context.newPage();

  var thresholdHours = null;
  var success = false;

  try {
    if (useProxy) {
      console.log('🌐 检查代理 IP...');
      try {
        await page.goto('http://ip-api.com/json/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const ipData = JSON.parse(await page.textContent('body'));
        if (ipData.status === 'success') {
          proxyInfo = `${ipData.query} (${ipData.countryCode})`;
          console.log('✅ IP: ' + ipData.query + ', 国家: ' + ipData.country);
          proxyStatus = '代理: ' + proxyInfo;
        }
      } catch (e) { console.log('⚠️ IP 检查失败'); }

      console.log('🌐 测试 XServer 登录页连通性...');
      try {
        const res = await context.request.get(LOGIN_URL, { timeout: 10000 });
        if (!res.ok()) throw new Error(`HTTP 状态码异常 (${res.status()})`);
        console.log('✅ XServer 连通正常');
      } catch (e) {
        const proxyErr = new Error(`代理无法连接 XServer: ${e.message}`);
        proxyErr.isProxyError = true;
        throw proxyErr;
      }
    }

    console.log('🌐 打开登录页面');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.screenshot({ path: '1_navigation.png' });

    console.log('📧 填写账号密码');
    await page.locator('#memberid').fill(ACC);
    await page.locator('#user_password').fill(ACC_PWD);
    await page.screenshot({ path: '1.5_filled.png' });

    console.log('🖱️ 提交登录');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.locator('input[name="action_user_login"]').first().click()
    ]);
    await page.screenshot({ path: '2_after_login.png' });

    console.log('🚀 点击游戏管理');
    await page.getByRole('link', { name: 'ゲーム管理' }).first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({ path: '3_game_manage.png' });

    var totalMins = await parseRemainingMinutes(page);

    console.log('🚀 进入续期页面');
    await page.getByRole('link', { name: 'アップグレード・期限延長' }).first().click();
    await page.screenshot({ path: '4_renew_page.png' });

    var extendInfo = await parseExtendPage(page);

    if (extendInfo.restricted) {
      thresholdHours = extendInfo.thresholdHours || 16;
      console.log(`ℹ️ 尚未达到续期阈值（阈值: ${thresholdHours}小时）`);
      await sendTG('⌛️', '未到续期时间', `当前剩余: ${fmtHours(totalMins ? totalMins / 60 : 0)}`, null, proxyStatus);
      await updateCfCron(totalMins, thresholdHours);
      success = true;
      return success;
    }

    if (DELAY_MS > 0) {
      console.log('⏳ T 延迟 ' + fmtMinutes(Math.round(DELAY_MS / 60000)) + '...');
      await new Promise(function(r) { setTimeout(r, DELAY_MS); });
    }

    console.log('🚀 执行续期');
    await tryRenew(page, totalMins, thresholdHours, proxyStatus);
    success = true;

  } catch (error) {
    console.log('❌ 流程失败: ' + error.message);
    
    // 如果是因为代理被阻断，则不发送失败通知，直接留给直连重试处理
    if (useProxy && error.isProxyError) {
      console.log('ℹ️ 代理节点被屏蔽，准备回退到直连模式...');
    } else {
      try { await page.screenshot({ path: 'failure.png' }); } catch (e) {}
      await sendTG('❌', '运行异常', error.message, 'failure.png', proxyStatus);
      await updateCfCron(-1, -1);
    }
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
  return success;
}

(async function main() {
  if (!ACC || !ACC_PWD) { console.log('❌ 未找到账号或密码'); process.exit(1); }

  let useProxy = USE_PROXY;

  try {
    await runRenew(useProxy);
  } catch (error) {
    if (useProxy) {
      console.log('\n⚠️ 代理模式失败，自动回退到直连模式重试...\n');
      try {
        await runRenew(false);
      } catch (retryError) {
        console.log('❌ 直连模式也失败: ' + retryError.message);
        process.exit(1);
      }
    } else {
      process.exit(1);
    }
  }
})();
