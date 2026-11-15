# 启用云端同步

代码已接入 Supabase 邮箱验证码登录与学习数据同步。当前尚未创建真实云项目，以下配置完成前不会上传正式学习记录，也无法验证真实邮件或手机与电脑之间的联网链路。

## 创建并配置项目

1. 在 [Supabase 控制台](https://supabase.com/dashboard) 创建一个项目，名称可填 `language-study-coach`。数据库密码只留在自己手里。
2. 在项目的 SQL Editor 中完整运行 [数据库脚本](../supabase/migrations/202611150001_learning_sync.sql)。脚本可以重复执行，创建记录表、账号隔离策略和带版本检查的写入函数。不要关闭 RLS，也不要给客户端直接写表的权限。
3. 开启 Email 登录，允许新用户注册。在 Authentication 的邮件模板中，将 **Magic Link** 模板改为显示验证码，例如：

   ```html
   <h2>Language Study Coach 登录验证码</h2>
   <p>请在应用中输入：{{ .Token }}</p>
   <p>如果不是你发起的登录，请忽略此邮件。</p>
   ```

   如果项目的新用户确认邮件仍使用单独的 Confirm Signup 模板，也让它显示 `{{ .Token }}`。应用通过 `verifyOtp` 的 `email` 类型验证验证码，不依赖手机跳转链接。具体设置见 [Supabase OTP 官方说明](https://supabase.com/docs/guides/auth/auth-email-passwordless)。
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

GitHub 云构建在仓库 Settings → Secrets and variables → Actions → Variables 中使用 `SUPABASE_URL` 与 `SUPABASE_PUBLISHABLE_KEY`，然后重新运行 iOS IPA 工作流。未配置这些变量时，安装包显示同步暂未开放，用户无需自行设置参数。

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

目前共 63 项本地检查通过。`tests/cloud-sync.test.js` 使用 PGlite 的真实 PostgreSQL 引擎运行迁移与 RLS，覆盖双账号隔离、直接写表拒绝、匿名拒绝、修订冲突、两设备合并、离线重试、批量上传途中暂停、保存失败回滚、登录绑定、令牌刷新与原生请求协议。HTTP 测试确认后台网络请求不占用练习请求锁、跨站写入被拒绝、状态接口不泄露令牌。

`node scripts/preview-settings.js` 启动 5183 隔离页面；验证码、云端和邮件均为本地模拟，只验证交互，不访问真实 Supabase，也不使用正式学习记录。402 × 874 手机尺寸下已走通发送验证码和登录，确认没有项目参数表单、没有横向溢出。新版邮箱入口截图 `artifacts/cloud-sync-email-only.jpg`；前一轮完整预览、开启与暂停截图 `artifacts/cloud-sync-mobile.jpg`。

真实项目部署、收件、真实账号授权及两台实际设备之间的联网同步仍待配置项目后验证。数据库和模拟协议测试通过，不代表这些线上环节已通过。

维护者当前正在接入统一项目，Supabase 控制台尚待本人登录或集成授权；尚未创建真实项目、配置发信服务或验证真实收件。
