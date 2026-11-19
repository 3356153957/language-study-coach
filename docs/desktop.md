# Windows 桌面版

Language Study Coach 的桌面端使用 Electron 承载现有网页界面，并在本机回环地址启动同一套 API。这样可以复用学习引擎、模型接入、ChatGPT/Codex 授权、备份导入导出和 Supabase 同步，不需要用户手动启动 Node 服务。

## 运行和构建

```sh
npm run desktop:dev
npm run desktop:build
```

`desktop:build` 生成 Windows x64 NSIS 安装程序。当前验证包为 `build/desktop/LanguageStudyCoach-Desktop-1.0.0-x64.exe`，未签名；安装前需要在 Windows 的发布者提示中自行确认。私有测试发布：[Windows Desktop 1.0.0](https://github.com/3356153957/language-study-coach/releases/tag/v1.0.0-desktop)。

## 数据和授权

桌面版数据目录是 Electron 的 Windows 用户数据目录下的 `data` 子目录。首次使用桌面版时不会读取项目目录中的开发数据；从网页版迁移时，在网页版设置中导出备份，再在桌面版设置中导入并确认合并。

本地 API 只监听 `127.0.0.1`。首次启动从 41731–41740 中选第一个空闲端口，记入用户数据目录的 `desktop-port.json`，之后固定复用。页面地址因此保持不变，作答草稿、所选目标等浏览器本地存储在重启后仍然有效（1.0.2 及以前每次随机端口，这些内容会在重启时丢失）。保存的端口被其他程序临时占用时，本次顺延到下一个空闲端口，这次启动看不到原草稿，端口恢复空闲后会回到原地址；全部候选被占用时才使用随机端口。服务并保留原有 Host、Origin 和请求格式检查。窗口启用了 context isolation、sandbox、禁用 Node integration 和 webSecurity。外部窗口只允许打开 OpenAI 授权、ChatGPT 用量页和 GitHub 发布页；其余导航被拦截。麦克风权限只对本机应用页面开放，供语音输入使用。

## 验证记录

- 140 项 Node 测试通过，其中包含桌面回环静态服务、路径穿越拦截、API 委托和授权回调测试。
- Vite 生产构建通过。
- Windows x64 NSIS 安装程序生成成功。
- 实际启动打包后的 `Language Study Coach.exe`，验收了首屏目标选择、学习概览和桌面窗口渲染。
- 未配置代码签名证书；未验证另一台电脑安装和自动更新。
- 固定端口（2026-11-19，开发模式）：150 项 Node 测试通过。用 Electron 45.3.4 和临时用户数据目录正常关闭后重启两次，两次都在 41731，写入的 localStorage 与所选目标都保留，重启后直接进入学习概览。用旧版入口做对照，两次端口分别为 1503、11268，重启后 localStorage 为空并回到目标选择页。
- 1.0.3 安装包（2026-11-19）：NSIS 安装程序构建成功，包内确认含固定端口代码与统一云同步公开配置。用打包后的 `win-unpacked` 程序和临时用户数据目录重启两次，结果同上（41731、数据保留、云同步已配置）。未执行覆盖安装，未验证从 1.0.2 升级。
