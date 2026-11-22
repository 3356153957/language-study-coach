import { icon } from './icons.js';

export function renderModelOptions({models,query,current,esc}) {
  const search = query.trim().toLowerCase();
  const filtered = models.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(search));
  return `<option value="">${filtered.length ? '请选择模型' : '没有匹配的模型'}</option>
    ${current && !filtered.some(m => m.id === current) ? `<option selected value="${esc(current)}">当前：${esc(current)}</option>` : ''}
    ${filtered.map(m => `<option value="${esc(m.id)}" ${m.id === current ? 'selected' : ''}>${esc(m.name === m.id ? m.id : `${m.name} · ${m.id}`)}</option>`).join('')}`;
}

export function renderModelPicker({catalog:c,cfg,busy,esc,button}) {
  const hasList = !!c.models?.length;
  return `<section id="model-picker" class="model-picker" aria-label="模型选择" aria-busy="${c.loading}">
    <div class="model-picker-heading"><span>学习模型</span>${button(`${icon('refresh')}<span>${c.loading ? '正在获取…' : c.models ? '刷新模型' : '获取模型'}</span>`,'models-refresh','secondary-button model-picker-refresh',c.loading ? 'disabled' : '')}</div>
    ${hasList && !c.manual ? `<label class="model-search-label"><span class="sr-only">搜索模型</span><input id="model-search" type="search" autocomplete="off" value="${esc(c.query)}" placeholder="搜索模型名称或 ID" ${busy ? 'disabled' : ''}></label>
      <label><span class="sr-only">选择模型</span><select name="model" id="upstream-model" required ${busy ? 'disabled' : ''}>${renderModelOptions({models:c.models,query:c.query,current:cfg.model,esc})}</select></label>` : `<label><span class="sr-only">模型 ID</span><input name="model" required maxlength="200" value="${esc(cfg.model)}" placeholder="获取后选择，或手动填写模型 ID" ${busy ? 'disabled' : ''}></label>`}
    <div class="model-picker-status" role="status">${c.loading ? '<span class="spinner"></span>正在从当前接口读取模型…' : c.error ? esc(c.error) : c.models ? c.models.length ? `已获取 ${c.models.length} 个模型${c.truncated ? '（列表较长，可手动填写其他模型）' : ''}` : '上游未返回可选模型，可手动填写模型 ID。' : '填好地址和密钥后获取，也可手动填写。'}</div>
    ${hasList ? button(c.manual ? '从列表选择' : '手动填写模型 ID','models-mode','text-button model-picker-mode') : ''}
  </section>`;
}

export function renderDataSettings({preview,esc,button}) {
  return `<section class="settings-data dash-panel" aria-label="学习数据"><h2>学习数据</h2><p>备份练习、追问和能力画像，可在手机与网页版之间迁移。文件包含你的学习内容，请妥善保存；不包含 API 密钥或 ChatGPT 登录凭据。</p><div class="form-actions">${button('导出备份','data-export','secondary-button')}${button('导入备份','data-pick','secondary-button')}</div><input type="file" id="backup-file" accept="application/json,.json" hidden>
    ${preview ? `<div class="backup-preview" role="status"><strong>导入预览</strong><p>文件含 ${preview.rounds} 轮练习、${preview.answers} 道作答。新增 ${preview.added} 轮，更新 ${preview.updated} 轮，跳过 ${preview.skipped} 轮。${preview.conflicts ? `有 ${preview.conflicts} 处进度冲突，将保留本机记录。` : ''}</p><p>合并导入会保留当前练习及模型配置。</p><div class="form-actions">${button('确认合并导入','data-confirm')}${button('取消导入','data-cancel','text-button')}</div></div>` : ''}
    </section>`;
}

export function renderSyncPanel({status:s,fields:f,preview,activity,error='',esc,button,captchaSiteKey='',captchaToken=''}) {
  const connected=s?.connected,enabled=s?.enabled;
  const label=!s?'正在读取…':!s.configured?'仅保存在本机':!connected?'尚未登录':enabled?(s.phase==='error'?'等待重试':'自动同步已开启'):'同步已暂停';
  return `<section id="sync-panel" class="settings-data dash-panel" aria-label="云端同步"><div class="sync-heading"><h2>云端同步</h2><span class="sync-badge ${enabled?'on':''}">${esc(label)}</span></div>
    <p>在手机和电脑上用同一个邮箱，接着积累你的学习记录。随时可以暂停。</p>
    ${activity?`<p role="status"><span class="spinner"></span>${esc(activity)}</p>`:''}
    ${error?`<p id="sync-error" class="sync-warning" role="alert">${esc(error)}</p>`:''}
    ${s?.lastError?`<p class="sync-warning" role="status">${esc(s.lastError)}</p>`:''}
    ${s && !s.configured?'<p class="field-help">云端同步暂未开放，你可以继续在本机学习和导出备份。</p>':''}
    ${s?.configured && !connected?`<form id="sync-login-form"><label>同步邮箱<input id="sync-email" name="email" type="email" autocomplete="email" required value="${esc(f.email || s.email)}" ${s.bound?'readonly':''}></label>${captchaSiteKey?`<div id="sync-captcha" data-sitekey="${esc(captchaSiteKey)}" data-token="${esc(captchaToken)}"></div><p class="field-help">发送验证码前需要完成人机验证。</p>`:''}
      <div class="form-actions">${button('发送验证码','sync-code','secondary-button',captchaSiteKey&&!captchaToken?'disabled':'')}</div><label>邮箱验证码<input id="sync-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" required placeholder="输入邮件中的验证码" value="${esc(f.code)}" ${error?'aria-invalid="true" aria-describedby="sync-error"':''}></label><button type="submit" class="primary-button">登录同步账号</button></form>`:''}
    ${connected?`<p class="sync-account">${esc(s.email)}</p><p class="field-help">同步学习记录、追问、能力画像及学习偏好。API 密钥与 AI 账号授权保留在各自设备。正在做的练习留在原设备，完成后合并到其他设备。</p>
      ${preview?`<div class="backup-preview" role="status"><strong>开启前确认</strong><p>本机有 ${preview.rounds} 轮练习、${preview.answers} 道作答，云端有 ${preview.cloudRecords} 条记录。开启后会自动上传和合并学习数据。</p><div class="form-actions">${button('确认开启同步','sync-confirm')}${button('暂不开启','sync-cancel','text-button')}</div></div>`:`<div class="form-actions">${enabled?button('立即同步','sync-now')+button('暂停同步','sync-disable','secondary-button'):button('开启自动同步','sync-preview')}${button('退出同步账号','sync-logout','text-button')}</div>`}
      <p class="field-help">${s.lastSync?`上次同步：${esc(new Date(s.lastSync).toLocaleString('zh-CN'))}`:'尚未完成首次同步'} · 退出账号会保留本机和云端记录。</p>`:''}
    ${s?.conflicts?.length?`<p class="sync-warning" role="status">${s.conflicts.length} 条记录在两台设备上有不同修改，已保留两边内容并暂停这些记录的合并。可以先导出本机备份，其余记录继续同步。</p>`:''}
    </section>`;
}

