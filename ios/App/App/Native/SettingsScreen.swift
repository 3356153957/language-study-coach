import SwiftUI
import UniformTypeIdentifiers

struct BackupDocument:FileDocument {
    static var readableContentTypes:[UTType]{[.json]}
    var data:Data
    init(data:Data){self.data=data}
    init(configuration:ReadConfiguration)throws{data=configuration.file.regularFileContents ?? Data()}
    func fileWrapper(configuration:WriteConfiguration)throws->FileWrapper{FileWrapper(regularFileWithContents:data)}
}
struct SettingsScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var provider="openai",baseURL="https://api.openai.com/v1",model="",apiKey="",query=""
    @State private var models:[J]=[],auth:J = .null,sync:J = .null,preview:J = .null
    @State private var email="",code="",syncError="",syncNotice="",connectionNotice="",updateNotice=""
    @State private var exporter=false,importer=false,showImport=false,confirmSync=false
    @State private var backup=BackupDocument(data:Data()),incoming:J = .null,importSummary:J = .null
    private let providers=[("chatgpt","ChatGPT 订阅账号"),("openai","OpenAI"),("deepseek","DeepSeek"),("compatible","OpenAI 兼容接口"),("anthropic","Anthropic"),("gemini","Google Gemini")]
    var body:some View{
        NavigationStack{Form{
            if !store.notice.isEmpty{Section{Text(store.notice).foregroundStyle(StudyStyle.purple)}}
            Section("连接 AI"){
                Picker("服务商",selection:$provider){ForEach(providers,id:\.0){id,label in Text(label).tag(id)}}.onChange(of:provider){_ in changeProvider()}
                if provider=="chatgpt"{authFields}else{apiFields}
                if !models.isEmpty{TextField("搜索模型",text:$query).textInputAutocapitalization(.never);Picker("选择模型",selection:$model){Text("请选择").tag("");if !model.isEmpty && !models.contains(where:{$0["id"].text==model}){Text(model).tag(model)};ForEach(models.filter{query.isEmpty || ($0["id"].text+" "+$0["name"].text).localizedCaseInsensitiveContains(query)},id:\.json){item in Text(item["name"].text.isEmpty ? item["id"].text:item["name"].text).tag(item["id"].text)}}}
                TextField("模型 ID（可手动填写）",text:$model).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("保存配置"){Task{await store.perform("保存配置…"){_ = try await store.request("settings",configuration);await store.refresh();apiKey="";connectionNotice="配置已保存。"}}}.accessibilityIdentifier("save-settings")
                Button("测试已保存的连接"){Task{await store.perform("测试模型连接…"){_ = try await store.request("settings/test");connectionNotice="连接成功，模型已返回有效内容。"}}}
                if !connectionNotice.isEmpty{Text(connectionNotice).font(.caption).foregroundStyle(.secondary)}
            }
            Section("学习数据"){
                Button{Task{await store.perform("准备备份…"){let value=try await store.request("data/export");backup=BackupDocument(data:Data(value.json.utf8));exporter=true}}}label:{Label("导出备份",systemImage:"square.and.arrow.up")}
                Button{importer=true}label:{Label("导入备份",systemImage:"square.and.arrow.down")}
                Text("包含练习、追问和能力画像。API 密钥与 AI 授权留在各自设备。").font(.caption).foregroundStyle(.secondary)
            }
            Section("云端同步"){syncFields}
            Section("应用更新"){
                LabeledContent("当前版本",value:"2.0.0 · SwiftUI")
                Button("从 GitHub 检查更新"){Task{await checkUpdate()}}
                if !updateNotice.isEmpty{Text(updateNotice).font(.caption).foregroundStyle(.secondary)}
                Link("打开私有发布页",destination:URL(string:"https://github.com/3356153957/language-study-coach/releases")!)
            }
        }.disabled(!store.busy.isEmpty).navigationTitle("设置").task{loadConfig();await refreshAccounts()}
        .toolbar{ToolbarItemGroup(placement:.keyboard){Spacer();Button("完成"){UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil)}}}
        .fileExporter(isPresented:$exporter,document:backup,contentType:.json,defaultFilename:"language-study-coach-backup"){result in if case .failure(let error)=result{store.error=error.localizedDescription}}
        .fileImporter(isPresented:$importer,allowedContentTypes:[.json]){result in Task{await store.perform("检查备份…"){
            let url=try result.get(),scoped=url.startAccessingSecurityScopedResource();defer{if scoped{url.stopAccessingSecurityScopedResource()}}
            let count=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0;guard count<=20*1024*1024 else{throw StudyError("备份超过 20 MB。")}
            let data=try Data(contentsOf:url);guard data.count<=20*1024*1024 else{throw StudyError("备份超过 20 MB。")}
            incoming=try J.decode(data);importSummary=try await store.request("data/preview",["backup":incoming]);showImport=true
        }}}
        .alert("合并学习数据",isPresented:$showImport){Button("取消",role:.cancel){};Button("确认合并"){Task{await store.perform("合并记录…"){store.state=try await store.request("data/import",["backup":incoming]);store.notice="备份已合并，原有配置和当前练习已保留。"}}}}message:{Text("备份含 \(importSummary["rounds"].int) 轮、\(importSummary["answers"].int) 道作答。新增 \(importSummary["added"].int) 轮，冲突保留本机记录。")}
        .alert("开启自动同步",isPresented:$confirmSync){Button("暂不开启",role:.cancel){};Button("确认开启"){Task{await syncAction("enable",["confirmed":.bool(true)])}}}message:{Text("本机有 \(preview["rounds"].int) 轮、\(preview["answers"].int) 道作答，云端有 \(preview["cloudRecords"].int) 条记录。开启后自动上传和合并学习数据。")}}
    }
    var configuration:[String:J]{["provider":.s(provider),"baseURL":.s(baseURL),"model":.s(model),"apiKey":.s(apiKey)]}
    var apiFields:some View{Group{
        TextField("API 基础地址",text:$baseURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).onChange(of:baseURL){_ in apiKey="";models=[]}
        SecureField(store.state["config"]["hasKey"].flag && provider==store.state["config"]["provider"].text ? "API Key（留空使用已保存密钥）":"API Key",text:$apiKey).textInputAutocapitalization(.never).autocorrectionDisabled()
        Button("从上游获取模型"){Task{await store.perform("获取模型列表…"){models=(try await store.request("settings/models",configuration))["models"].list}}}
    }}
    var authFields:some View{Group{
        if auth["loggedIn"].flag{Label("已连接 ChatGPT",systemImage:"checkmark.shield");Text(auth["account"]["label"].text).font(.subheadline).foregroundStyle(.secondary)
            ForEach(auth["accounts"].list,id:\.json){account in if account["id"] != auth["activeId"]{Button("切换："+account["label"].text){Task{await store.perform("切换账号…"){auth=try await store.request("chatgpt/select",["accountId":account["id"]]);models=(try await store.request("chatgpt/models"))["models"].list}}}}}
        Button(auth["loggedIn"].flag ? "连接另一个 ChatGPT 账号":"Continue with ChatGPT"){Task{await store.perform("请在官方页面完成授权…"){auth=try await store.request("chatgpt/login");models=(try await store.request("chatgpt/models"))["models"].list;connectionNotice="授权完成，选择模型后保存即可使用。"}}}
        if auth["loggedIn"].flag{Button("退出当前授权",role:.destructive){Task{await store.perform("退出授权…"){auth=try await store.request("chatgpt/logout");models=[]}}}}
        Text("符合条件的 AI 请求使用 ChatGPT 订阅额度，权限与用量以官方页面为准。").font(.caption).foregroundStyle(.secondary)
        Link("管理 ChatGPT 用量",destination:URL(string:"https://chatgpt.com/settings/usage")!)
    }}
    var syncFields:some View{Group{
        if !sync["configured"].flag{Text("正在准备同步服务，你可以继续本机学习。")}
        else if !sync["connected"].flag{
            TextField("同步邮箱",text:$email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.emailAddress).accessibilityIdentifier("sync-email")
            Button("发送验证码"){Task{await syncAction("send-code",["email":.s(email)])}}.accessibilityIdentifier("send-code")
            TextField("邮箱验证码",text:$code).keyboardType(.numberPad).textContentType(.oneTimeCode).onChange(of:code){_ in code=String(code.filter(\.isNumber).prefix(8))}.accessibilityIdentifier("sync-code")
            Button("登录同步账号"){Task{await syncAction("verify",["email":.s(email),"code":.s(code)])}}.accessibilityIdentifier("verify-code")
        }else{
            Text(sync["email"].text).font(.subheadline)
            Label(sync["enabled"].flag ? "自动同步已开启":"同步已暂停",systemImage:sync["enabled"].flag ? "checkmark.icloud":"icloud")
            if sync["enabled"].flag{Button("立即同步"){Task{await syncAction("run")}};Button("暂停同步"){Task{await syncAction("disable")}}}
            else{Button("开启自动同步"){Task{await syncAction("preview");if preview.exists{confirmSync=true}}}}
            Button("退出同步账号"){Task{await syncAction("logout")}}
        }
        if !syncError.isEmpty{Label(syncError,systemImage:"exclamationmark.circle").font(.subheadline).foregroundStyle(.red).accessibilityIdentifier("otp-error")}
        if !syncNotice.isEmpty{Text(syncNotice).font(.caption).foregroundStyle(.secondary)}
        if !sync["lastError"].text.isEmpty{Text(sync["lastError"].text).font(.caption).foregroundStyle(.orange)}
        Text("用同一邮箱在电脑和手机间同步。API 密钥与授权凭据不会上传。").font(.caption).foregroundStyle(.secondary)
    }}
    func loadConfig(){let saved=store.state["config"];provider=saved["provider"].text.isEmpty ? "openai":saved["provider"].text;baseURL=saved["baseURL"].text;model=saved["model"].text}
    func changeProvider(){baseURL=["chatgpt":"https://api.openai.com/v1","openai":"https://api.openai.com/v1","deepseek":"https://api.deepseek.com/v1","anthropic":"https://api.anthropic.com/v1","gemini":"https://generativelanguage.googleapis.com/v1beta"][provider] ?? "";apiKey="";models=[];model="";connectionNotice="";if provider=="chatgpt"{Task{await refreshAccounts()}}}
    func refreshAccounts()async{do{auth=try await store.request("chatgpt/status");sync=try await store.request("sync/status");if auth["loggedIn"].flag && provider=="chatgpt"{models=(try await store.request("chatgpt/models"))["models"].list}}catch{connectionNotice=error.localizedDescription}}
    func syncAction(_ action:String,_ body:[String:J]=[:])async{
        guard store.busy.isEmpty else{return};store.busy="正在处理同步…";syncError="";syncNotice="";defer{store.busy=""}
        do{let result=try await store.request("sync/"+action,body);sync=result["status"];preview=result["preview"];if result["state"].exists{store.state=result["state"]}
            if action=="send-code"{syncNotice="验证码已发送，请查看邮箱。一分钟后可重新发送。"};if action=="verify"{code="";syncNotice="邮箱已验证，可以开启自动同步。"}
        }catch{syncError=error.localizedDescription}
    }
    func checkUpdate()async{await store.perform("检查更新…"){
        let response=try await store.runtime.http.send(.object(["url":.s("https://api.github.com/repos/3356153957/language-study-coach/releases/latest"),"headers":.object(["Accept":.s("application/vnd.github+json")])]))
        if response["status"].int==404{updateNotice="私有仓库无法匿名读取更新，请登录 GitHub 后查看发布页。";return}
        guard response["status"].int==200 else{throw StudyError("GitHub 暂时不可用，请稍后重试。")};let value=try J.decode(Data(response["body"].text.utf8));updateNotice="最新发布："+value["tag_name"].text
    }}
}
