import SwiftUI

struct LearningPlanScreen:View {
    @EnvironmentObject var store:StudyStore
    @State private var minutes=20
    @State private var targetDate=""
    @State private var scenario=""
    @State private var saved=false
    var body:some View{
        Form{
            Section("学习安排 · "+store.goal){
                Stepper("每天 \(minutes) 分钟",value:$minutes,in:5...120,step:5)
                TextField("目标日期（可选，YYYY-MM-DD）",text:$targetDate).textInputAutocapitalization(.never)
                TextField("想用英语做什么？（可选）",text:$scenario,axis:.vertical)
                Text("教练会参考安排出题。保存安排不会生成成绩，也不保证在期限内达到某分数。").font(.caption).foregroundStyle(.secondary)
            }
            Button("保存学习安排"){Task{
                saved=await store.perform("保存学习安排…"){
                    _ = try await store.request("learning-plan",["goal":.s(store.goal),"minutesPerDay":.n(minutes),"targetDate":.s(targetDate),"scenario":.s(scenario)])
                    await store.refresh()
                }
            }}.disabled(!store.busy.isEmpty)
            if saved{Text("已保存，下次出题会参考这份安排。").foregroundStyle(.secondary)}
        }.navigationTitle("我的学习安排").onAppear{
            let plan=store.state["profile"]["learningPlans"][store.goal]
            if plan.exists{minutes=plan["minutesPerDay"].int;targetDate=plan["targetDate"].text;scenario=plan["scenario"].text}
        }
    }
}

struct NextPracticePanel:View {
    @EnvironmentObject var store:StudyStore
    var reviews:J{store.state["reviews"][store.goal]}
    var body:some View{
        Panel{
            Text("接下来练什么").font(.headline)
            if !store.state["recommendations"][store.goal]["text"].text.isEmpty{
                Text(store.state["recommendations"][store.goal]["text"].text).font(.subheadline)
                Button("按教练建议练"){Task{await store.start("综合",useProfileFocus:true)}}.disabled(store.current.exists)
            }
            Text("\(reviews["dueCount"].int) 个知识点到期复习").font(.subheadline.weight(.semibold))
            ForEach(reviews["items"].list,id:\.reviewKey){item in
                HStack{
                    VStack(alignment:.leading){Text(item["skill"].text+" · "+item["weakness"].text);Text("下次 "+item["dueDate"].text+" · 跨日独立巩固 \(item["streak"].int)/3 次").font(.caption).foregroundStyle(.secondary)}
                    Spacer()
                    Button("再练"){Task{await store.start("综合",reviewID:item["reviewId"].text,reviewQuestionIndex:item["reviewQuestionIndex"].exists ? item["reviewQuestionIndex"].int:nil)}}.disabled(store.current.exists)
                }
            }
            Button("查看错题与复习安排"){store.tab=2}
            NavigationLink("我的学习安排"){LearningPlanScreen()}
            if store.current.exists{Text("先完成或结束当前轮，再开始新练习。").font(.caption).foregroundStyle(.secondary)}
        }
    }
}
extension J{var reviewKey:String{(self["reviewId"].text.isEmpty ? self["id"].text:self["reviewId"].text)+":"+self["reviewQuestionIndex"].text}}

struct FirstPracticePanel:View {
    @State private var choice=""
    var body:some View{
        Panel{
            Text("先体验一道示例题").font(.headline)
            Text("无需连接 AI，不写入学习记录。").font(.caption).foregroundStyle(.secondary)
            Text("I ___ a book yesterday.")
            HStack{ForEach(["read","reads"],id:\.self){value in Button(value){choice=value}.buttonStyle(.bordered)}}
            if !choice.isEmpty{Text((choice=="read" ? "答对了。":"应选 read。")+"Yesterday 表示过去，read 的过去式拼写不变，读音为 /red/。").font(.subheadline)}
        }
    }
}
