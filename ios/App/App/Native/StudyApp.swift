import SwiftUI

@main struct LanguageStudyApp:App {
    @StateObject private var store=StudyStore(fixture:ProcessInfo.processInfo.arguments.contains("--ui-testing"))
    @Environment(\.scenePhase) private var scenePhase
    var body:some Scene{WindowGroup{StudyRoot().environmentObject(store).task{await store.refresh()}.onChange(of:scenePhase){phase in if phase == .active{Task{await store.foreground()}}}}}
}
enum StudyStyle {
    static let purple=Color(red:0.46,green:0.36,blue:0.66)
    static let background=Color(uiColor:.systemGroupedBackground)
}
struct StudyRoot:View {
    @EnvironmentObject var store:StudyStore
    var body:some View {
        TabView(selection:$store.tab){
            HomeScreen().tabItem{Label("学习",systemImage:"book")}.tag(0)
            ProgressScreen().tabItem{Label("进展",systemImage:"chart.bar.xaxis")}.tag(1)
            MistakesScreen().tabItem{Label("错题",systemImage:"arrow.counterclockwise")}.tag(2)
            SettingsScreen().tabItem{Label("设置",systemImage:"slider.horizontal.3")}.tag(3)
        }.tint(StudyStyle.purple)
        .fullScreenCover(isPresented:$store.practice){PracticeScreen().environmentObject(store)}
        .overlay(alignment:.top){if !store.busy.isEmpty && !store.practice{HStack{ProgressView();Text(store.busy).font(.subheadline)}.padding().background(.regularMaterial,in:Capsule()).padding(.top,8).accessibilityIdentifier("busy-status")}}
        .alert("暂时未能完成",isPresented:Binding(get:{!store.error.isEmpty},set:{if !$0{store.error=""}})){Button("知道了"){store.error=""}}message:{Text(store.error)}
    }
}
struct Panel<Content:View>:View {
    @ViewBuilder var content:Content
    var body:some View{VStack(alignment:.leading,spacing:16){content}.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(Color(uiColor:.secondarySystemGroupedBackground),in:RoundedRectangle(cornerRadius:20))}
}
let studyGoals=["四级","六级","高中英语","初中英语","日常英语"]
let studySkills=["阅读","听力","词汇","语法","表达"]
func skillSymbol(_ value:String)->String{["阅读":"book","听力":"headphones","词汇":"character.book.closed","语法":"textformat.abc","表达":"square.and.pencil"] [value] ?? "sparkles"}
struct GoalMenu:View {
    @EnvironmentObject var store:StudyStore
    var body:some View{Menu{ForEach(studyGoals,id:\.self){goal in Button(goal){store.goal=goal;UserDefaults.standard.set(goal,forKey:"native-goal")}}}label:{Label(store.goal,systemImage:"chevron.down").font(.subheadline.weight(.medium))}}
}
struct HomeScreen:View {
    @EnvironmentObject var store:StudyStore
    @State var detail:J = .null,showDetail=false
    var body:some View{
        NavigationStack{ScrollView{VStack(alignment:.leading,spacing:20){
            Text(Date.now.formatted(.dateTime.month().day().weekday())).font(.subheadline).foregroundStyle(.secondary)
            VStack(alignment:.leading,spacing:16){Text("每天一点，学以致用。").font(.title2.bold());Text("从一道题开始，让教练逐步了解你。").font(.subheadline);Button{Task{await store.start("综合")}}label:{Label(store.current.exists ? "继续练习":"开始综合练习",systemImage:"arrow.right").font(.headline).padding(.vertical,10).padding(.horizontal,18).background(.white,in:Capsule()).foregroundStyle(StudyStyle.purple)}.accessibilityIdentifier("start-mixed")}.padding(24).frame(maxWidth:.infinity,alignment:.leading).foregroundStyle(.white).background(StudyStyle.purple,in:RoundedRectangle(cornerRadius:24))
            HStack{StatTile(title:"累计完成",value:"\(store.state["totals"]["all"]["count"].int) 题");StatTile(title:"近 7 天",value:"\(weekSeconds/60) 分钟");StatTile(title:"练习天数",value:"\(days.filter{$0["count"].int>0}.count) 天")}
            Text("专项练习").font(.headline)
            HStack(spacing:10){ForEach([("听力","headphones"),("写作","square.and.pencil"),("阅读","book")],id:\.0){mode,symbol in Button{Task{await store.start(mode)}}label:{VStack(spacing:10){Image(systemName:symbol).font(.title2);Text(mode+"练习").font(.subheadline.weight(.semibold))}.frame(maxWidth:.infinity).padding(.vertical,18).background(.background,in:RoundedRectangle(cornerRadius:16))}.buttonStyle(.plain).accessibilityIdentifier("start-"+mode)}}
            WeeklyTable(days:days)
            if ["四级","六级"].contains(store.goal){ExamPanel(goal:store.goal,value:store.state["examOutlook"][store.goal])}
            Panel{HStack{Text("最近练习").font(.headline);Spacer();NavigationLink("全部"){ActivityScreen()}.font(.subheadline)};ForEach(store.state["recent"].list.filter{$0["goal"].text==store.goal}.prefix(5),id:\.json){item in Button{Task{await store.perform("读取记录…"){detail=try await store.request("session/detail",["id":item["id"]]);showDetail=true}}}label:{HStack{Label(item["mode"].text+"练习",systemImage:"clock");Spacer();Text("\(item["correct"].int) / \(item["count"].int)").foregroundStyle(.secondary);Image(systemName:"chevron.right")}.font(.subheadline).padding(.vertical,6)}.buttonStyle(.plain)}}
        }.padding(20)}.background(StudyStyle.background).navigationTitle("学习概览").toolbar{GoalMenu()}.sheet(isPresented:$showDetail){RoundDetail(round:detail)}.refreshable{await store.refresh()}}
    }
    var days:[J]{store.state["totals"]["all"]["days"].list}
    var weekSeconds:Int{days.reduce(0){$0+$1["seconds"].int}}
}
struct StatTile:View {let title:String,value:String;var body:some View{VStack(alignment:.leading,spacing:8){Text(title).font(.caption).foregroundStyle(.secondary);Text(value).font(.headline).minimumScaleFactor(0.7).lineLimit(1)}.frame(maxWidth:.infinity,alignment:.leading).padding(12).background(.background,in:RoundedRectangle(cornerRadius:14))}}
struct WeeklyTable:View {
    let days:[J]
    var body:some View{Panel{Text("近 7 天").font(.headline);HStack(alignment:.bottom,spacing:12){ForEach(days,id:\.json){day in VStack{RoundedRectangle(cornerRadius:5).fill(StudyStyle.purple.opacity(day["count"].int>0 ? 0.8:0.12)).frame(height:CGFloat(max(4,min(66,day["count"].int*5))));Text(String(day["date"].text.suffix(2))).font(.caption2).foregroundStyle(.secondary)}.frame(maxWidth:.infinity)}}.frame(height:90)
        Grid(horizontalSpacing:12,verticalSpacing:10){GridRow{Text("日期");Text("完成");Text("正确率");Text("时长")}.foregroundStyle(.secondary);ForEach(days.reversed(),id:\.json){day in GridRow{Text(String(day["date"].text.suffix(5)));Text("\(day["count"].int) 题");Text(day["count"].int>0 ? "\(day["correct"].int*100/day["count"].int)%":"—");Text("\(day["seconds"].int/60) 分")}}}.font(.caption).frame(maxWidth:.infinity)}}
}
struct ExamPanel:View {let goal:String,value:J;var body:some View{Panel{Label(goal+"通过率",systemImage:"target").font(.headline);if value["estimate"].exists{Text("\(value["estimate"]["low"].int)–\(value["estimate"]["high"].int)%").font(.title2.bold());Text(value["estimate"]["reason"].text).font(.caption).foregroundStyle(.secondary)}else{Text("继续积累阅读、听力和表达样本").font(.subheadline);Text("完成练习后，教练会根据证据更新判断。").font(.caption).foregroundStyle(.secondary)};Text("AI 学习建议，仅供备考参考").font(.caption2).foregroundStyle(.secondary)}}}
struct ProgressScreen:View {
    @EnvironmentObject var store:StudyStore
    @State var profile:J = .null
    var body:some View{NavigationStack{List{Section{HStack{Text(profile["level"].text.isEmpty ? "正在了解你":profile["level"].text).font(.title2.bold());Spacer();Image(systemName:"sparkles").foregroundStyle(StudyStyle.purple)};Text(profile["summary"].text.isEmpty ? "每次练习都会为能力画像增加依据。":profile["summary"].text).font(.subheadline).foregroundStyle(.secondary)};Section("各项能力"){ForEach(studySkills,id:\.self){skill in let item=profile["skills"].list.first{$0["name"].text==skill} ?? .null;DisclosureGroup{Text(item["evidence"].text.isEmpty ? "还需要更多练习记录。":item["evidence"].text).font(.subheadline)}label:{Label{HStack{Text(skill);Spacer();Text(item["level"].text.isEmpty ? "待积累":item["level"].text).foregroundStyle(.secondary)}}icon:{Image(systemName:skillSymbol(skill))}}}};Section("等级说明"){Text("A1 入门 · A2 基础交流 · B1 中级\nB2 中高级 · C1 高级 · C2 精通").font(.subheadline)}}.navigationTitle("我的进展").task{profile=(try? await store.request("profile"))?["profile"] ?? .null}.refreshable{profile=(try? await store.request("profile"))?["profile"] ?? .null}}}
}
struct ActivityScreen:View {
    @EnvironmentObject var store:StudyStore
    @State var result:J = .null,detail:J = .null,showDetail=false
    var body:some View{List{ForEach(result["items"].list,id:\.json){item in Button{Task{await store.perform("读取记录…"){detail=try await store.request("session/detail",["id":item["id"]]);showDetail=true}}}label:{HStack{VStack(alignment:.leading){Text(item["goal"].text+" · "+item["mode"].text);Text(String(item["startedAt"].text.prefix(10))).font(.caption).foregroundStyle(.secondary)};Spacer();Text("\(item["correct"].int)/\(item["count"].int)")}}};if result["hasMore"].flag{Button("下一页"){Task{result=(try? await store.request("activity",["offset":.n(result["offset"].int+20)])) ?? .null}}}}.navigationTitle("学习记录").task{result=(try? await store.request("activity")) ?? .null}.sheet(isPresented:$showDetail){RoundDetail(round:detail)}}
}
struct RoundDetail:View {let round:J;@Environment(\.dismiss) var dismiss;var body:some View{NavigationStack{List{if round["report"].exists{Section("本轮小结"){Text(round["report"]["summary"].text);Text(round["report"]["nextFocus"].text).foregroundStyle(.secondary)}};ForEach(round["history"].list,id:\.json){entry in Section(entry["task"]["skill"].text){Text(entry["task"]["prompt"].text);if !entry["task"]["passage"].text.isEmpty{Text(entry["task"]["passage"].text);Text(entry["task"]["translation"].text).foregroundStyle(.secondary)};LabeledContent("你的回答",value:entry["answer"].text);Text(entry["feedback"]["explanation"].text);if !entry["feedback"]["suggestion"].text.isEmpty{Text(entry["feedback"]["suggestion"].text).foregroundStyle(StudyStyle.purple)}}}}.navigationTitle("练习回顾").toolbar{Button("完成"){dismiss()}}}}}
struct MistakesScreen:View {
    @EnvironmentObject var store:StudyStore
    @State var result:J = .null
    var body:some View{NavigationStack{List{if result["items"].list.isEmpty{Section{Label("这里会留下值得再练的知识点",systemImage:"checkmark.circle").padding(.vertical)}};ForEach(result["items"].list,id:\.json){entry in Section{Text(entry["task"]["prompt"].text).font(.headline);Text(entry["feedback"]["explanation"].text).font(.subheadline);DisclosureGroup("回答与参考"){Text("你的回答："+entry["answer"].text);Text("参考表达："+entry["task"]["answer"].text)};Button("换道题再练"){Task{await store.start("综合",reviewID:entry["id"].text)}}}}.navigationTitle("错题回顾").toolbar{GoalMenu()}.task(id:store.goal){result=(try? await store.request("review",["goal":.s(store.goal)])) ?? .null}}}
}
