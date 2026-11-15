# iOS 独立版

手机可使用 ChatGPT 订阅授权，或直接连接用户填写的 OpenAI、DeepSeek、Anthropic、Gemini、OpenAI 兼容 API；不依赖电脑版服务，也不提供本机 Codex 或历史聊天背景导入入口。界面和学习逻辑与网页版共用。目标系统为 iOS 16 或更高版本。Bundle ID 为 `com.languagestudycoach.app`。

## 本机已完成的准备

- Capacitor 8.6.2 iOS 工程、Swift Package Manager 配置和安全区域适配。
- `server/engine.js` 提供可在手机执行的学习流程，保留批改同时备题、追问、错题和跨目标画像。
- `src/native-client.js` 使用原生 HTTP 请求，HTTPS 地址、禁止自动跳转，连接超时 15 秒、读取超时 60 秒。
- API 服务支持自动获取、搜索和选择上游模型，也可手动填写；模型列表 GET 连接和读取各限时 15 秒，无需电脑版代理，见 [模型列表](model-discovery.md)。
- ChatGPT 授权回调完成后会自动返回设置页并刷新账号状态；文字表达多问题按格填写，阅读批改后显示中文译文。
- 设置页提供 GitHub Release 检查更新入口；私有仓库需要用户登录 GitHub 才能打开发布页，应用不会内置访问令牌。
- `StudyStoragePlugin` 用 AES-GCM 加密 API 配置及学习记录，密钥由本机 Keychain 保存；写文件采用原子替换。不会把个人 `.local` 数据或任何账号凭据打进安装包。
- 加密记录不参加 iCloud 备份。可选 Supabase 同步已接入，1.3 版内置统一项目配置，用户用邮箱登录后自行开启，见 [云端同步](cloud-sync.md)。也可在设置中导出 JSON，再通过文件导入恢复学习记录。API 密钥和 ChatGPT 授权不随备份迁移，须在目标设备重新配置或登录。卸载前请手动备份。保存失败保留原记录；读取失败不会静默创建空账号。
- 顶部、底部和横屏安全区域由 UIKit 提供，固定栏本身避开状态栏。手机不再显示常驻品牌栏。iPhone 16 Pro 模拟器检查由 `scripts/check-ios-simulator.sh` 执行。
- 听力仍用系统英语朗读；首版语音输入使用 iPhone 键盘听写。原生自带录音转写、发音评分后续再做。

## Windows 上准备工程

```powershell
npm ci
npm test
npm run ios:sync
```

这会构建网页并同步到 `ios/`，**不会在 Windows 生成 IPA**。iOS 编译需要 macOS 和 Xcode 26 或更高版本，见 [Capacitor 官方环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)。

## 没有 Mac 时的云构建

仓库内已提供 `.github/workflows/ios.yml`。私有仓库为 `3356153957/language-study-coach`，已于 2026-11-15 完成首次云构建。上传使用 `.local/cloud-ipa-source` 中的独立源码快照，未包含学习记录、API 密钥或账号凭据；日常工作区仍未配置远端。后续更新需同步最新源码后再运行工作流。

