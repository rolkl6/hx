# 滑雪计时 · UI/UX 审查报告

审查日期：2026-09-21 ｜ 对象：https://rolkl6.github.io/hx/ (v1.0.1)
审查者：ui-ux-pro-max skill + WebKit 实测

> ## ✅ 修复状态（v1.1.0，2026-09-21 更新）
>
> | 问题 | 状态 |
> |---|---|
> | P0-1 `#hintClose` 热区 20×19 | ✅ 已修（视觉 22px，热区 44×44） |
> | P0-2 正文字号偏小 | ✅ 已修（最小 10.5px → 12px，语义化分层） |
> | P1-1 `#chipWake` 高 32 | ✅ 已修（→ 46px） |
> | P1-2 删除按钮 43px | ✅ 已修（→ 46px） |
> | P1-3 emoji 当结构性图标 | ✅ 已修（全部换成内联 SVG，零依赖） |
> | P2-1 信息层级偏平 | ✅ 已修（三卡片 → 发丝线分隔组） |
> | P2-2 历史数据无可视化 | ✅ 已做（趋势面积图 + 数据表 + 分趟时长条） |
> | P2-3 空状态无引导 | ✅ 已做（加「去开始第一次滑行」按钮） |
> | P2-4 动效几乎为零 | ✅ 已做（数值 pop / 状态切换强调 / 列表入场 / 图表绘制） |
> | P2-5 关键成功反馈会消失 | ⚠️ 部分（保存后记录页即时落点已有，toast 仍会消失） |
>
> **复测对比**
>
> | 指标 | v1.0.1 | v1.1.0 |
> |---|---|---|
> | 触控热区 < 44px | 3 处 | **0 处** |
> | 结构性 emoji | 6 个 | **0 个** |
> | 最小字号 | 10.5px | **12px** |
> | 对比度问题 | 0 | 0 |
> | iPhone 真实触摸断言 | 54 项 | **61 项全通过** |
>
> 顺带修掉一个只有看截图才会发现的缺陷：**toast 原本正好压住「结束本次并保存」按钮**，已移到顶部。

---

## 一、审查方法

不是"看着感觉"，是**在 iPhone 视口下实测真实渲染值**：

| 手段 | 说明 |
|---|---|
| 引擎 | Playwright **WebKit**（iPhone 同款引擎，不是 Chromium） |
| 设备 | iPhone 14，390×664 CSS px |
| 覆盖 | 计时页 / 记录页(空) / 记录页(有数据) / 设置页 / 弹窗 共 5 个状态 |
| 实测项 | 文字对比度（WCAG 相对亮度 + 多层半透明合成 + **渐变色标取最差**）、触控热区、字号、无障碍名称、横向溢出 |
| 规范依据 | `ui-ux-pro-max` 数据集：`ux-guidelines.csv`、`icons.csv`、`products.csv` |

原始数据：`tests/ux-audit.json`（机器可读，可回归对比）、`tests/ux-audit.txt`

---

## 二、结论速览

| 维度 | 结果 | 说明 |
|---|---|---|
| 文字对比度 (WCAG AA) | ✅ **零问题** | 105 个采样点全部达标，含渐变最差色标 |
| 无障碍名称 | ✅ **零问题** | 33 个可交互元素全部有可访问名称 |
| 横向溢出 | ✅ 无 | 390px 视口下 scrollWidth = 390 |
| `prefers-reduced-motion` | ✅ 已有规则 | |
| 触控热区 | ❌ **3 处不达标** | 其中 1 处低于 WCAG 硬底线 |
| 正文字号 | ❌ **25/35 条声明 < 16px** | 数据集标注 Severity: High |
| 图标 | ❌ **用 emoji 当结构性图标** | 数据集明确禁止 |

---

## 三、问题清单

### 🔴 P0-1　`#hintClose` 热区 20×19 —— 低于 WCAG 硬底线

```
[timer] 20x19  button#hintClose "✕"
```

