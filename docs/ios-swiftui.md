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

`ios/project.yml` 是 2.0 的工程定义，构建时用 XcodeGen 生成 `ios/App.xcodeproj`，仅编译 `Native/` 中的 Swift 代码，不链接 Capacitor。`ios/App/App.xcodeproj` 是历史 Capacitor 工程，不要拿它打 2.0 包。

Windows：

```powershell
npm ci
npm test
npm run ios:sync
```

`ios:sync` 现在仅打包无页面学习引擎与统一同步项目的公开配置，不再调用 Capacitor。

macOS：安装 Xcode 26+ 和 XcodeGen 后，运行 `npm run ios:open` 生成并打开原生工程。也可以使用私有仓库的 `iOS IPA` 工作流；勾选模拟器会运行 NativeTests 和 NativeUITests，并导出首页、键盘、反馈和错误验证码的截图。

原仓库保留为 `3356153957/language-study-coach`。经用户授权，另建私有编译仓库 `huangziqi113-cmd/language-study-coach`，使用该仓库所属账号的 Actions 额度。它不包含个人学习记录、API Key 或 ChatGPT 令牌。统一同步项目的公开配置通过仓库变量注入；Apple 签名凭据未配置。

## 验证状态

- 91 项本地 Node 测试通过，其中 9 项检查无浏览器手机宿主协议和打包，覆盖多格批改、验证码失败/改正/离线、保存回滚与重启、取消后清理、分页超时、PKCE/身份校验桥接、授权取消后重试，以及阻止将服务端密钥打入手机包。另已补上多格长答案的备份回归。
- 网页生产构建和原生引擎资源生成通过。
- Xcode 26.3 的 iPhoneOS Release archive 已通过，导出 2.0.0（build 8）未签名 IPA；包完整性、版本号、arm64 平台、原生 scene 配置、SwiftUI/JavaScriptCore 链接及引擎/公开配置一致性均已核验，没有 Capacitor 页面或个人加密记录。
- [完整云端验收 #43825522929](https://github.com/huangziqi113-cmd/language-study-coach/actions/runs/43825522929) 成功：91 项 Node 测试、7 项原生 XCTest、3 项 UI 测试全部通过。测试设备为 iPhone 16 Pro / iOS 26.2 模拟器，测试构建为 Debug、本地 ad-hoc 签名，交付的安装包为 Release、未签名。
- 7 项原生测试覆盖学习批改并准备下一题、便携备份、错误验证码及改正、旧 AES-GCM 格式读写、JWT 篡改拒绝、数值边界、URL 编码、安全随机数，以及本机 OAuth 回调准备、取消和重新准备。
- 3 项 UI 测试覆盖多格输入、Return 切格与发送、取出已备下一题、错误验证码内联提示/改正后登录，以及横屏输入内容保留、输入框完整边界与无 WebView。横屏输入框须完整位于导航栏与键盘之间，并检查实际输入内容；整屏截图另行复核。AI 和验证码使用隔离响应，不代表已通过真实供应商与邮件链路的手机验收。
- 首页、竖屏键盘、批改反馈、错误验证码、改正后登录和横屏整屏截图已逐一检查。复核发现并修复了横屏滚动区被底部工具区挤压的问题；横屏多格回答现固定在键盘上方，带当前题目和前后切换，竖屏保留多个回答格。最终横屏输入框 y≈140–193 pt，键盘从 y=237 pt 开始。
- 早期模拟器禁用签名时 Keychain 测试失败；启用本地 ad-hoc 签名后通过，日志包含模拟器 application-identifier。未跳过测试，也未降低生产加密保护。iPhoneOS 安装包仍然未签名。

## 仍需核验

未配置 Apple 证书和描述文件，因此 IPA 需要签名后才能安装。覆盖安装需要与原安装兼容的签名和 Keychain 权限；真实旧设备迁移尚未验证，请先导出备份并保留原安装。

真机键盘/中文输入法、大字体、蓝牙听力、真实 ChatGPT 授权及各 API 服务、iOS 16 至 25、Instruments 内存测量仍需核验。自动测试通过不能代替这些检查。

生产环境的人机验证码未启用。当前共享邮件入口保留发送冷却、按邮箱的数量上限和输错锁定；要公开开放注册仍需完成生产验证码配置与原生挑战流程。

## 本轮补强

- 读取学习记录时先验证结构，格式异常会停止启动并保留原文件；本机档案的读取不受导出文件大小限制。
- 断网、服务错误和限流不会消耗“验证码输错”次数；真实错误验证码仍保留锁定机制，网页和手机共用此逻辑。
- 手机 HTTP 取消会传递到原生任务；请求完成即释放空闲超时计时器，复用信号的分页请求仍遵守原定截止时间。内存占用数值尚待 Instruments 实测。
- 原生输入增加收起键盘和焦点滚动；草稿合并为 300 ms 延迟写入，退出/后台立即保存，并保留提示、听力原文使用和耗时信息。列表使用记录 ID，避免把整段 JSON 当作界面标识。
- 统计卡片进入记录，错题与记录可继续加载；四六级预测显示样本积累进度和分项要求，画像跟随作答刷新。首页已有模拟器截图；这些统计与长列表交互未逐项做真机验收。
- 修正 XcodeGen 工程输出路径、Info.plist 的版本与 scene 配置；OAuth 网络回调回到 MainActor，并按授权尝试隔离取消/超时；练习视图拆分后通过真实 Swift 编译。
- `scripts/verify-native-ipa.py` 核验已导出的包，并生成带源码提交、构建地址和 SHA-256 的 `verification.json`。它不代替设备测试或签名检查。

## 交付文件

- [私有测试发布 v2.0.0](https://github.com/3356153957/language-study-coach/releases/tag/v2.0.0)。
- 本地安装包：`build/ios-swiftui-v2/final/LanguageStudyCoach-2.0.0-build8-unsigned.ipa`，946530 字节。
- 包对应源码提交：`e088071faa2c9e7e18904e0441421d969c0443a5`。后续仅更新验收文档。
- SHA-256：`9f26a0e2478c8af2c3bc33a91b1eddee4de1e75ed693b2b5d74c7c665a88bc80`。
- 同目录保留 `verification.json`、`qa-report.json`、`SHA256SUMS.txt` 和 `native-ui-evidence.zip`；选取的日志与截图保留在 `artifacts/swiftui-v2/run-43825522929/simulator/`。完整 xcresult 可从对应 Actions 运行下载。
