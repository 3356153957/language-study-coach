# Windows 桌面版

Language Study Coach 的桌面端使用 Electron 承载现有网页界面，并在本机回环地址启动同一套 API。这样可以复用学习引擎、模型接入、ChatGPT/Codex 授权、备份导入导出和 Supabase 同步，不需要用户手动启动 Node 服务。

## 运行和构建

```sh
npm run desktop:dev
npm run desktop:build
```

`desktop:build` 生成 Windows x64 NSIS 安装程序。当前验证包为 `build/desktop/LanguageStudyCoach-Desktop-1.0.0-x64.exe`，未签名；安装前需要在 Windows 的发布者提示中自行确认。

## 数据和授权

桌面版数据目录是 Electron 的 Windows 用户数据目录下的 `data` 子目录。首次使用桌面版时不会读取项目目录中的开发数据；从网页版迁移时，在网页版设置中导出备份，再在桌面版设置中导入并确认合并。

本地 API 只监听 `127.0.0.1` 随机端口，并保留原有 Host、Origin 和请求格式检查。窗口启用了 context isolation、sandbox、禁用 Node integration 和 webSecurity。外部窗口只允许打开 OpenAI 授权、ChatGPT 用量页和 GitHub 发布页；其余导航被拦截。麦克风权限只对本机应用页面开放，供语音输入使用。

## 验证记录

- 140 项 Node 测试通过，其中包含桌面回环静态服务、路径穿越拦截、API 委托和授权回调测试。
- Vite 生产构建通过。
- Windows x64 NSIS 安装程序生成成功。
- 实际启动打包后的 `Language Study Coach.exe`，验收了首屏目标选择、学习概览和桌面窗口渲染。
- 未配置代码签名证书；未验证另一台电脑安装和自动更新。