export function renderUpdatePanel({state,platform,currentVersion,releasesPage,esc,button}) {
  const {status,error,data} = state;
  const version = data?.current || currentVersion;
  const releaseLink = data?.updateAvailable ? data.releaseUrl : error ? releasesPage : '';
  return `<section class="settings-data dash-panel update-panel" aria-label="应用更新">
    <div class="sync-heading"><h2>应用更新</h2><span class="sync-badge">${esc(platform)}</span></div>
    ${version ? `<p class="field-help">当前版本 ${esc(version)}${data ? ` · GitHub 最新版本 ${esc(data.latest)}` : ''}</p>` : ''}
    ${status === 'loading' ? '<p role="status"><span class="spinner"></span>正在检查更新…</p>' : ''}
    ${error ? `<p class="sync-warning" role="alert">${esc(error)}</p>` : ''}
    ${data ? `<p class="update-result" role="status">${data.updateAvailable ? '发现新版本，可前往 GitHub 下载。' : '当前已是最新版本。'}</p>` : ''}
    <div class="form-actions">${button('检查更新','app-update-check','secondary-button',status === 'loading' ? 'disabled' : '')}
      ${releaseLink ? `<a class="secondary-button update-link" href="${esc(releaseLink)}" target="_blank" rel="noopener noreferrer">打开 GitHub 发布页 ↗</a>` : ''}
    </div>
  </section>`;
}

export function renderChatGPTPanel({status,loading,models,authURL,cfg,esc,button}) {
  return `<div class="codex-account"><div><strong>${loading?'正在读取 ChatGPT 授权…':status?.loggedIn?'已连接 ChatGPT':'使用你的 ChatGPT 订阅'}</strong><p>${status?.loggedIn?esc(status.account.label):'在 OpenAI 官方页面登录并授权，无需 API Key。'}</p></div></div>
    ${status?.accounts?.length ? `<div class="chatgpt-accounts">${status.accounts.map(a=>`<div><span>${esc(a.label)} ${status.activeId===a.id?'· 当前账号':''}</span> ${button(a.connected?'切换使用':'重新授权',a.connected?'chatgpt-select':'chatgpt-login','text-button',`data-id="${esc(a.id)}" ${status.activeId===a.id?'disabled':''}`)}</div>`).join('')}</div>`:''}
    ${status?.loggedIn ? `<label>学习模型<select name="model"><option value="">账号默认可用模型</option>${cfg.model && !models.some(m=>m.id===cfg.model)?`<option selected value="${esc(cfg.model)}">${esc(cfg.model)}</option>`:''}${models.map(m=>`<option value="${esc(m.id)}" ${m.id===cfg.model?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><div class="form-actions"><button type="submit" class="primary-button">使用 ChatGPT 订阅</button>${button('测试已保存的连接','test-connection','secondary-button',cfg.provider==='chatgpt'?'':'disabled')}</div>`:''}
    ${authURL ? `<div class="codex-login"><strong>等待官方页面授权</strong><p>在打开的页面完成后返回这里，状态会自动更新。</p><a class="chatgpt-signin" href="${esc(authURL)}" target="_blank" rel="noopener noreferrer">前往 ChatGPT 授权 ↗</a>${button('取消本次授权','chatgpt-cancel','text-button')}</div>` : `<div class="form-actions">${button(status?.loggedIn?'连接另一个 ChatGPT 账号':'Continue with ChatGPT','chatgpt-login','chatgpt-signin',loading?'disabled':'')}</div>`}
    ${status?.loggedIn?button('退出此账号授权','chatgpt-logout','text-button'):''}${button('刷新授权状态','chatgpt-refresh','text-button',loading?'disabled':'')}
    <p class="field-help">符合条件的 AI 请求使用你的 ChatGPT 订阅额度，权限和用量以官方页面为准。<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">管理 ChatGPT 用量 ↗</a></p>`;
}
