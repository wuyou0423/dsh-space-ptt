# dsh-space-ptt

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的「语音输入」加一个**对讲机键**：

> 按住空格说话 → 松手 → 识别 → 自动发送。

不用先点输入框、不用点麦克风、不用点发送。打开窗口，直接按住空格就能说。

## 演示流程

```
打开 DSH（焦点在哪都行）
  ↓ 按住空格
开始录音（输入框自动获得焦点）
  ↓ 松手
停止识别 → 自动插入文字 → 自动发送
```

## 安装

### 直接从 GitHub 安装（不需要 npm）

```bash
dsh plugin --profile desktop add "github:wuyou0423/dsh-space-ptt"

# 或者指定分支
dsh plugin --profile desktop add "github:wuyou0423/dsh-space-ptt#main"
```

### 从 npm（发布到 npm 后可用，插件市场靠这个收录）

```bash
dsh plugin --profile <你的 profile> add dsh-space-ptt
```

### 从本地目录

```bash
dsh plugin --profile <你的 profile> add "link:./dsh-space-ptt"
```

装完**重启 DSH**（Host 半边是空壳，主要是让客户端 bundle 生效）。

## 前置条件

1. 启用官方 Bundle **语音输入**（`@deepseek-ai/dsh-experimental-voice-input-bundle`）
2. 在设置里把语音模型「下载并准备」好 —— 麦克风按钮得能点开

不满足时插件**完全不接管空格**，你的空格照常是空格。

## 行为细节

| 场景 | 行为 |
| --- | --- |
| 焦点不在输入框，按空格 | 自动聚焦输入框 → 开始录音（全局模式） |
| 输入框里有草稿 | 不接管，空格照常输入 |
| 有弹窗 / 对话框打开 | 不接管 |
| 按住不到 250ms 就松手 | 当误触，取消录音，不发送 |
| 录音中按 Esc | 取消本次录音 |
| 录音中切走窗口（Alt+Tab） | 自动取消，不会卡在录音态 |
| 识别结果为空 | 不发送 |
| 识别超时 30s | 不发送，转写留在草稿里 |
| 中文输入法选词时按空格 | 不接管（检测 `isComposing`） |

## 配置

`lib/client.js` 顶部有一小块常量，改完刷新页面即可：

| 常量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTO_SEND` | `true` | `false` = 只把转写放进草稿，不自动发送 |
| `MIN_HOLD_MS` | `250` | 最短按住时长，短于此当误触 |
| `STOP_TIMEOUT_MS` | `30000` | 等待识别结果的上限 |
| `GLOBAL_SPACE` | `true` | `false` = 恢复成「必须先点进输入框」 |
| `POLL_MS` | `120` | 轮询识别状态的间隔 |

## 它怎么实现的（为什么不用内部 API）

插件不 import 宿主内部模块，而是通过**官方 UI 上的无障碍标签**找到按钮并点击：

| 目标 | `aria-label` | 来源包 |
| --- | --- | --- |
| 开始录音 / 停止并识别 / 取消 | 同名 | `@deepseek-ai/dsh-experimental-client-ui-voice-input` |
| 插入文字 | `插入文字` / `Insert text` | 同上 |
| 发送消息 | `发送消息` / `Send message` | `@deepseek-ai/dsh-client-ui-conversation` |

这样升级宿主时大概率不会碎；如果官方改了文案，改 `SEL_*` 常量即可。

### 两个踩过的坑

1. **按住时的键盘重复事件**：只拦第一个 keydown 不够，浏览器会持续发 repeat 事件，空格会灌进输入框。一旦草稿被改动，语音插件就不肯自动插入，只能手动点「插入文字」。所以录音期间必须持续 `preventDefault`。
2. **识别完不一定自动插入**：语音插件检测到草稿被改过时，会改成保留结果 + 让用户点「插入文字」。插件会替用户点这个按钮兜底。

## 边界与风险

- 依赖官方 UI 的 `aria-label`，属**外部契约**，宿主大版本升级后需要回归一次。
- 全局空格意味着页面焦点在空白处按空格会启动录音；不想要就设 `GLOBAL_SPACE = false`。
- 只在 Web / 桌面端 Web UI 生效（`dsh.client.platform: web`）。

## 开发

```bash
# 本地 link 安装
dsh plugin --profile desktop add "link:/path/to/dsh-space-ptt"
# 改 lib/client.js 后刷新页面
```

## 插件市场索引

本仓库自带一个 **DSH 插件市场索引**（format 1，git 源），不经过 npm 也能在「插件 → 发现」里浏览安装：

```
https://raw.githubusercontent.com/wuyou0423/dsh-space-ptt/main/market/index.json
```

在 DSH：**插件 → 发现 → 添加索引源**，粘贴上面的 URL，刷新即可看到「按住空格说话（对讲机）」。

索引文件在 [`market/index.json`](market/index.json)，格式由 `@deepseek-ai/dsh-plugin-market-index` 校验。

## License

MIT
