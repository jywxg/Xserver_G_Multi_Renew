# XServer 游戏服务器自动续签

自动延长 XServer Game VPS 实例期限，支持多账号、代理和 Telegram 通知。

**核心特性：**
- 🧠 **自适应续期阈值** — 自动读取续期页面，无需配置套餐类型
- 🔄 **状态持久化** — 预约日期精确写入 `status.json`，非预约日秒退
- ⏱ **可配置延迟** — 通过 `T` 变量自定义定时/随机延迟
- 📸 **失败截图** — 每次运行自动截图保存，便于排查

---

## 📋 前期准备：关闭邮件验证

> ⚠️ **重要**：请严格按照以下步骤操作，否则脚本可能因邮件验证而失败。

### 1. 点击「账户」

<img width="1818" height="501" alt="image" src="https://github.com/user-attachments/assets/f774ea20-ba10-4913-b01f-e0107bce9e94" />

### 2. 点击「查看和编辑注册信息」

<img width="874" height="546" alt="image" src="https://github.com/user-attachments/assets/c8c332d3-1e81-457b-9328-5e6971c31c42" />

### 3. 修改「可疑登录期间的身份验证」为「无效的」

<img width="1431" height="327" alt="image" src="https://github.com/user-attachments/assets/05039890-8cf9-4d04-a334-189a1daf11ba" />

---

## 🚀 使用方法

### 第一步：Fork 本仓库

点击右上角 **Fork** 按钮，将项目复制到你的 GitHub 账户。

### 第二步：配置 Secrets

进入你 Fork 的仓库：**Settings → Secrets and variables → Actions**

点击 **New repository secret**，添加以下配置：

| Secret | 必填 | 说明 |
|:---|:---:|:---|
| `EML_1` | ✅ | 第 1 个账号的登录邮箱或 ID |
| `PWD_1` | ✅ | 第 1 个账号的密码 |
| `EML_2` / `PWD_2` | ❌ | 第 2 个账号（以此类推，不限数量） |
| `T` | ❌ | 延迟控制（见下方说明） |
| `TG_TOKEN` | ❌ | Telegram Bot Token（从 @BotFather 获取） |
| `TG_ID` | ❌ | 接收通知的用户/群组 ID |
| `NODE_LINK` | ❌ | 代理链接 |

#### T 延迟控制

进入可续期窗口后，在签到的**前一刻**插入延迟。

| 值 | 行为 | 示例 |
|:---|:---|:---|
| **不设置** | 无延迟，立即签到 | — |
| **单个数字** | 固定延迟 N 分钟 | `T=15` → 固定等 15 分钟 |
| **A-B 范围** | 随机延迟 A~B 分钟 | `T=10-60` → 随机等 10~60 分钟 |

> **手动触发**（`Run workflow`）时 T 延迟自动跳过，即点即签。

#### 多账号配置示例

```
EML_1 = account1@example.com
PWD_1 = password1
EML_2 = account2@example.com
PWD_2 = password2
```

#### 代理格式示例

支持 Base64 编码和明文两种格式：

```
socks5://user:pass@server:port
http://user:pass@server:port
vless://uuid@server:port?security=tls&sni=domain.com
vmess://eyJhZGQiOiIxMjcuMC4wLjEiLCJpZCI6InV1aWQifQ==
tuic://uuid:password@server:port?sni=domain.com
hy2://password@server:port?sni=domain.com
```

### 第三步：运行

#### 自动运行

脚本每天 JST **07:00 / 15:00 / 23:00**（北京时间 06:00 / 14:00 / 22:00）自动执行，一天轮询 3 次避免错过签到窗口。

#### 手动运行

1. 进入 **Actions** 页面
2. 选择 **XServer Extend (Node.js Matrix)**
3. 点击 **Run workflow**

---

## 🧠 自适应调度逻辑

脚本不再依赖硬编码的套餐类型，而是直接从**续期页面**获取规则。

### 流程

```
登录 → 游戏管理 → 进入续期页面
                    │
        ┌───────────┴───────────┐
        │                       │
   受限（页面有提示）        可续期
        │                       │
  ┌─────┼─────────┐       应用 T 延迟
  │     │         │       tryRenew()
 未来  今天时间  剩余>阈值   ├─ 续签成功
 日期  未到        │       └─ 按钮未出现
  │     │         │
 预约  设今天为   预约几天
 那天  预约日     后复查
      cron轮询
      (每天3次)
```

### 核心能力

- **自动读取阈值** — 页面显示「残り契約時間が 16 時間を切るまで…」，脚本自动解析阈值，无需配置套餐
- **精确日期优先** — 页面给出「2026-06-10 20:40 以降にお試しください」时，直接预约到该天
- **续期后动态计算** — 根据续期后的新剩余时间与阈值之差，动态算出下次检查日，替代写死天数

---

## 💾 状态持久化

脚本通过 `status.json` 记住每个账号的预约日期：

```json
{
  "account@example.com": {
    "nextCheckDate": "2026-06-10",
    "lastSuccess": 1742380800000
  }
}
```

- **非预约日期** — GitHub Actions 触发时直接秒退，不启动浏览器
- **预约日期到达** — 启动浏览器，登录后进入续期页面
- **续签成功** — 自动根据新剩余时间计算下次预约日，并 git push 更新状态

---

## 🤖 Telegram 通知

| 图标 | 状态 | 说明 |
|:---:|:---|:---|
| ✅ | 续签成功 | 实例已延期，显示续签前后剩余时间对比 |
| 🧊 | 冷却等待 | 页面受限，有精确的可续期时间 |
| 🔭 | 探测跳过 | 剩余时间充足，预约 N 天后检查 |
| 🎲 | 随机延迟 | 设置了 T 范围延迟 |
| ⏳ | 固定延迟 | 设置了 T 固定延迟 |
| 🕐 | 等待中 | 首次运行，延期按钮未出现 |
| ⚠️ | 跳过 | 未到续签时间 |
| ❌ | 失败 | 出现错误 |

---

## ❓ 常见问题

### 签到失败怎么办？

1. 检查是否已关闭邮件验证功能（见「前期准备」）
2. 检查账号密码是否正确
3. 检查代理是否可用（如配置了代理）
4. 查看 Actions 日志和截图

### 如何查看截图？

每次运行后，进入 **Actions** → 点击对应记录 → 下载 **Artifacts** 中的截图压缩包。

### 支持多少个账号？

无限制。按顺序添加 `EML_1`/`PWD_1`、`EML_2`/`PWD_2` … 即可。每个账号独立计算剩余时间和预约日期。

### 为什么有时候脚本秒退？

如果今天不是某个账号的预约日期（`nextCheckDate`），脚本会直接退出，不启动浏览器，不消耗 GitHub Actions 额度。

### 需要设置套餐类型吗？

不需要。脚本自动从续期页面读取阈值（如 16h），适配任意套餐。

---

## ⚠️ 注意事项

- 首次使用建议手动触发一次，确认配置正确
- GitHub Actions 不支持 IPv6，如需访问 IPv6 节点请使用代理

---

## 🌟 鸣谢

感谢 [XCQ0607/Xserver_script](https://github.com/XCQ0607/Xserver_script) 项目提供的 Node.js 签到思路。
