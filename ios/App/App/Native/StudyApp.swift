import SwiftUI

@main struct LanguageStudyApp:App {
    private static var useTestFixture:Bool{
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--ui-testing")
        #else
        return false
        #endif
    }
    @StateObject private var store=StudyStore(fixture:LanguageStudyApp.useTestFixture)
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
        .alert("暂时未能完成",isPresented:Binding(get:{!store.practice && !store.error.isEmpty},set:{if !$0 && !store.practice{store.error=""}})){Button("知道了"){store.error=""}}message:{Text(store.error)}
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
    @State private var detail:J = .null
    @State private var showDetail=false
    var days:[J]{store.state["totals"]["all"]["days"].list}
    var body:some View{
        NavigationStack{
            ScrollView{VStack(alignment:.leading,spacing:20){
                Text(Date.now.formatted(.dateTime.month().day().weekday())).font(.subheadline).foregroundStyle(.secondary)
                hero
                statistics
                Text("专项练习").font(.headline)
                specialties
                NavigationLink{ActivityScreen()}label:{WeeklyTable(days:days)}.buttonStyle(.plain)
                if ["四级","六级"].contains(store.goal){NavigationLink{ExamProgressScreen(goal:store.goal)}label:{ExamPanel(goal:store.goal,value:store.state["examOutlook"][store.goal])}.buttonStyle(.plain)}
                recent
            }.padding(20)}
            .background(StudyStyle.background).navigationTitle("学习概览").toolbar{GoalMenu()}
            .sheet(isPresented:$showDetail){RoundDetail(round:detail)}.refreshable{await store.refresh()}
        }
    }
    var hero:some View{
        VStack(alignment:.leading,spacing:16){
            Text("每天一点，学以致用。").font(.title2.bold())
            Text(store.current.exists ? "已为你保留上一轮的进度。":"从一道题开始，让教练逐步了解你。").font(.subheadline)
            Button{Task{await store.start("综合")}}label:{
                Label(store.current.exists ? "继续 "+store.current["goal"].text+"练习":"开始综合练习",systemImage:"arrow.right")
                    .font(.headline).padding(.vertical,10).padding(.horizontal,18).background(.white,in:Capsule()).foregroundStyle(StudyStyle.purple)
            }.accessibilityIdentifier("start-mixed")
        }.padding(24).frame(maxWidth:.infinity,alignment:.leading).foregroundStyle(.white).background(StudyStyle.purple,in:RoundedRectangle(cornerRadius:24))
    }
    var statistics:some View{
        HStack{
            NavigationLink{ActivityScreen()}label:{StatTile(title:"累计完成",value:"\(store.state["totals"]["all"]["count"].int) 题")}
            NavigationLink{ActivityScreen()}label:{StatTile(title:"近 7 天",value:"\(days.reduce(0){$0+$1["seconds"].int}/60) 分钟")}
            NavigationLink{ActivityScreen()}label:{StatTile(title:"近 7 天练习",value:"\(days.filter{$0["count"].int>0}.count) 天")}
        }.buttonStyle(.plain)
    }
    var specialties:some View{
        HStack(spacing:10){ForEach([("听力","headphones"),("写作","square.and.pencil"),("阅读","book")],id:\.0){mode,symbol in
            Button{Task{await store.start(mode)}}label:{
                VStack(spacing:10){Image(systemName:symbol).font(.title2);Text(mode+"练习").font(.subheadline.weight(.semibold))}
                    .frame(maxWidth:.infinity).padding(.vertical,18).background(.background,in:RoundedRectangle(cornerRadius:16))
            }.buttonStyle(.plain).accessibilityIdentifier("start-"+mode)
        }}
    }
    var recent:some View{
        Panel{
            HStack{Text("最近练习").font(.headline);Spacer();NavigationLink("全部"){ActivityScreen()}.font(.subheadline)}
            if recentItems.isEmpty{Text("完成一轮后，可以在这里回顾。").font(.subheadline).foregroundStyle(.secondary)}
            ForEach(recentItems,id:\.recordID){item in
                Button{Task{await store.perform("读取记录…"){detail=try await store.request("session/detail",["id":item["id"]]);showDetail=true}}}label:{
                    HStack{Label(item["mode"].text+"练习",systemImage:"clock");Spacer();Text("\(item["correct"].int) / \(item["count"].int)").foregroundStyle(.secondary);Image(systemName:"chevron.right")}.font(.subheadline).padding(.vertical,6)
                }.buttonStyle(.plain)
            }
        }
    }
    var recentItems:[J]{Array(store.state["recent"].list.filter{$0["goal"].text==store.goal}.prefix(5))}
}
struct StatTile:View {
    let title:String,value:String
    var body:some View{VStack(alignment:.leading,spacing:8){Text(title).font(.caption).foregroundStyle(.secondary);Text(value).font(.headline).minimumScaleFactor(0.7).lineLimit(1)}.frame(maxWidth:.infinity,alignment:.leading).padding(12).background(.background,in:RoundedRectangle(cornerRadius:14))}
}
struct WeeklyTable:View {
    let days:[J]
    var body:some View{
        Panel{
            HStack{Text("近 7 天").font(.headline);Spacer();Image(systemName:"chevron.right").foregroundStyle(.secondary)}
            HStack(alignment:.bottom,spacing:12){ForEach(days,id:\.dateKey){day in
                VStack{RoundedRectangle(cornerRadius:5).fill(StudyStyle.purple.opacity(day["count"].int>0 ? 0.8:0.12)).frame(height:CGFloat(max(4,min(66,day["count"].int*5))));Text(String(day["date"].text.suffix(2))).font(.caption2).foregroundStyle(.secondary)}.frame(maxWidth:.infinity)
            }}.frame(height:90)
            Grid(horizontalSpacing:12,verticalSpacing:10){
                GridRow{Text("日期");Text("完成");Text("正确率");Text("时长")}.foregroundStyle(.secondary)
                ForEach(days.reversed(),id:\.dateKey){day in GridRow{Text(String(day["date"].text.suffix(5)));Text("\(day["count"].int) 题");Text(day["count"].int>0 ? "\(day["correct"].int*100/day["count"].int)%":"—");Text("\(day["seconds"].int/60) 分")}}
            }.font(.caption).frame(maxWidth:.infinity)
        }
    }
}
struct ExamPanel:View {
    let goal:String,value:J
    var body:some View{
        Panel{
            HStack{Label(goal+"通过率",systemImage:"target").font(.headline);Spacer();Image(systemName:"chevron.right").foregroundStyle(.secondary)}
            if value["estimate"].exists{
                Text("\(value["estimate"]["low"].int)–\(value["estimate"]["high"].int)%").font(.title2.bold())
                Text(value["estimate"]["reason"].text).font(.caption).foregroundStyle(.secondary)
            }else{
                Text("预测依据积累中").font(.subheadline)
                ProgressView(value:Double(value["progress"].int),total:100).tint(StudyStyle.purple)
                Text("已积累 \(value["count"].int) 道独立作答 · 查看各项进度").font(.caption).foregroundStyle(.secondary)
            }
            Text("AI 学习建议，仅供备考参考").font(.caption2).foregroundStyle(.secondary)
        }
    }
}
struct ExamProgressScreen:View {
    @EnvironmentObject var store:StudyStore
    let goal:String
    var value:J{store.state["examOutlook"][goal]}
    var body:some View{
        List{
            Section{ExamPanel(goal:goal,value:value)}
            Section("预测需要哪些依据"){
                LabeledContent("无提示作答",value:"\(value["count"].int) / \(value["requiredCount"].int)")
                ForEach(["阅读","听力","表达"],id:\.self){skill in
                    LabeledContent(skill,value:"\(value["skillCounts"][skill].int) / 3")
                }
                Text(value["requirement"].text).font(.caption).foregroundStyle(.secondary)
                Text("使用提示、向教练求助或查看听力原文的题目会更新学习记录，但不会当作独立测试依据。").font(.caption).foregroundStyle(.secondary)
            }
            Section("补足练习"){
                ForEach(["阅读","听力","写作"],id:\.self){mode in Button(mode+"练习"){store.goal=goal;Task{await store.start(mode)}}}
            }
        }.navigationTitle(goal+"预测进度")
    }
}
struct ProgressScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var profile:J = .null
    var body:some View{
        NavigationStack{
            List{
                Section{
                    HStack{Text(profile["level"].text.isEmpty ? "正在了解你":profile["level"].text).font(.title2.bold());Spacer();Image(systemName:"sparkles").foregroundStyle(StudyStyle.purple)}
                    Text(profile["summary"].text.isEmpty ? "每次练习都会为能力画像增加依据。":profile["summary"].text).font(.subheadline).foregroundStyle(.secondary)
                }
                Section("各项能力"){ForEach(studySkills,id:\.self){skill in skillRow(skill)}}
                Section("等级说明"){Text("A1 入门 · A2 基础交流 · B1 中级\nB2 中高级 · C1 高级 · C2 精通").font(.subheadline)}
            }.navigationTitle("我的进展").task(id:store.state["profile"].json){await load()}.refreshable{await load()}
        }
    }
    func skillRow(_ skill:String)->some View{
        let item=profile["skills"].list.first{$0["name"].text==skill} ?? .null
        return DisclosureGroup{
            Text(item["evidence"].text.isEmpty ? "还需要更多练习记录。":item["evidence"].text).font(.subheadline)
        }label:{Label{HStack{Text(skill);Spacer();Text(item["level"].text.isEmpty ? "待积累":item["level"].text).foregroundStyle(.secondary)}}icon:{Image(systemName:skillSymbol(skill))}}
    }
    func load()async{do{profile=(try await store.request("profile"))["profile"]}catch{store.error=error.localizedDescription}}
}
struct ActivityScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var items:[J]=[]
    @State private var result:J = .null
    @State private var detail:J = .null
    @State private var showDetail=false
    @State private var loading=false
    var body:some View{
        List{
            if store.current.exists{Button("继续正在进行的练习"){store.practice=true}}
            if items.isEmpty && !loading{Text("完成的练习会保存在这里。").foregroundStyle(.secondary)}
            ForEach(items,id:\.recordID){item in activityRow(item)}
            if result["hasMore"].flag{Button("加载更多"){Task{await load(reset:false)}}.disabled(loading)}
            if loading{ProgressView()}
        }.navigationTitle("学习记录").task{await load(reset:true)}.refreshable{await load(reset:true)}.sheet(isPresented:$showDetail){RoundDetail(round:detail)}
    }
    func activityRow(_ item:J)->some View{
        Button{Task{await store.perform("读取记录…"){detail=try await store.request("session/detail",["id":item["id"]]);showDetail=true}}}label:{
            HStack{VStack(alignment:.leading){Text(item["goal"].text+" · "+item["mode"].text);Text(String(item["startedAt"].text.prefix(10))).font(.caption).foregroundStyle(.secondary)};Spacer();Text("\(item["correct"].int)/\(item["count"].int)")}
        }
    }
    func load(reset:Bool)async{
        guard !loading else{return};loading=true;defer{loading=false}
        do{let page=try await store.request("activity",["offset":.n(reset ? 0:items.count)]);result=page;items=reset ? page["items"].list:items+page["items"].list}
        catch{store.error=error.localizedDescription}
    }
}
func learnerAnswer(_ raw:String)->String{
    if let value=try? J.decode(Data(raw.utf8)),!value.list.isEmpty{return value.list.enumerated().map{"\($0.offset+1). \($0.element.text)"}.joined(separator:"\n")};return raw
}
struct RoundDetail:View {
    let round:J
    @Environment(\.dismiss) var dismiss
    var body:some View{
        NavigationStack{
            List{
                if round["report"].exists{Section("本轮小结"){Text(round["report"]["summary"].text);Text(round["report"]["nextFocus"].text).foregroundStyle(.secondary)}}
                ForEach(round["history"].list,id:\.recordID){entry in
                    Section(entry["task"]["skill"].text){
                        QuestionMaterial(task:entry["task"],answered:true)
                        Text("你的回答").font(.caption).foregroundStyle(.secondary)
                        Text(learnerAnswer(entry["answer"].text)).textSelection(.enabled)
                        FeedbackBubble(feedback:entry["feedback"])
                    }
                }
            }.navigationTitle("练习回顾").toolbar{Button("完成"){dismiss()}}
        }
    }
}
struct MistakesScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var items:[J]=[]
    @State private var result:J = .null
    @State private var loading=false
    @State private var loadID=UUID()
    var body:some View{
        NavigationStack{
            List{
                if items.isEmpty && !loading{Section{Label("这里会留下值得再练的知识点",systemImage:"checkmark.circle").padding(.vertical)}}
                ForEach(items,id:\.recordID){entry in mistakeRow(entry)}
                if result["hasMore"].flag{Button("加载更多"){Task{await load(reset:false)}}.disabled(loading)}
                if loading{ProgressView()}
            }.navigationTitle("错题回顾").toolbar{GoalMenu()}.task(id:store.goal+":"+String(store.state["totals"][store.goal]["count"].int)){await load(reset:true)}.refreshable{await load(reset:true)}
        }
    }
    func mistakeRow(_ entry:J)->some View{
        Section{
            QuestionMaterial(task:entry["task"],answered:true)
            Text(entry["feedback"]["explanation"].text).font(.subheadline)
            DisclosureGroup("回答与参考"){
                Text("你的回答："+learnerAnswer(entry["answer"].text))
                let questions=entry["task"]["questions"].list
                Text("参考表达："+(questions.isEmpty ? entry["task"]["answer"].text:questions.map{$0["answer"].text}.joined(separator:"\n")))
            }
            Button("换道题再练"){Task{await store.start("综合",reviewID:entry["id"].text)}}
        }
    }
    func load(reset:Bool)async{
        guard reset || !loading else{return};let id=UUID();loadID=id;loading=true;defer{if loadID==id{loading=false}}
        let goal=store.goal
        do{let page=try await store.request("review",["goal":.s(goal),"offset":.n(reset ? 0:items.count)]);guard id==loadID,goal==store.goal else{return};result=page;items=reset ? page["items"].list:items+page["items"].list}
        catch{if id==loadID{store.error=error.localizedDescription}}
    }
}
