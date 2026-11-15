# 启用云端同步

统一 Supabase 免费项目 `language-study-coach`、数据库隔离、专用 SMTP 和验证码模板均已配置。网页版与 iOS 1.3（build 4）已预设同一项目，普通用户只需邮箱和验证码。已用独立测试邮箱完成真实收件、验证码登录和联网同步，不需要用户填写项目地址或密钥。

## 当前部署

- 项目编号：`ibaqkfpyueiozqmzxzsc`，区域 `us-east-1`，Free。
- 网页开发服务已读取统一公开配置；GitHub Actions 的公开项目变量已设置。安装包内只含项目 URL 和 Publishable Key，不含管理密钥、发信密钥或学习记录。
- 实际 SQL 检查确认两张表已启用 RLS、匿名不能读写、登录用户只读自己的记录、写入仅经版本检查函数。公开 HTTP 请求读取或调用写入 RPC 均返回 401。
- 已撤销 Supabase 自动 RLS 管理函数对客户端的执行权限，自动 RLS 触发器仍开启。Security Advisor 为 0 errors、0 warnings；1 条提示是私有计数表没有客户端策略，这是刻意保留的拒绝访问规则。
- 发件地址为 `login@study-mail.pocketfriend.cloud`，Resend 免费方案。阿里云新增专用子域名的 DKIM、两条发信 CNAME 和 DMARC，公开 DNS 已查到正确记录，Resend 显示域名 Verified / Ready，保留原有 4 条网站记录。打开和点击追踪保持关闭，发信凭据仅可从该子域名发送邮件，由账号本人在 Supabase 中输入并保存，不进入源码或安装包。
- Magic Link / OTP 与 Confirm Signup 均已保存验证码模板。真实邮件在 Resend 中显示 Delivered，本人已在隔离验收页输入验证码并成功登录。
- 两个独立客户端使用该测试账号的同一会话访问真实云端，验证了上传、拉取合并、不重复写入、暂停，以及登录后查询其他用户 ID 返回空数组。网页版也实际预览、合并了 3 轮测试记录。测试别名与正式学习账号分开，没有上传正式学习记录；这不是两个独立设备登录或 iPhone 真机验收。
- 当前 Resend 免费额度为每天 100 封、每月 3,000 封；Supabase SMTP 默认限制为每小时 30 封。账号数量与每日验证码封数不是同一概念。扩大发布前按实际用户量调整，见 [Resend 额度](https://resend.com/pricing) 与 [Supabase 发信限制](https://supabase.com/docs/guides/auth/rate-limits)。
- 应用还会在服务端按邮箱哈希限制验证码：同一邮箱 60 秒冷却、15 分钟最多 5 次、自然日最多 10 次；验证码错误累计 8 次会暂时锁定。网页版 API 另按来源地址限频。验证码发送不会返回“账号是否存在”。生产环境建议同时启用 Supabase CAPTCHA Protection，推荐 Cloudflare Turnstile；将公开 Site Key 放入 `VITE_TURNSTILE_SITE_KEY`，把 Secret Key 只填入 Supabase Auth 的 CAPTCHA 设置，绝不提交仓库。Supabase 官方支持 hCaptcha 和 Turnstile，见 [CAPTCHA Protection](https://supabase.com/docs/guides/auth/auth-captcha)；Turnstile 在 iOS 需要通过 WKWebView 加载，允许 `challenges.cloudflare.com`，见 [Cloudflare 移动端说明](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)。

## 维护者部署步骤

1. 在 [Supabase 控制台](https://supabase.com/dashboard) 创建一个项目，名称可填 `language-study-coach`。数据库密码只留在自己手里。
2. 在项目的 SQL Editor 中依次运行 [数据库脚本](../supabase/migrations/202611150001_learning_sync.sql) 和 [默认管理函数权限收紧](../supabase/migrations/20261115161216_harden_default_rls.sql)。脚本可以重复执行，创建记录表、账号隔离策略和带版本检查的写入函数。不要关闭 RLS，也不要给客户端直接写表的权限。
3. 开启 Email 登录，允许新用户注册。在 Authentication 的邮件模板中，将 **Magic Link** 模板改为显示验证码，例如：

   ```html
   <h2>Language Study Coach 登录验证码</h2>
   <p>请在应用中输入：{{ .Token }}</p>
   <p>如果不是你发起的登录，请忽略此邮件。</p>
   ```

   可直接使用 [验证码邮件模板](../supabase/templates/email-otp.html)，主题为「Language Study Coach 登录验证码」。如果项目的新用户确认邮件仍使用单独的 Confirm Signup 模板，也让它显示 `{{ .Token }}`。当前免费项目需先配置自有 SMTP，控制台才开放编辑模板。应用通过 `verifyOtp` 的 `email` 类型验证验证码，不依赖手机跳转链接。具体设置见 [Supabase OTP 官方说明](https://supabase.com/docs/guides/auth/auth-email-passwordless)。
4. 从项目 Connect / API Keys 页面复制 **Project URL** 和 **Publishable Key**（或旧版 `anon` 公开 Key）。不要复制 `Secret Key`、`service_role`、数据库密码或 JWT 签名密钥。公开 Key 配合用户登录令牌和 RLS 使用，见 [官方 Key 说明](https://supabase.com/docs/guides/api/api-keys)。
5. Supabase 默认发信服务有收件人与速率限制。给其他人使用前配置自己的 SMTP 并测试收件；可参考 [官方 SMTP 说明](https://supabase.com/docs/guides/auth/auth-smtp)。不要因收不到邮件而关闭账号验证或 RLS。

## 普通用户

在已配置服务的网页或新版 iOS 应用打开「设置 → 云端同步」，填写邮箱、输入邮件验证码，查看同步内容后开启即可。项目地址和公开 Key 由维护者统一配置，普通用户页面不再提供服务参数表单。服务尚未配置时明确显示“暂未开放”，仍可本机学习及导出备份。

每台设备使用同一个邮箱登录。AI 服务和密钥分别配置；同步账号与 ChatGPT / Codex 模型授权独立。

## 发布时让普通用户只填邮箱

开发时将 `.env.example` 复制成 `.env.local`，填写：

```dotenv
VITE_SUPABASE_URL=https://你的项目编号.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=你的公开Key
```

重启开发服务；本地打包运行 `npm run ios:sync`。它们是会打进前端包的公开配置，**不能放 Secret Key 或 service_role**。普通用户直接用邮箱登录。带默认配置的版本也会拒绝通过本机配置接口改成其他同步服务；维护者更新同一项目公开 Key 时保留账号和记录。

GitHub 云构建在仓库 Settings → Secrets and variables → Actions → Variables 中使用 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 与可选的 `TURNSTILE_SITE_KEY`，然后重新运行 iOS IPA 工作流。未配置这些变量时，安装包显示同步暂未开放，用户无需自行设置参数；要强制人机验证，还要在 Supabase Auth CAPTCHA 设置中保存匹配的 Turnstile Secret。

## 同步规则与边界

- 默认关闭。开启前只有登录与只读预览；开启后才上传学习数据。同步练习、作答、批改、追问、共享能力画像及已有学习偏好；API Key、API 配置、ChatGPT / Codex 授权和未提交草稿不上传。
- 正在做的练习保留在原设备。它会备份到云端，完成后才在其他设备合并为历史记录；两台设备可各自做一轮，互不抢占当前题目。
- 本机先保存，随后延迟同步。前台约每分钟拉取更新，回到应用、网络恢复时也会尝试；不依赖实时订阅或后台常驻连接。网页服务关闭、App 被挂起时不会持续同步。
- 每条记录使用稳定 ID、内容摘要和云端修订号。写入检查旧版本，旧写入不能覆盖新记录；上传失败重试不重复增加题量。拉取游标在本机保存成功后推进。
- 已完成轮次只有答案前缀一致时才合并。真正分叉会保留本机和云端两份内容、显示冲突提示，该记录停止自动合并，其余记录继续。第一版没有强制覆盖或自动裁决入口；可先导出本机备份，云端原内容仍保留在项目中。
- 当前一台设备保存一份学习档案。首次登录绑定项目和用户 ID，退出后仍需原邮箱登录，避免把既有记录上传给另一个人的账号。更换 AI 账号不受此限制。
- 暂停或退出只停止后续同步，不删除本机或云端学习记录。已发出的请求可能完成。云端删除 / 账号注销尚未提供，需要项目管理员处理；本机删除不会向云端传播。
- 同步使用 HTTPS。Supabase 存储的是可读取的学习数据，没有端到端加密；项目管理员可访问，需自行管理项目和备份。iOS 同步凭据使用 AES-GCM 加密文件和设备 Keychain；桌面同步凭据保存在本机 `.local/cloud-sync.json`，不返回网页、不进入浏览器存储或备份文件。
- 每条同步记录上限 512 KB，学习备份仍受 20 MB / 10,000 轮限制。首版仅接受官方 `https://项目编号.supabase.co` 地址，不支持自托管或自定义域名。

## 验证情况

目前共 64 项本地检查通过。`tests/cloud-sync.test.js` 使用 PGlite 的真实 PostgreSQL 引擎运行迁移与 RLS，覆盖双账号隔离、直接写表拒绝、匿名拒绝、修订冲突、两设备合并、离线重试、批量上传途中暂停、保存失败回滚、登录绑定、令牌刷新与原生请求协议；新增检查确认平台管理函数保留所有者权限并拒绝客户端执行。HTTP 测试确认后台网络请求不占用练习请求锁、跨站写入被拒绝、状态接口不泄露令牌。

`node scripts/preview-settings.js` 启动 5183 隔离页面；验证码、云端和邮件均为本地模拟，只验证交互，不访问真实 Supabase，也不使用正式学习记录。402 × 874 手机尺寸下已走通发送验证码和登录，确认没有项目参数表单、没有横向溢出。新版邮箱入口截图 `artifacts/cloud-sync-email-only.jpg`；前一轮完整预览、开启与暂停截图 `artifacts/cloud-sync-mobile.jpg`。

正式网页版已确认「设置 → 云端同步」只有邮箱、验证码和登录按钮，没有项目配置表单；状态接口显示 `configured: true`、`managed: true`。截图为 `artifacts/cloud-sync-managed-web.jpg`，实际项目检查记录为 `artifacts/supabase-deployment.json`，公开 DNS 核验为 `artifacts/mail-dns-verification.json`。

iOS 1.3（build 4）已通过 63 项云构建测试、Swift 编译及 archive，并下载到 `build/ios-v1.3/LanguageStudyCoach-unsigned.ipa`。包完整性通过，网页脚本与使用相同公开项目配置的本地构建逐字节一致。后续新增的第 64 项测试仅验证数据库权限收紧，不改变应用资源。IPA 核验见同目录 `verification.json`。

真实收件、验证码登录和真实项目双客户端联网已验证，记录为 `artifacts/real-cloud-sync-verification.json`。投递截图为 `artifacts/real-email-delivered.jpg`，开启预览为 `artifacts/real-sync-preview.jpg`，完成合并后的页面为 `artifacts/real-sync-completed.jpg`。两个客户端复用同一测试会话，尚未验收两次独立设备登录、iPhone 真机同步或签名安装，不能把本次联网结果当成这些环节已经通过。