- WCAG 2.2 Target Size (Minimum) 要求 **24×24 CSS px**，这里是 20×19，**连硬底线都没过**；
- iOS 人机界面指南建议 44×44pt，这里不到一半。

这是安装提示条的关闭按钮。雪花落在屏幕上、戴着手套，基本点不中。

**修法**：保持视觉 20px，用 padding 把热区撑到 44×44。

```css
.hint button {
  min-width: 44px; min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  margin: -12px -8px -12px 0;   /* 抵消 padding，不改变视觉布局 */
}
```

---

### 🔴 P0-2　正文字号普遍偏小（25 条声明 < 16px）

数据集规范原文（Severity: **High**）：

> **Readable Font Size** — Text must be readable on all devices
> Do: **Minimum 16px body text on mobile** ／ Don't: Tiny text on mobile

实测最小的几处：

| 位置 | 字号 | 问题 |
|---|---|---|
| `.tab`（底部标签栏文字） | **10.5px** | 全app最小，且是主要导航 |
| `.mini span`（已滑趟数/上一趟/休息合计 的标签） | **11px** | 核心数据项的说明文字 |
| `.run-tag`（"进行中"） | **11px** | |
| `.s-sub`（记录卡片的"N 趟·最长 X"） | **11.5px** | |
| `.row-sub` / `.s-time` / `.run-time` / `.footnote` / `.chip` | **12px** | 共 8 处 |

**这个 App 有特殊场景**：雪场强光 + 护目镜 + 可能戴手套。对字号的要求应该比一般手机 App **更保守**，而不是更宽松。10.5px 的底部导航在雪地里基本是装饰。

**修法**：分层处理，不是无脑全调 16px——

- **功能性标签**（导航、数据项标签）：`10.5px → 13px`，`11px → 13px`
- **辅助信息**（时间戳、脚注）：`12px → 13px`
- **正文**（说明文字）：`12px → 14px`
- 真正需要 ≥16px 的是**可读段落文本**，本 App 里只有弹窗正文（现 14px）属于这类 → 提到 16px

---

### 🟠 P1-1　`#chipWake` 热区 90×32

```
[timer] 90x32  button#chipWake "屏幕常亮 开"
```

高度 32 < 44pt。这是**主界面上唯一的设置入口**，用户刚上雪道、戴着手套时要按它。虽然过了 WCAG 24px 底线，但对 iOS 主操作来说偏小。

**修法**：`padding: 7px 12px → 13px 16px`，高度到 46px。

---

### 🟠 P1-2　"删除这次记录" 高 43px

```
[recordsWithData] 332x43  button.btn.btn-danger "删除这次记录"
```

只差 1px。实际影响很小，但既然要改 `.btn-sm`，顺手统一到 44+ 更稳。

---

### 🟠 P1-3　用 emoji 当结构性图标

`index.html` 有 6 行含 emoji，实测命中：

```
✕    ⛷️    📋记录    📋    ⚙️设置    ⚙️
```

数据集规范（App UI 通用规则）：

> **No Emoji as Structural Icons**
> Do: Use vector-based icons (Phosphor / Heroicons)
> Don't: Using emojis (🎨 🚀 ⚙️) for navigation, settings, or system controls
> Why: **Emojis are font-dependent, inconsistent across platforms, and cannot be controlled via design tokens.**

具体问题：

- `⏱ 📋 ⚙️` 在不同系统/版本上可能是**彩色 emoji**，也可能是**黑白字形**，还可能缺字形显示成方框 —— 底部导航长什么样完全不由我控制；
- emoji 的颜色无法用 CSS 控制，所以选中态只能靠外层文字变色，图标本身不跟随；
- `⛷️` 带变体选择符，在部分字体下渲染成两个字符宽度，破坏品牌区的基线对齐。

