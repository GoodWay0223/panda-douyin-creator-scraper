# 安全与隐私

## 数据边界

脚本只在浏览器本地运行，并读取当前页面已经渲染的作品卡片。当前版本：

- 不读取 Cookie、密码或 Token；
- 不向作者或第三方服务器上传数据；
- 不声明 Tampermonkey `@connect` 权限；
- 不自动执行编辑、删除、权限修改或发布作品等操作。

复制到剪贴板和下载导出文件均由用户主动触发。

## 报告安全问题

请不要在公开 Issue 中披露可利用的安全问题或任何账号隐私。可通过 GitHub 的 [Private vulnerability reporting](https://github.com/GoodWay0223/panda-douyin-creator-scraper/security/advisories/new) 私下报告。

报告中请包含受影响版本、复现条件、影响范围和建议修复方式，但不要附带真实 Cookie、Token 或作品数据。

## 支持版本

安全修复以最新发布版本为主。使用旧版本前，请先升级到仓库 `main` 分支中的最新脚本并重新验证。
