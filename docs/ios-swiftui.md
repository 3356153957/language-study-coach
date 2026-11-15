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

- 91 项本地 Node 测试通过，其中 9 项检查无浏览器手机宿主协议和打包，覆盖多格批改、验证码失败/改正/离线、保存回滚与重启、取消后清理、分页超时、PKCE/身份校验桥接、授权取消后重试，以及阻止将服务端密钥打入手机包。另已补上多格长答案的备份回归。
- 网页生产构建和原生引擎资源生成通过。
- 8 个 Swift 文件已通过语法解析；这不能代替 Xcode 类型检查和编译。
- 已加入 6 个原生 XCTest 用例及 3 个原生 UI 用例，覆盖学习闭环、错误验证码及改正、旧加密格式、JWT 篡改拒绝、数值边界、URL 编码、键盘、回车和横屏流程，尚未执行。
- GitHub Actions [#43745807951](https://github.com/3356153957/language-study-coach/actions/runs/43745807951) 未进入任何编译步骤。GitHub 明确返回账号付款失败或消费限额需要调整；当前没有可用的 Mac。因此尚未生成 2.0 IPA，也未验收模拟器截图、签名、真机安装和覆盖升级。

## 仍需核验

恢复 macOS 构建后先修复真实编译/测试反馈，再看 iPhone 16 Pro 的键盘、横屏、大字体和输入法截图，最后生成并核验 IPA。不能把上一版 1.4.1 的 IPA 当作 SwiftUI 版本交付。

生产环境的人机验证码未启用。当前共享邮件入口保留发送冷却、按邮箱的数量上限和输错锁定；要公开开放注册仍需完成生产验证码配置与原生挑战流程。

## 本轮补强

- 读取学习记录时先验证结构，格式异常会停止启动并保留原文件；本机档案的读取不受导出文件大小限制。
- 断网、服务错误和限流不会消耗“验证码输错”次数；真实错误验证码仍保留锁定机制，网页和手机共用此逻辑。
- 手机 HTTP 取消会传递到原生任务；请求完成即释放空闲超时计时器，复用信号的分页请求仍遵守原定截止时间。内存占用数值尚待 Instruments 实测。
- 原生输入增加收起键盘和焦点滚动；草稿合并为 300 ms 延迟写入，退出/后台立即保存，并保留提示、听力原文使用和耗时信息。列表使用记录 ID，避免把整段 JSON 当作界面标识。
- 统计卡片进入记录，错题与记录可继续加载；四六级预测显示样本积累进度和分项要求，画像跟随作答刷新。这些原生交互已修改，尚未获得模拟器或真机验收证据。
