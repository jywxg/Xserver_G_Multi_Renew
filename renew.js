const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Environment variables
const ACC = process.env.ACC || process.env.EML;
const ACC_PWD = process.env.ACC_PWD || process.env.PWD;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_ID = process.env.TG_ID;
const PROXY_URL = process.env.PROXY_URL;

const LOGIN_URL = 'https://secure.xserver.ne.jp/xapanel/login/xmgame';
const STATUS_FILE = 'status.json';

if (!ACC || !ACC_PWD) {
  console.log('❌ 致命错误：未找到账号或密码环境变量！');
  process.exit(1);
}

// Load status
function loadStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

// Save status
function saveStatus(data) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

// Send TG notification
async function sendTG(statusIcon, statusText, extra = '', imagePath = null) {
  if (!TG_TOKEN || !TG_ID) return;
  try {
    const time = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const text = `🖥 XServer 延期提醒\n${statusIcon} ${statusText}\n${extra}\n账号: ${ACC}\n时间: ${time}`;
    
    const url = imagePath
      ? `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`
      : `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    
    const body = imagePath
      ? { chat_id: TG_ID, caption: text, photo: fs.createReadStream(imagePath) }
      : { chat_id: TG_ID, text };
    
    const headers = imagePath ? {} : { 'Content-Type': 'application/json' };
    
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: imagePath ? Object.entries(body).reduce((fd, [k, v]) => { fd.append(k, v); return fd; }, new FormData()) : JSON.stringify(body)
    });
    
    if (res.ok) console.log('✅ TG 通知已发送');
  } catch (e) {
    console.log('⚠️ TG 发送失败:', e.message);
  }
}

// Main renewal logic
(async () => {
  console.log('='.repeat(50));
  console.log('XServer 自动延期');
  console.log('='.repeat(50));

  // Check 48h + random 6h timing
  if (process.env.GITHUB_EVENT_NAME === 'schedule') {
    const status = loadStatus();
    const lastSuccess = status[ACC]?.lastSuccess || 0;
    const now = Date.now();
    
    if (lastSuccess && now < lastSuccess + 48 * 3600 * 1000) {
      console.log(`⏳ 冷却中，跳过 ${ACC}`);
      process.exit(0);
    }
    
    const delaySec = Math.floor(Math.random() * 6 * 3600);
    console.log(`🕒 随机延迟: ${Math.floor(delaySec / 3600)}小时${Math.floor((delaySec % 3600) / 60)}分钟...`);
    await new Promise(r => setTimeout(r, delaySec * 1000));
  }

  // Browser launch options
  const launchOpts = {
    headless: true,
    channel: 'chrome',
  };
  
  if (PROXY_URL) {
    launchOpts.proxy = { server: 'http://127.0.0.1:8080' };
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // Check proxy IP
    if (PROXY_URL) {
      console.log('🌐 正在检查代理 IP...');
      try {
        await page.goto('https://api.ipify.org/?format=json', { timeout: 15000 });
        const ipData = JSON.parse(await page.textContent('body'));
        console.log(`✅ 当前 IP: ${ipData.ip}`);
      } catch (e) {
        console.log('⚠️ IP 检查失败，继续执行...');
      }
    }

    // Navigate to login
    console.log(`🌐 打开登录页面: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: '1_navigation.png' });

    // Login
    console.log('📧 填写账号密码...');
    await page.locator('#memberid').fill(ACC);
    await page.locator('#user_password').fill(ACC_PWD);
    await page.screenshot({ path: '1.5_filled.png' });

    // Submit login
    console.log('🖱️ 提交登录...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.locator('input[name="action_user_login"]').click()
    ]);
    
    await page.screenshot({ path: '2_after_login.png' });

    // Click game management
    console.log('🚀 点击游戏管理...');
    await page.locator('a:has-text("ゲーム管理"), a[href*="xmgame"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '3_game_manage.png' });

    // Click upgrade/extend
    console.log('🚀 点击延期...');
    await page.locator('a:has-text("アップグレード・期限延長"), a[href*="renew"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '4_renew_page.png' });

    // Try to click extend button
    try {
      await page.locator('a:has-text("期限を延長する")').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('a:has-text("期限を延長する")').click();
      await page.waitForLoadState('networkidle');
      
      // Confirm
      await page.locator('button:has-text("確認画面に進む")').click();
      await page.waitForLoadState('networkidle');
      
      // Final extend
      console.log('🖱️ 执行延期...');
      await page.locator('button:has-text("期限を延長する")').click();
      await page.waitForLoadState('networkidle');
      
      console.log('✅ 延期成功！');
      
      // Update status
      const status = loadStatus();
      status[ACC] = { lastSuccess: Date.now() };
      saveStatus(status);
      
      await page.screenshot({ path: 'success.png' });
      await sendTG('✅', '续签成功', 'XServer 实例已延期', 'success.png');
      
    } catch (e) {
      console.log('⚠️ 未找到延期按钮，可能已完成');
      await page.screenshot({ path: 'skip.png' });
      await sendTG('⚠️', '自动跳过', '未发现延期按钮', 'skip.png');
    }

  } catch (error) {
    console.log(`❌ 流程失败: ${error.message}`);
    await page.screenshot({ path: 'failure.png' });
    await sendTG('❌', '续签失败', error.message, 'failure.png');
  } finally {
    await context.close();
    await browser.close();
  }
})();
