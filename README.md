# 🐼 熊猫抖音创作者中心数据抓取器

[![Userscript](https://img.shields.io/badge/Userscript-v8.2.0-10b981)](./panda-douyin-creator-scraper.user.js)
[![CI](https://github.com/GoodWay0223/panda-douyin-creator-scraper/actions/workflows/ci.yml/badge.svg)](https://github.com/GoodWay0223/panda-douyin-creator-scraper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

一个运行在 Tampermonkey（油猴）中的抖音创作者中心作品数据抓取工具。它会自动滚动“内容管理 → 作品”列表，汇总播放、点赞、评论和分享等数据，并支持直接粘贴到 Excel。

> 本项目不是抖音官方产品。页面结构随时可能调整，请勿将它用于违反平台规则或相关法律法规的用途。

## 一键安装

已安装 Tampermonkey 后，点击：

**[安装熊猫抖音抓取器](https://raw.githubusercontent.com/GoodWay0223/panda-douyin-creator-scraper/main/panda-douyin-creator-scraper.user.js)**

适用页面：

```text
https://creator.douyin.com/creator-micro/content/manage
```

## 主要功能

- 自动识别新版创作者中心的独立作品滚动容器并持续加载。
- 按“播放 / 阅读 / 浏览 / 点赞 / 评论 / 分享”等字段语义解析，不依赖易变化的完整哈希类名。
- 稳定去重；同一作品数据变化时更新原记录。
- 支持关键词搜索、全选、范围选择和删除本地列表项。
- 抓取结束后弹出有效作品数及四项核心数据汇总。
- 汇总数字可在“完整整数”和“万”之间切换。
- 一键复制为 TSV，可直接粘贴至 Excel。
- 支持拖拽、最小化、最大化、页面序号标记和面板位置记忆。
- UI 使用 Shadow DOM 隔离，减少与抖音页面样式冲突。

## 使用方法

1. 在 Chrome 中安装并启用 Tampermonkey。
2. 通过上方链接安装脚本，然后刷新抖音创作者中心。
3. 进入“内容管理 → 作品”，等待首屏列表加载完成。
4. 点击“启动自动抓取”。
5. 等待脚本自动滚动并弹出完成汇总。
6. 点击“导出数据（粘贴至 Excel）”，在 Excel 中按 `Ctrl + V`。

完整抓取过程中不要切换作品状态、体裁、时间或搜索条件。若只想抓取某个筛选结果，请先设置筛选条件，等待列表稳定后再启动。

## 设置菜单

右上角齿轮按钮包含：

- **汇总数字显示“万”**：只改变顶部汇总及完成弹窗，导出仍保留完整整数。
- **结束后回到原位置**：停止或完成后恢复启动前的列表位置。
- **复制诊断**：复制不含作品标题的解析诊断，便于反馈页面兼容问题。
- **清空本次**：只清理抓取器本次数据和页面标记，不删除抖音作品。

## 默认抓取规则

- 有数字播放/阅读值的作品默认选中。
- 显示 `-` 或 `--` 的定时、未产出数据或旧作品会被识别，但默认不计入汇总。
- 页面顶部作品计数有时不包含定时发布作品，因此识别数量可能比页面计数多一条。
- “Emoji”和“作品序号”只改变本地显示。

## 隐私与安全

- 只读取当前已登录页面中已经展示的作品卡片。
- 不读取或上传 Cookie、密码、Token。
- 不包含 `fetch`、`XMLHttpRequest` 或第三方数据上报。
- 不点击“编辑作品”“设置权限”“删除作品”或“发布作品”等操作按钮。

更多信息见 [SECURITY.md](./SECURITY.md)。

## 本地开发

项目没有运行时依赖，安装 Node.js 后即可执行：

```bash
npm test
```

测试会检查脚本语法、数字单位解析、HTML 转义、关键兼容逻辑、权限边界和界面控件绑定。

```text
.
├── panda-douyin-creator-scraper.user.js  # 油猴脚本
├── tests/                                 # 核心回归测试
├── .github/                               # CI 与 Issue 模板
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

## 反馈与贡献

- 页面改版导致无法抓取时，请使用 [Bug 报告](https://github.com/GoodWay0223/panda-douyin-creator-scraper/issues/new?template=bug_report.yml)。
- 新功能建议可提交 [功能建议](https://github.com/GoodWay0223/panda-douyin-creator-scraper/issues/new?template=feature_request.yml)。
- 提交代码前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE) © 2026 熊猫 / GoodWay0223
