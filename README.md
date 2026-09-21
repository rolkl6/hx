# ⛷️ 滑雪计时 · Ski Timer

一个记录**滑雪时长**的网页应用（PWA）。部署一次，在 iPhone 上「添加到主屏幕」，
就和原生 App 一样全屏运行、**离线可用**、数据只存在自己手机里。

> ### 🚀 线上地址：<https://rolkl6.github.io/hx/>
>
> 直接用 **iPhone Safari** 打开上面这个链接 → 分享 → 添加到主屏幕，即可使用。
> （部署在 GitHub Pages 上，仓库：<https://github.com/rolkl6/hx>）

- **净滑行时长**：休息/坐缆车的时间自动扣除，只算真正在滑的时间
- **分趟记录**：每趟单独计时，随时看这一趟滑了多久
- **历史统计**：累计滑行时长、总趟数、滑雪天数、最长一趟
- **数据自己拿得走**：CSV 表格导出 + JSON 完整备份/恢复
- **为雪场设计**：深色界面、超大字号、超大按钮（戴手套也能按）、屏幕常亮、提示音

---

## 一、部署到 iPhone（约 5 分钟）

浏览器要能「添加到主屏幕」并离线工作，必须通过 **HTTPS** 访问。
下面任选一种，都是免费的。

### 方式 A：GitHub Pages（推荐，免费稳定）

1. 打开 https://github.com 注册/登录。
2. 右上角 **+ → New repository**
   - Repository name 填 `ski-timer`
   - 选 **Public**
   - 点 **Create repository**
3. 在仓库页面点 **uploading an existing file**，把 `ski-timer` 文件夹里的
   **所有文件和 `icons` 文件夹**一起拖进去（要保持 `icons/` 这个层级），
   然后点 **Commit changes**。

   > 用 Git 命令行也可以，更不容易漏文件：
   > ```bash
   > cd ski-timer
   > git init && git add . && git commit -m "ski timer"
   > git branch -M main
   > git remote add origin https://github.com/<你的用户名>/ski-timer.git
   > git push -u origin main
   > ```

4. 仓库 **Settings → Pages**
   - Source 选 **Deploy from a branch**
   - Branch 选 **main**，目录选 **/ (root)**，点 **Save**
5. 等 1～2 分钟，刷新页面，顶部会出现网址：
   `https://<你的用户名>.github.io/ski-timer/`

### 方式 B：Netlify Drop（最快，拖一下就上线）

1. 打开 https://app.netlify.com/drop
2. 把整个 `ski-timer` 文件夹拖进页面
3. 立刻得到一个 `https://xxxx.netlify.app` 网址（想长期保留需要注册并 Claim 站点）

### 方式 C：Cloudflare Pages / Vercel

同样是把 `ski-timer` 文件夹作为静态站点上传，构建命令留空、输出目录填 `/`。

### 在 iPhone 上安装

1. 用 **Safari**（必须 Safari，微信/Chrome 内置浏览器不行）打开上面的网址。
2. 点底部中间的 **分享按钮**（方框 + 向上箭头）。
3. 往下滑，点 **「添加到主屏幕」** → **添加**。
4. 回到主屏幕，点新出现的「滑雪计时」图标即可。
   - 全屏运行，没有地址栏
   - 飞行模式/没信号也能打开（离线缓存）

> 打开网页时如果顶部出现蓝色提示条，就是提醒你做这一步。

---

## 二、怎么用

| 场景 | 操作 |
| --- | --- |
| 到雪场，准备开滑 | 点 **「开始滑雪」** |
| 一趟滑完 / 上缆车 | 点 **「结束这趟 · 休息一下」** |
| 休息完，准备下一趟 | 点 **「开始下一趟」** |
| 今天收工 | 点 **「结束本次并保存」** |

- 屏幕正中间的大数字 **始终是「本次滑行总时长」**，休息时不会增加。
- 下方小药丸显示当前这一趟 / 休息已经过了多久。
- 「记录」页可以看到全部历史，点任意一条展开看每趟明细，也能单独删除。

---

## 三、iPhone 上的注意事项

- **切后台 / 锁屏不会少算时间。**
  所有计时都基于系统时间戳计算，不是靠页面上的秒表累加。iOS 暂停页面刷新后，
  回到前台会自动补正（暂停多久补多久）。
- **屏幕常亮**需要 **iOS 16.4 或更高**。若无效，检查是否开了「低电量模式」——
  低电量模式会禁用屏幕常亮。
- **必须「添加到主屏幕」才是全屏**；在 Safari 里直接打开会有地址栏。
- **数据只存在这台手机里**，不上传任何服务器。
  清理 Safari 网站数据、删掉主屏幕图标、换手机都会导致记录丢失。
  建议每次滑完去 **设置 → 导出 JSON 备份** 存一份到「文件」App 或微信收藏。
- **网页做不到真正的后台 GPS/海拔记录。** 想要自动记录落差、距离、速度曲线，
  需要原生 App 或 Apple Watch。这个工具专注把「滑了多久」记准。

---

## 四、文件结构

```
ski-timer/
├── index.html              页面结构
├── styles.css              深色移动端样式
├── app.js                  全部逻辑（计时状态机 / 统计 / 导入导出）
├── sw.js                   Service Worker，离线缓存
├── manifest.json           PWA 清单（图标、全屏、主题色）
├── icons/                  App 图标
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   ├── apple-touch-icon.png
│   └── favicon-32.png
├── tools/
│   └── make-icons.mjs      重新生成图标（node tools/make-icons.mjs）
└── tests/
    ├── logic-test.mjs      逻辑单元测试（不需要浏览器，71 项断言）
    ├── live-check.mjs      线上部署验证（HTTPS / PWA 装配 / 断网重载）
    ├── cdp-smoke.mjs       本地端到端测试（无头浏览器）
    ├── run-smoke.ps1       Windows 下启动无头浏览器跑上面两个脚本
    └── live-report.txt     最近一次线上验证报告
```

---

## 五、本地预览 / 二次开发

```bash
cd ski-timer
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

同一 WiFi 下手机也能访问 `http://<电脑局域网IP>:8080` 看效果，
但没有 HTTPS，**不能**「添加到主屏幕」离线安装。

### 改完代码后必须做的事

改完文件重新上传后，请把 `sw.js` 第一行的版本号加一：

```js
const VERSION = 'v1.0.1';   // 原来是 v1.0.0
```

否则手机上可能还在用旧的缓存版本。改完在手机上重新打开一次即可更新。

### 跑测试

```bash
node tests/logic-test.mjs
```

用最小 DOM 桩加载真实的 `app.js`，模拟点击并断言界面与存储结果，
覆盖：计时状态机、净滑行时长计算、分趟记录、历史统计、删除记录、
冷启动恢复未结束的计时、超 18 小时陈旧会话的处理。

---

## 六、数据格式

存在浏览器 `localStorage` 的 `ski.sessions.v1`，结构如下（JSON 备份就是这个）：

```json
[
  {
    "id": "S1737000000000-abc12",
    "startedAt": 1737000000000,
    "endedAt":   1737018000000,
    "runs": [
      { "start": 1737000000000, "end": 1737000600000, "ms": 600000 }
    ],
    "skiMs": 600000,
    "restMs": 300000,
    "maxRunMs": 600000,
    "createdAt": 1737018000000
  }
]
```

单位都是毫秒。导出的 CSV 用 UTF-8 BOM，Excel / Numbers 直接打开不会乱码。
