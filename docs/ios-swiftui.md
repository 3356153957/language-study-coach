# SwiftUI 手机端 2.0

2026-11-15 按用户要求将手机界面改为 SwiftUI。网页继续使用现有界面。原 1.x IPA 的 Capacitor/WKWebView 页面不再作为 2.0 构建入口。

## 架构和代码

- `ios/App/App/Native/StudyApp.swift`：原生 TabView、首页、七天表格、进展、错题和记录。
- `PracticeScreen.swift`：原生练习消息、题卡、材料、中文译文、多格回答、追问和反馈；输入组件使用 UITextView，Return 切换输入格或发送，保留中文输入法组合状态。
- `SettingsScreen.swift`：API 配置与模型发现、ChatGPT 账号、邮箱同步、备份文件和 GitHub 更新入口。
- `NativeCore.swift`、`NativeServices.swift`：JavaScriptCore 宿主、URLSession、安全 OAuth 回调、Security.framework 的 JWT 签名/claims 校验、AES-GCM 文件和 Keychain。
- `src/ios-runtime.js`：复用已经有测试的学习、画像、备份和同步逻辑。它只在 JavaScriptCore 执行数据操作，没有 DOM、HTML、CSS、WKWebView 或网页布局。

2.0 沿用 Bundle ID `com.languagestudycoach.app`、Keychain 的 service/account 和 `learning-state.enc`、`chatgpt-auth.enc`、`cloud-sync.enc` 文件格式。覆盖安装仍须使用与旧安装兼容的 Apple 签名。读取失败会保留原文件并提示，不静默清空。原生草稿单独加密存储；导出仍使用与网页版兼容的备份格式，不含 API Key 和授权令牌。

ChatGPT 的 PKCE/state/nonce、刷新轮换和 scope 检查继续使用原授权控制器；Swift 校验 RS256 签名、issuer、audience、nonce、subject、iat 和 exp。OpenAI 的地区和订阅权限仍然以官方服务为准。

## 构建

`ios/project.yml` 是 2.0 的工程定义，构建时用 XcodeGen 重新生成 Xcode 项目，仅编译 `Native/` 中的 Swift 代码，不链接 Capacitor。历史 `.xcodeproj` 在重新生成前仍是旧版工程，不要直接拿它打 2.0 包。

Windows：

```powershell
npm ci
npm test
npm run ios:sync
```

`ios:sync` 现在仅打包无页面学习引擎与统一同步项目的公开配置，不再调用 Capacitor。

macOS：安装 Xcode 26+ 和 XcodeGen 后，运行 `npm run ios:open` 生成并打开原生工程。也可以使用私有仓库的 `iOS IPA` 工作流；勾选模拟器会运行 NativeTests 和 NativeUITests，并导出首页、键盘、反馈和错误验证码的截图。

## 验证状态

- 83 项本地 Node 测试通过，其中新增两个在无浏览器环境执行的手机宿主协议测试，验证多格批改、同步验证码失败/改正、持久化和密钥不进入备份。
- 网页生产构建和原生引擎资源生成通过。
- 8 个 Swift 文件已通过语法解析；这不能代替 Xcode 类型检查和编译。
- 已加入 4 个原生 XCTest 用例及 2 个原生 UI 用例，覆盖学习闭环、错误验证码、旧加密格式、JWT 篡改拒绝、键盘和回车流程，尚未执行。
- GitHub Actions [#43745807951](https://github.com/3356153957/language-study-coach/actions/runs/43745807951) 未进入任何编译步骤。GitHub 明确返回账号付款失败或消费限额需要调整；当前没有可用的 Mac。因此尚未生成 2.0 IPA，也未验收模拟器截图、签名、真机安装和覆盖升级。

## 仍需核验

恢复 macOS 构建后先修复真实编译/测试反馈，再看 iPhone 16 Pro 的键盘、横屏、大字体和输入法截图，最后生成并核验 IPA。不能把上一版 1.4.1 的 IPA 当作 SwiftUI 版本交付。

生产环境的人机验证码未启用。当前共享邮件入口保留发送冷却、按邮箱的数量上限和输错锁定；要公开开放注册仍需完成生产验证码配置与原生挑战流程。
