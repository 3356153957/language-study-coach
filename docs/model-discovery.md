# 从上游获取模型

网页与 iOS 设置页共用同一套功能。选择 API 服务商，填写基础地址和 API Key，停止输入后会自动读取模型列表；已有同服务商、同地址的已保存配置，在进入设置时直接读取。也可点击「获取模型 / 刷新模型」。获取列表不要求预先填写模型，不会保存配置或改变当前学习模型。

按名称或 ID 搜索，然后选择模型并点击「保存配置」。应用不会自动选中第一项；当前模型不在结果内时仍保留。支持「手动填写模型 ID」，适用于上游别名、接口不支持列举、权限受限或获取失败的情况。获取列表成功不表示所有返回模型都适合英语练习，保存后可以测试连接。

## 接口与边界

| 服务商 | 列表接口 | 处理方式 |
| --- | --- | --- |
| OpenAI / OpenAI 兼容 / DeepSeek | 基础地址下 `GET /models` | Bearer 验证，读取 `data`；兼容服务需支持相同协议 |
| Anthropic | `GET /v1/models` | x-api-key 验证，按 after_id 分页 |
| Google Gemini | `GET /v1beta/models` | x-goog-api-key 验证，按 pageToken 分页，仅保留支持 generateContent 的模型 |

只读取模型 ID 与显示名称，去重后最多展示 2,000 个，最多请求 10 页；截断时提示手动填写。网页请求总限时 15 秒，手机原生 GET 的连接、读取各限时 15 秒。认证失败、限流、不支持接口、空列表与网络错误均有提示。不跟随上游重定向或上游提供的下一页 URL。

密钥始终在请求头中发送，已保存密钥不返回页面。仅服务商和规范化基础地址均与已保存配置一致时允许复用密钥；编辑地址会清空未保存的密钥，切换服务商也须重新填写。模型请求晚于服务商切换返回时会被丢弃，不覆盖新界面。列表保存在当前设置页面的内存中，离开页面即清除，不进入学习备份或云同步。

本机 Codex 和 ChatGPT 订阅账号继续使用各自的账号模型列表，不走 API Key 列表接口。

## 验证

`npm test` 共 72 项通过，其中新增 8 项覆盖列表协议、分页、响应清理、错误、密钥复用边界、只读获取、原生网络适配、HTTP 跨站拒绝和选择保留。可用 `node scripts/preview-models.js` 启动独立模拟上游和验收页面（5190 / 5191 端口），使用临时数据目录与假密钥，不读取正式学习记录，也不产生真实模型请求。浏览器完成自动获取、搜索、保存后刷新、手填保留、错误提示和切换服务商验收。未逐家使用真实 API Key 验证。

接口依据（2026-11-15 核对）：[OpenAI List models](https://developers.openai.com/api/reference/resources/models/methods/list)、[DeepSeek Models](https://api-docs.deepseek.com/api/list-models/)、[Anthropic List models](https://platform.claude.com/docs/en/api/models/list)、[Gemini List models](https://aistudio.google.com/api-reference/models/list-models)。
