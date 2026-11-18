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
            WordbookScreen().tabItem{Label("单词本",systemImage:"character.book.closed")}.tag(4)
            SettingsScreen().tabItem{Label("设置",systemImage:"slider.horizontal.3")}.tag(3)
        }.tint(StudyStyle.purple)
        .fullScreenCover(isPresented:$store.practice){PracticeScreen().environmentObject(store)}
        .confirmationDialog("你有一轮练习未结束",isPresented:$store.showSwitch,titleVisibility:.visible){
            Button("继续当前练习"){store.practice=true}
            Button("结束当前轮并切换"){Task{await store.switchPractice()}}
            Button("取消",role:.cancel){}
        }message:{Text("已提交的回答和本机草稿会保留。先准备新题，成功后才结束当前轮，不等待 AI 小结。")}
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
    var body:some View{Menu{ForEach(studyGoals,id:\.self){goal in Button(goal){store.goal=goal;UserDefaults.standard.set(goal,forKey:"native-goal")}}}label:{HStack(spacing:6){Text(store.goal);Image(systemName:"chevron.down")}.font(.subheadline.weight(.medium))}.accessibilityIdentifier("learning-goal")}
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
                if !store.configured{FirstPracticePanel()}
                statistics
                NextPracticePanel()
                Text("专项练习").font(.headline)
                specialties
                NavigationLink{ActivityScreen()}label:{WeeklyTable(days:days)}.buttonStyle(.plain)
                if ["四级","六级"].contains(store.goal){NavigationLink{ExamProgressScreen(goal:store.goal)}label:{ExamPanel(goal:store.goal,value:store.state["examOutlook"][store.goal])}.buttonStyle(.plain).accessibilityIdentifier("exam-progress")}
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
                Text("最近一次预测").font(.subheadline)
                Text(value["estimate"]["probabilityText"].text).font(.title2.bold()).monospacedDigit().accessibilityIdentifier("exam-estimate")
                if !value["changeText"].text.isEmpty{Text(value["changeText"].text).font(.subheadline).accessibilityIdentifier("exam-change")}
                Text(value["estimate"]["updatedAt"].text.isEmpty ? "历史预测 · 生成日期未记录":"生成于 "+String(value["estimate"]["updatedAt"].text.prefix(10))).font(.caption).foregroundStyle(.secondary)
                Text(value["estimate"]["reason"].text).font(.caption).foregroundStyle(.secondary)
                if !value["estimate"]["sourceNote"].text.isEmpty{Text(value["estimate"]["sourceNote"].text).font(.caption).foregroundStyle(.secondary)}
            }else{
                Text(value["statusText"].text).font(.subheadline).accessibilityIdentifier("exam-status")
                ProgressView(value:Double(value["progress"].int),total:100).tint(StudyStyle.purple)
                Text("已积累 \(value["count"].int) 道独立作答 · 查看各项进度").font(.caption).foregroundStyle(.secondary)
            }
            Text(value["message"].text).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("exam-message")
            Text("AI 主观估计，尚未用真实考试成绩校准；两位小数只用于显示变化。").font(.caption2).foregroundStyle(.secondary)
        }
    }
}
struct ExamProgressScreen:View {
    @EnvironmentObject var store:StudyStore
    let goal:String
    @State private var assessmentID=UUID().uuidString.lowercased()
    var value:J{store.state["examOutlook"][goal]}
    var body:some View{
        List{
            Section{ExamPanel(goal:goal,value:value)}
            Section{
                Button(value["estimate"].exists ? "重新评估":"AI 评估"){
                    Task{let completed=await store.perform("AI 正在分析练习记录，评估通过率…"){
                        store.state=try await store.request("exam/assess",["goal":.s(goal),"requestId":.s(assessmentID)])
                    };if completed{assessmentID=UUID().uuidString.lowercased()}}
                }.disabled(!store.busy.isEmpty || !value["canAssess"].flag || !store.configured).accessibilityIdentifier("assess-exam")
                if !store.configured{Text("请先在设置中连接 AI。").font(.caption).foregroundStyle(.secondary)}
                Text("由你主动发起评估，保留上次结果并显示变化。").font(.caption).foregroundStyle(.secondary)
            }
            Section("练习依据 · 建议样本量"){
                LabeledContent("无提示作答",value:"\(value["count"].int) / \(value["requiredCount"].int)")
                ForEach(["阅读","听力","表达"],id:\.self){skill in
                    LabeledContent(skill,value:"\(value["skillCounts"][skill].int) / 3")
                }
                Text("建议积累 20 道独立作答，阅读、听力、表达各至少 3 道。样本较少时也可请求初步评估。").font(.caption).foregroundStyle(.secondary)
                Text("使用提示、向教练求助或查看听力原文的题目会更新学习记录，但不会当作独立测试依据。").font(.caption).foregroundStyle(.secondary)
            }
            Section("补足练习"){
                ForEach(["阅读","听力","写作"],id:\.self){mode in Button(mode+"练习"){store.goal=goal;Task{await store.start(mode)}}}
            }
        }.navigationTitle(goal+"通过率评估")
    }
}
struct ProgressScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var profile:J = .null
    @State private var progress:J = .null
    var body:some View{
        NavigationStack{
            List{
                Section{
                    HStack{Text(profile["level"].text.isEmpty ? "正在了解你":profile["level"].text).font(.title2.bold());Spacer();Image(systemName:"sparkles").foregroundStyle(StudyStyle.purple)}
                    Text(profile["summary"].text.isEmpty ? "每次练习都会为能力画像增加依据。":profile["summary"].text).font(.subheadline).foregroundStyle(.secondary)
                }
                Section("各项能力"){ForEach(studySkills,id:\.self){skill in skillRow(skill)}}
                Section("同难度表现变化"){
                    Text(progress["note"].text).font(.caption).foregroundStyle(.secondary)
                    ForEach(progress["comparisons"].list,id:\.skillName){row in
                        VStack(alignment:.leading,spacing:5){
                            Text(row["name"].text+" "+row["level"].text).font(.subheadline.bold())
                            Text("此前 7 天 \(row["previous"]["correct"].int)/\(row["previous"]["count"].int) · 近 7 天 \(row["recent"]["correct"].int)/\(row["recent"]["count"].int)").font(.caption)
                            Text(row["ready"].flag ? "变化 \(row["change"].int) 个百分点":"样本不足，暂不判断变化").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if !progress["otherComparisons"].list.isEmpty{Section("其他难度的表现"){
                    Text("画像变化不会清除已练难度的记录；各难度分别比较。").font(.caption).foregroundStyle(.secondary)
                    ForEach(progress["otherComparisons"].list,id:\.progressKey){row in
                        VStack(alignment:.leading,spacing:5){Text(row["name"].text+" "+row["level"].text).font(.subheadline.bold());Text("此前 7 天 \(row["previous"]["correct"].int)/\(row["previous"]["count"].int) · 近 7 天 \(row["recent"]["correct"].int)/\(row["recent"]["count"].int)").font(.caption);Text(row["ready"].flag ? "变化 \(row["change"].int) 个百分点":"样本不足，暂不判断变化").font(.caption).foregroundStyle(.secondary)}
                    }
                }}
                Section("各轮能力判断"){
                    if progress["levelHistory"].list.isEmpty{Text("完成学习小结后可在此对照。").font(.caption).foregroundStyle(.secondary)}
                    ForEach(progress["levelHistory"].list,id:\.historyKey){point in LabeledContent(String(point["at"].text.prefix(10)),value:point["level"].text)}
                }
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
    func load()async{do{let result=try await store.request("profile");profile=result["profile"];progress=result["progress"]}catch{store.error=error.localizedDescription}}
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
    @EnvironmentObject var store:StudyStore
    let round:J
    @State private var recovered:J = .null
    var record:J{recovered.exists ? recovered:round}
    @Environment(\.dismiss) var dismiss
    var body:some View{
        NavigationStack{
            List{
                if record["report"].exists{Section("本轮小结"){Text(record["report"]["summary"].text);Text(record["report"]["nextFocus"].text).foregroundStyle(.secondary);if !record["report"]["nextFocus"].text.isEmpty{Button("按这个建议继续练"){store.goal=record["goal"].text;dismiss();Task{await store.start("综合",recommendationID:record["id"].text)}}.disabled(store.current.exists)}}}
                if !record["report"].exists && !record["history"].list.isEmpty{
                    Section{
                        Button("补生成本轮小结"){let id=record["id"];Task{await store.perform("根据已保存的回答补生成小结…"){
                            store.state=try await store.request("session/report",["sessionId":id]);recovered=try await store.request("session/detail",["id":id])
                        }}}.disabled(!store.busy.isEmpty)
                        Text("只使用本轮结束时已有的作答，不重新判分或增加时长。").font(.caption).foregroundStyle(.secondary)
                        if !store.error.isEmpty{Text(store.error).font(.caption).foregroundStyle(.red)}
                    }
                }
                if record["report"]["generatedAt"].exists{Text("按本轮结束时的记录补生成，不表示今天的能力变化。").font(.caption).foregroundStyle(.secondary)}
                ForEach(record["history"].list,id:\.recordID){entry in
                    Section(entry["task"]["skill"].text){
                        QuestionMaterial(task:entry["task"],answered:true,showQuestions:false,sessionID:record["id"].text,wordMarks:record["wordMarks"].list)
                        NativeAnswerReview(entry:entry)
                        FeedbackBubble(feedback:entry["feedback"])
                    }
                }
                if record["unfinished"].exists{Section("未提交的草稿 · 未计分"){
                    QuestionMaterial(task:record["unfinished"]["task"],answered:false,sessionID:record["id"].text,wordMarks:record["wordMarks"].list)
                    Text(learnerAnswer(record["unfinished"]["answer"].text)).textSelection(.enabled)
                    Text("结束本轮时保留，未加入题数、时长或能力判断。").font(.caption).foregroundStyle(.secondary)
                    ForEach(record["discussions"][record["unfinished"]["task"]["id"].text].list,id:\.recordID){turn in Text("你："+turn["message"].text);Text("教练："+turn["reply"].text)}
                }}
                if !record["reportError"].text.isEmpty{Section{Text(record["reportError"].text).font(.subheadline).foregroundStyle(.secondary)}}
            }.navigationTitle("练习回顾").toolbar{Button("完成"){dismiss()}}
            .task(id:store.state["wordbook"].json){do{recovered=try await store.request("session/detail",["id":round["id"]])}catch{store.error=error.localizedDescription}}
        }
    }
}
struct MistakesScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var items:[J]=[]
    @State private var result:J = .null
    @State private var loading=false
    @State private var loadID=UUID()
    @State private var filter="all"
    var body:some View{
        NavigationStack{
            List{
                Picker("显示",selection:$filter){Text("全部错题").tag("all");Text("到期复习").tag("due")}.pickerStyle(.segmented)
                if items.isEmpty && !loading{Section{Label("这里会留下值得再练的知识点",systemImage:"checkmark.circle").padding(.vertical)}}
                ForEach(items,id:\.reviewKey){entry in mistakeRow(entry)}
                if result["hasMore"].flag{Button("加载更多"){Task{await load(reset:false)}}.disabled(loading)}
                if loading{ProgressView()}
            }.navigationTitle("错题回顾").toolbar{GoalMenu()}.task(id:store.goal+":"+filter+":"+String(store.state["totals"][store.goal]["count"].int)){await load(reset:true)}.refreshable{await load(reset:true)}
        }
    }
    func mistakeRow(_ entry:J)->some View{
        Section{
            if entry["reviewStatus"]["weakness"].exists{Text(entry["reviewStatus"]["weakness"].text).font(.headline)}
            if entry["reviewQuestionIndex"].exists{Text("本次复习原题第 \(entry["reviewQuestionIndex"].int+1) 小题的知识点").font(.caption).foregroundStyle(.secondary)}
            QuestionMaterial(task:entry["task"],answered:true,showQuestions:false)
            Text(entry["feedback"]["explanation"].text).font(.subheadline)
            DisclosureGroup("回答与参考"){
                NativeAnswerReview(entry:entry)
            }
            if entry["reviewStatus"].exists{Text(entry["reviewStatus"]["status"].text+" · 下次 "+entry["reviewStatus"]["dueDate"].text+" · 跨日独立巩固 \(entry["reviewStatus"]["streak"].int)/3 次").font(.caption).foregroundStyle(.secondary)}
            Button("换道题再练"){Task{await store.start("综合",reviewID:entry["id"].text,reviewQuestionIndex:entry["reviewQuestionIndex"].exists ? entry["reviewQuestionIndex"].int:nil)}}
        }
    }
    func load(reset:Bool)async{
        guard reset || !loading else{return};let id=UUID();loadID=id;loading=true;defer{if loadID==id{loading=false}}
        let goal=store.goal,selectedFilter=filter
        do{let page=try await store.request("review",["goal":.s(goal),"filter":.s(selectedFilter),"offset":.n(reset ? 0:items.count)]);guard id==loadID,goal==store.goal else{return};result=page;items=reset ? page["items"].list:items+page["items"].list}
        catch{if id==loadID{store.error=error.localizedDescription}}
    }
}

extension J{var skillName:String{self["name"].text}}

extension J{var historyKey:String{self["sessionId"].text}}

extension J{var progressKey:String{self["name"].text+":"+self["level"].text}}

struct WordbookScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var query=""
    @State private var filter="learning"
    @State private var detail:J = .null
    @State private var showDetail=false
    var all:[J]{store.state["wordbook"].list}
    var items:[J]{all.filter{(filter=="all" || $0["status"].text==filter) && (query.isEmpty || ($0["word"].text.localizedCaseInsensitiveContains(query) || $0["meaning"].text.localizedCaseInsensitiveContains(query)))}}
    var body:some View{
        NavigationStack{
            List{
                Section{
                    Text("待学习 \(all.filter{$0["status"].text=="learning"}.count) 个 · 已掌握 \(all.filter{$0["status"].text=="mastered"}.count) 个").font(.subheadline)
                    Picker("显示",selection:$filter){Text("待学习").tag("learning");Text("已掌握").tag("mastered");Text("全部").tag("all")}.pickerStyle(.segmented)
                }
                if items.isEmpty{Section{Text(all.isEmpty ? "阅读时点击不认识的英文单词，原句会一起保存到这里。":"没有符合条件的单词，试试其他搜索词或显示范围。").foregroundStyle(.secondary)}}
                ForEach(items,id:\.wordID){item in wordRow(item)}
            }.navigationTitle("单词本").searchable(text:$query,prompt:"搜索英文或中文").task{await defineWords()}.refreshable{await store.refresh();await defineWords()}
                .sheet(isPresented:$showDetail){RoundDetail(round:detail)}
        }
    }
    func wordRow(_ item:J)->some View{
        Section{
            HStack{Text(item["word"].text).font(.title2.bold());Spacer();Text("\(item["count"].int) 篇标记").font(.caption).foregroundStyle(.secondary)}
            if !item["meaning"].text.isEmpty{
                Text(item["meaning"].text).font(.title3.weight(.semibold)).foregroundStyle(StudyStyle.purple).padding(12).frame(maxWidth:.infinity,alignment:.leading).background(StudyStyle.purple.opacity(0.08),in:RoundedRectangle(cornerRadius:12))
            }else{
                Text("中文释义待补充").foregroundStyle(.secondary)
                Button(store.configured ? "获取中文释义":"连接 AI 获取释义"){if store.configured{Task{await defineWords(item["word"].text)}}else{store.tab=3}}.disabled(!store.busy.isEmpty)
            }
            ForEach(Array(item["sources"].list.enumerated()),id:\.offset){_,source in
                Text(source["context"].text).font(.body).textSelection(.enabled)
                if !source["translation"].text.isEmpty{Text(source["translation"].text).font(.subheadline).foregroundStyle(.secondary)}
                Button(source["goal"].text+" · 查看原文"){
                    if store.current["id"]==source["sessionId"]{store.practice=true}
                    else{Task{await store.perform("读取原文…"){detail=try await store.request("session/detail",["id":source["sessionId"]]);showDetail=true}}}
                }.font(.caption)
            }
            HStack{
                Button(item["status"].text=="mastered" ? "重新学习":"标记已掌握"){update(item,item["status"].text=="mastered" ? "learning":"mastered")}.buttonStyle(.bordered)
                Spacer()
                Button("移出",role:.destructive){update(item,"removed")}.buttonStyle(.borderless)
            }.disabled(!store.busy.isEmpty)
        }
    }
    func defineWords(_ word:String?=nil)async{
        let words=word.map{[$0]} ?? Array(all.filter{$0["meaning"].text.isEmpty}.prefix(8).map{$0["word"].text})
        guard store.configured,!words.isEmpty else{return}
        await store.perform("正在生成中文释义，生词已保存…"){store.state=try await store.request("vocabulary/define",["words":.array(words.map{.s($0)})])}
    }
    func update(_ item:J,_ status:String){Task{await store.perform("更新单词本…"){store.state=try await store.request("vocabulary/status",["word":item["word"],"status":.s(status)])}}}
}
extension J{var wordID:String{self["word"].text}}
