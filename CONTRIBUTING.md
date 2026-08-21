# 贡献指南

感谢你帮助改进熊猫抖音创作者中心数据抓取器。

## 报告问题

页面兼容问题请优先使用仓库的 Bug 模板，并提供：

- 脚本版本、浏览器版本和 Tampermonkey 版本；
- 所在页面与筛选条件；
- 复现步骤、期望结果和实际结果；
- 齿轮菜单中的“复制诊断”内容。

请先检查诊断文本，不要提交作品标题、账号信息、Cookie、Token 或其他隐私数据。

## 开发流程

1. Fork 仓库并创建功能分支。
2. 只修改与问题相关的代码。
3. 执行 `npm test`。
4. 在 Chrome + Tampermonkey 中验证面板和抓取流程。
5. 提交 Pull Request，并说明修改原因与验证结果。

建议分支名称：

```text
fix/creator-center-parser
feat/export-option
docs/install-guide
```

## 兼容性原则

- 优先使用字段语义、DOM 层级和可见内容，不依赖完整哈希类名。
- 新选择器应保留合理回退路径。
- 展示单位不得改变导出的原始整数。
- 不新增 Cookie、Token 读取或未经说明的外部网络请求。
- 不自动点击编辑、权限、删除、发布等会改变作品状态的操作。

## 提交信息

推荐使用简洁的 Conventional Commits：

```text
fix: adapt creator center metric cards
feat: add display unit option
docs: clarify tampermonkey installation
```