数据集推荐用 **Phosphor**（`icons.csv` 命中：`gear` 用于设置、`arrow-left` 用于返回等，均为 Outline 风格）。本项目是纯静态无构建，直接内联 SVG 更合适（零依赖、可控粗细、可 `currentColor` 跟随主题色）。

---

### 🟡 P2　体验提升（不是缺陷，是"还能更好"）

**P2-1 信息层级偏平**
主计时 60px 很突出没问题，但「已滑趟数 / 上一趟 / 休息合计」三个小卡的数字（19px）和标签（11px）权重几乎一致，扫视时三个数字竞争注意力，没有主次。

**P2-2 历史数据没有可视化**
数据集里 `charts.csv` 有 25 种图表类型。当前记录页是纯文字列表，「滑行时长趋势」和「单日分趟分布」是天然的图表素材 —— 用户滑了一个雪季之后，最想看的就是趋势。

**P2-3 空状态没有引导**
`"还没有分趟记录"` + 一行小字。没告诉用户"下一步该做什么"。

**P2-4 动效几乎为零**
只有 `fade` 一个 0.22s 入场。数据集建议 150–300ms 的微交互。关键缺口：
- 按钮按下已有 `scale(.975)` ✅
- 趟数 +1 时数字是**瞬间跳变**，没有过渡
- 从"滑行中"切到"休息中"，hero 区背景色变了但没有强调

**P2-5 关键成功反馈会消失**
"已保存 · 滑行 30 分钟 · 2 趟" 只以 2 秒 toast 呈现，消失后没有任何持久落点。用户滑完一天，最想知道的是"今天到底滑了多久"，这个信息应该立刻、显眼、持续地出现。

---

## 四、我在本次审查中纠正的两处误报

必须说明，因为**一份带误报的审查比没有审查更糟**：

| v1 误报 | 原因 | v2 修正 |
|---|---|---|
| `#btnPrimary` 对比度 **1.04:1** | `backgroundColor` 对渐变按钮返回 `transparent`，脚本一路走到页面底色 | 解析 `backgroundImage` 的色标，对每个色标算对比度取最差值 → **实际全部达标** |
| 开关 `50×30` 热区不足 | 只量了 `<input>`，但外层 `<label class="row">` 整行可点 | `effectiveTarget()` 取实际可点区域 → **实际热区 ~59px 高，达标** |

同时，`ui-ux-pro-max` 给出的设计系统建议里，**PATTERN（Feature-Rich Showcase）和 COLORS（橙色 #F97316）我判定为错配** —— 那是 landing page 模式和消费娱乐类配色，对一个数据记录工具不适用。我只采纳了它的 **TYPOGRAPHY 建议（Barlow / Barlow Condensed，数据集标注 "sports, fitness, athletic, energetic, condensed, action"）**，这一条确实贴合滑雪场景。

---

## 五、建议的修改顺序

| 阶段 | 内容 | 工作量 | 风险 |
|---|---|---|---|
| **1** | P0-1 关按钮热区 + P0-2 字号分层调整 | 小 | 低（纯 CSS） |
| **2** | P1-1 / P1-2 热区统一 + P1-3 内联 SVG 图标替换 emoji | 中 | 中（要动 HTML） |
| **3** | P2-5 保存结果持久化 + P2-3 空状态引导 | 中 | 低 |
| **4** | P2-2 记录页加趋势图 + P2-1 层级重构 + P2-4 动效 | 大 | 中 |

**每一阶段都会跑：** `logic-test.mjs`（71 断言）+ `ios-e2e.mjs`（54 断言，真实触摸）+ `ux-audit.mjs`（量化回归）。

---

## 六、复跑命令

```powershell
# 量化审查（需要 playwright，在含 node_modules 的目录运行）
node tests/ux-audit.mjs https://rolkl6.github.io/hx/index.html

# iPhone 真实触摸端到端
node tests/ios-e2e.mjs https://rolkl6.github.io/hx/index.html

# 逻辑单元测试（无依赖）
node tests/logic-test.mjs
```