首次构建记录：[iOS IPA #43720422216](https://github.com/3356153957/language-study-coach/actions/runs/43720422216)。产物已下载到 `build/ios/LanguageStudyCoach-unsigned.ipa`，核验记录位于 `build/ios/verification.json`。包内为 iPhoneOS arm64 应用，最低 iOS 16.0，包含最新听力启动修复。

1.1（build 2）构建：[iOS IPA #43726982243](https://github.com/3356153957/language-study-coach/actions/runs/43726982243)。下载至 `build/ios-v1.1/LanguageStudyCoach-unsigned.ipa`，包含无常驻品牌栏的安全区域适配、ChatGPT 订阅授权和学习数据迁移。53 项检查、Swift 编译和 iPhone 16 Pro 模拟器启动通过；模拟器截图位于 `artifacts/iphone16pro-v1.1/iphone16pro.png`。包内网页资源与本机最终构建逐文件一致，核验记录在同目录 `verification.json`。

默认不勾选签名，使用 macOS runner 编译，产物为 `LanguageStudyCoach-unsigned.ipa`。**未签名 IPA 不能直接安装**，用于验证原生编译和后续签名。工作流只上传 IPA，不上传学习记录、证书或配置文件。

要直接输出可安装的测试 IPA，需要 Apple Distribution 证书和包含测试设备的 Ad Hoc 描述文件，并在仓库 Actions Secrets 中配置：

| Secret | 内容 |
| --- | --- |
| `IOS_CERTIFICATE_BASE64` | `.p12` 签名证书的 Base64 |
| `IOS_CERTIFICATE_PASSWORD` | 证书导出密码 |
| `IOS_PROFILE_BASE64` | 与 Bundle ID 匹配的 Ad Hoc `.mobileprovision` 的 Base64 |

随后勾选签名选项运行工作流。使用 `release-testing` 导出，安装设备必须包含在描述文件中；TestFlight / App Store 发布是另一个流程。证书只在临时 runner 中导入，结束时清理。不要把证书、私钥或描述文件提交到代码仓库。

Mac 上也可运行 `npm run ios:open`，在 Xcode 中配置签名并进行 Archive。脚本 `scripts/build-ios.sh` 可用于无签名编译。

## 验证边界

已在 Windows 验证共享学习逻辑及原生网络适配契约，完成网页构建和 Capacitor 同步。首次 GitHub Actions 构建已通过测试、Swift 编译和 Xcode archive，并生成未签名 IPA；本地核验了 ZIP 完整性、iPhoneOS 平台、arm64 架构及听力修复资源。**签名、真机加密存储、系统语音、键盘和 IPA 安装仍需 iPhone 实测。** 编译通过不等于真机功能验证通过。

## ChatGPT 订阅授权

设置中的“ChatGPT 订阅账号”使用官方 [Sign in with ChatGPT 本地应用流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)。PKCE、state、nonce 和 ID Token 签名校验通过后才保存授权；返回登录复用该账号的注册标识，刷新令牌串行轮换。账号切换、退出授权、用量管理均在设置中提供。网页版凭据保存在本机 `.local/chatgpt-auth.json`；iOS 独立加密保存于 `chatgpt-auth.enc`，不写浏览器存储或学习备份。

iOS 使用系统 Safari 视图与仅监听 `127.0.0.1` 的临时回调，返回应用后完成校验；不在学习页面输入账号密码。授权流程的模拟协议和错误路径已测试，官方真实登录页已打开确认；真实账号批准、订阅请求和真机 Safari 回调仍待本人登录验证。官方权限或额度不足时会报错，不自动改为 API 计费。云托管或商业发行的接入要求需另行核对。

## 备份与后续同步

设置提供导出和导入。手机用系统分享面板保存 JSON、文件选择器读取；网页使用下载和上传选择器。导入先预览再合并，以稳定 ID 去重，本机当前练习和模型配置保留，冲突不覆盖。账号凭据不导出。数据格式、边界和未来联网同步规划见 [数据迁移说明](data-portability.md)。

## 云端同步（1.3）

共享同步逻辑已接入 iOS，`cloud-sync.enc` 与 ChatGPT 授权分开加密保存，凭据不会进入学习备份。1.3 版已内置统一项目公开配置，页面只提供邮箱与验证码，不提供普通用户配置表单。真实项目与数据库已部署；邮件模板、SMTP 和跨设备验证进度见 [配置说明](cloud-sync.md)。

1.3（build 4）构建：[iOS IPA #43733272606](https://github.com/3356153957/language-study-coach/actions/runs/43733272606)，应用源码 `84d396a`，63 项云构建测试、Swift 编译、archive 和下载核验通过。文件为 `build/ios-v1.3/LanguageStudyCoach-unsigned.ipa`，SHA-256 为 `a4ae0a31646f769a846fbf0969e97a65b2737368bf49b4b2576725dc04f0f95c`。确认内置真实项目的 Publishable Key，网页脚本与同配置本地构建逐字节一致，无正式学习数据或授权文件，核验见同目录 `verification.json`。后续第 64 项本地测试只涉及云数据库管理函数权限，不改变安装包资源。SMTP 及验证码模板已配置，真实收件、验证码登录与双客户端联网已在隔离环境通过；签名安装、两次独立设备登录和 iPhone 真机联网尚未验证。

1.2（build 3）最终构建：[iOS IPA #43731162640](https://github.com/3356153957/language-study-coach/actions/runs/43731162640)，源码 `0c1cf67`，62 项测试、Swift 编译、archive 和下载核验通过。文件为 `build/ios-v1.2/LanguageStudyCoach-unsigned.ipa`，SHA-256 为 `718cf906d699260c8145e7b83154e8cc67e48679d2e335ec70d9b2131cfade4b`。包内网页资源与使用同样空公开项目配置的本地构建逐字节一致；不包含正式学习数据或授权文件，完整核验见同目录 `verification.json`。

同轮 iPhone 16 Pro 模拟器检查来自 [#43730647096](https://github.com/3356153957/language-study-coach/actions/runs/43730647096)（`9b9a974`），截图位于 `artifacts/iphone16pro-v1.2/iphone16pro.png`；最终补丁只修改同步暂停和合并总量校验，未改原生安全区域和页面布局。真实账号登录、邮件、跨设备联网及签名安装仍未验证。
