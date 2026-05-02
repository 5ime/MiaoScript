# 喵喵日志·周志自动填写助手

适用于 [校友邦](https://m.xybsyw.com/) 的日志 / 周志自动填写助手 

## 功能概览

| 快捷键 | 模式 | 说明 |
|--------|------|------|
| **Alt+1** | 日志 | 跳转日志列表 → 新建 → 按篇填写并保存草稿 |
| **Alt+2** | 周志 | 跳转周志列表 → 新建 → 按篇填写并保存草稿 |

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 新建脚本，将 `miao_script.js` 全文粘贴保存。
3. 确认脚本详情里 **已启用**，且匹配域名包含 `https://m.xybsyw.com/*`。

脚本含 `@grant GM_xmlhttpRequest` 与 `@connect 127.0.0.1`，用于读取本机文本。

## 本地文本服务（必读）

脚本默认从 **`http://127.0.0.1/`** 拉取文件：

- `http://127.0.0.1/1.txt` → 第 1 篇  
- `http://127.0.0.1/2.txt` → 第 2 篇  
- 以此类推。

请在本机起一个**静态文件服务**，把 `1.txt`、`2.txt` 放在站点根目录（或按需改配置里的路径前缀）。例如：

- Python：`python -m http.server 80`（在项目目录执行，注意端口与 `localTextBaseUrl` 一致）
- 任意可将目录映射到 `http://127.0.0.1:端口/` 的工具

在 `miao_script.js` 的 **`BASE_CONFIG`** 中修改：

```js
localTextBaseUrl: 'http://127.0.0.1/',
```

若使用其它端口，例如 `8080`，改为 `'http://127.0.0.1:8080/'`，并在 Tampermonkey 脚本设置里把 **`@connect`** 扩展为对应主机端口（若跨域受限）。

## 文本格式

### 日志（Alt+1）

关联**日历日期**由脚本配置推算（见下文「日志日期」），**不需要**在 txt 里写「时间：」。

```
标题：你的标题
内容：正文支持多行……
```

### 周志（Alt+2）

```
标题：你的标题
内容：正文支持多行……
```

周次由配置里的 **`startWeek`** 与篇序号推算：`1.txt` 对应第 `startWeek` 周，依次递增。

## 配置说明（编辑 `miao_script.js`）

### 全局 `BASE_CONFIG`

| 字段 | 含义 |
|------|------|
| `localTextBaseUrl` | 本地 txt 的 URL 前缀 |
| `waitTimeout` | 等待页面元素的超时（毫秒） |
| `waitInterval` | 轮询间隔（毫秒） |
| `retryCount` | 单篇填写失败时的重试次数（**始终针对当前这篇 txt**，不会跳到下一篇） |
| `finalAction` | 仅 **`draft`**（默认，保存草稿箱）或 **`submit`**（提交）。 |

### 日志 `MODES.daily`

| 字段 | 含义 |
|------|------|
| `listUrl` | 日志列表页地址（一般无需改） |
| `startTime` | **必填**，`YYYY-MM-DD`。第 1 篇（`1.txt`）对应的关联日期 |
| `endTime` | `YYYY-MM-DD`，与 `startTime` 共同限制「日期区间天数」，用于**裁减**本次上传篇数 |
| `uploadCount` | 希望最多上传几篇；实际篇数 = **min(uploadCount, 日期区间内天数)** |
| `uploadCount` 外的字段 | 弹窗文案等，一般不用动 |

**日志日期规则：** `1.txt` → `startTime`，`2.txt` → 次日，以此类推；不得超出 `endTime`（若配置了合法结束日期）。

### 周志 `MODES.weekly`

| 字段 | 含义 |
|------|------|
| `listUrl` | 周志列表页（注意站点路径可能是 `weeklyJounal` 拼写） |
| `startWeek` / `endWeek` | 教学周范围；实际篇数 = **min(uploadCount, endWeek − startWeek + 1)** |
| `uploadCount` | 最多读几篇 txt |

## 运行流程简述

1. 快捷键触发 → 若不在列表页则跳转列表页 → 点击「新建」→ 进入编辑页。  
2. 若出现「未保存」类弹窗，脚本会尝试点「重新填写」。  
3. 按篇请求本地 txt → 填标题、关联周期（日志选日 / 周志选周）、正文、权限 → 按 `finalAction` 点「保存草稿箱」或「提交」。  
4. 检测到「提交成功」弹窗后计为一篇成功；若还需多篇则再次「新建」并重复。

控制台会以 `[喵喵日志助手]` / `[喵喵周志助手]` 等前缀输出日志，便于排查。

## 常见问题

- **一直提示本地文本拉取失败：** 检查本机 HTTP 是否监听、`localTextBaseUrl` 是否与浏览器访问地址一致、Tampermonkey 是否允许访问 `127.0.0.1`。  
- **日志报错 startTime：** 必须为合法 `YYYY-MM-DD`。  
- **篇数比预期少：** 日志看日期区间、周志看周范围是否把 `uploadCount` **裁减**了。  
