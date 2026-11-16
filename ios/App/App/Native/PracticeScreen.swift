import SwiftUI
import UIKit

// Native UITextView preserves IME composition, selection and keyboard focus.
struct AnswerEditor:UIViewRepresentable {
    @Binding var text:String
    var active:Bool=false
    var identifier:String
    var returnKey:UIReturnKeyType = .send
    var limit:Int=4000
    var onFocus:()->Void={}
    var onReturn:()->Void={}
    func makeUIView(context:Context)->UITextView {
        let view=UITextView();view.font = .preferredFont(forTextStyle:.body);view.adjustsFontForContentSizeCategory=true;view.backgroundColor = .secondarySystemGroupedBackground
        view.layer.cornerRadius=12;view.textContainerInset=UIEdgeInsets(top:12,left:10,bottom:12,right:10)
        view.delegate=context.coordinator;view.accessibilityLabel="你的回答";view.accessibilityIdentifier=identifier;view.returnKeyType=returnKey
        return view
    }
    func updateUIView(_ view:UITextView,context:Context){context.coordinator.parent=self;view.returnKeyType=returnKey;if view.text != text && view.markedTextRange==nil{view.text=text};if active && !view.isFirstResponder{DispatchQueue.main.async{if view.window != nil && context.coordinator.parent.active{view.becomeFirstResponder()}}}}
    func makeCoordinator()->Coordinator{Coordinator(self)}
    class Coordinator:NSObject,UITextViewDelegate {
        var parent:AnswerEditor
        init(_ parent:AnswerEditor){self.parent=parent}
        func textViewDidBeginEditing(_ textView:UITextView){parent.onFocus()}
        func textViewDidChange(_ textView:UITextView){
            let raw=textView.text ?? "",limited=String(raw.prefix(parent.limit))
            if textView.markedTextRange==nil && raw != limited{textView.text=limited}
            parent.text=textView.markedTextRange==nil ? limited:raw
        }
        func textView(_ textView:UITextView,shouldChangeTextIn range:NSRange,replacementText text:String)->Bool{
            if text=="\n" && textView.markedTextRange==nil{parent.onReturn();return false};return true
        }
    }
}
struct PracticeScreen:View {
    @EnvironmentObject var store:StudyStore
    @Environment(\.dismiss) var dismiss
    @Environment(\.verticalSizeClass) var verticalSize
    @Environment(\.scenePhase) var scenePhase
    @State private var answers:[String]=[]
    @State private var coachText=""
    @State private var coaching=false
    @State private var focus:Int?=nil
    @State private var hint=false
    @State private var transcript=false
    @State private var replays=0
    @State private var seconds=0
    @State private var lastTask=""
    @State private var requestID=UUID().uuidString.lowercased()
    @State private var discussionTaskID=""
    @State private var summary:J = .null
    @State private var showSummary=false
    @State private var usedTranscript=false
    @State private var draftWarning=""
    @State private var draftSave:Task<Void,Never>?
    private let timer=Timer.publish(every:1,on:.main,in:.common).autoconnect()
    var session:J{store.current}
    var task:J{session["current"]}
    var questions:[J]{task["questions"].list.isEmpty ? [.object(["prompt":task["prompt"],"options":task["options"]])]:task["questions"].list}
    var complete:Bool{answers.count==questions.count && answers.allSatisfy{!$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}}
    var body:some View{
        lifecycle
            .sheet(isPresented:$showSummary,onDismiss:summaryDismissed){RoundDetail(round:summary)}
            .alert("未能完成",isPresented:errorPresented){Button("知道了"){store.error=""}}message:{Text(store.error)}
    }
    var lifecycle:some View{
        NavigationStack{ScrollViewReader{proxy in conversation(proxy)}}
            .onAppear(perform:restoreDraft)
            .onChange(of:task.recordID){_ in restoreDraft()}
            .onReceive(timer){_ in tick()}
            .onChange(of:coachText){_ in persistDraft()}
            .onChange(of:coaching){active in if !active{discussionTaskID=task.recordID};persistDraft()}
            .onChange(of:scenePhase){phase in if phase != .active{saveAndStop()}}
            .onDisappear(perform:saveAndStop)
    }
    func conversation(_ proxy:ScrollViewProxy)->some View{
        conversationContent(proxy)
            .safeAreaInset(edge:.bottom,spacing:0){composer}
            .navigationTitle(session.exists ? session["goal"].text+" · "+session["mode"].text+"练习":"练习")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar{navigationControls}
            .toolbar{keyboardControls}
            .onChange(of:session["history"].list.count){_ in scrollToLatest(proxy)}
            .onChange(of:discussionCount){_ in scrollToLatest(proxy)}
            .onChange(of:focus){_ in scrollToFocusedField(proxy)}
            .onReceive(NotificationCenter.default.publisher(for:UIResponder.keyboardDidShowNotification)){_ in scrollToFocusedField(proxy)}
    }
    func conversationContent(_ proxy:ScrollViewProxy)->some View{
        ScrollView{
            LazyVStack(alignment:.leading,spacing:22){
                ForEach(session["history"].list,id:\.recordID){entry in historyMessage(entry)}
                if !session["feedback"].exists{
                    currentQuestion(proxy).disabled(!store.busy.isEmpty)
                    discussionTurns(task.recordID)
                }
                if !store.busy.isEmpty{HStack{ProgressView();Text(store.busy).font(.subheadline)}.accessibilityIdentifier("practice-busy")}
                Color.clear.frame(height:1).id("latest")
            }.padding(18)
        }.scrollDismissesKeyboard(.interactively).background(StudyStyle.background)
    }
    @ToolbarContentBuilder var navigationControls:some ToolbarContent{
        ToolbarItem(placement:.navigationBarLeading){Button("学习"){dismiss()}}
        ToolbarItem(placement:.navigationBarTrailing){Button("结束本轮",action:finish).disabled(!store.busy.isEmpty)}
    }
    @ToolbarContentBuilder var keyboardControls:some ToolbarContent{
        ToolbarItemGroup(placement:.keyboard){Spacer();Button("收起键盘",action:hideKeyboard)}
    }
    var discussionCount:Int{session["discussions"][task.recordID].list.count}
    var errorPresented:Binding<Bool>{Binding(get:{!store.error.isEmpty},set:{if !$0{store.error=""}})}
    func scrollToLatest(_ proxy:ScrollViewProxy){withAnimation{proxy.scrollTo("latest",anchor:.bottom)}}
    func scrollToFocusedField(_ proxy:ScrollViewProxy){
        if let index=focus,index>=0,questions.count>1{withAnimation{proxy.scrollTo("field-\(index)",anchor:.center)}}
    }
    func hideKeyboard(){focus=nil;UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil)}
    func saveAndStop(){store.speech.stopSpeaking(at:.immediate);persistDraft(immediately:true)}
    func summaryDismissed(){if !store.current.exists{dismiss()}}
    func tick(){
        if scenePhase == .active && !session["feedback"].exists && store.busy.isEmpty{
            seconds=min(1800,seconds+1);if seconds%10==0{persistDraft()}
        }
    }
    @ViewBuilder func historyMessage(_ entry:J)->some View{
        QuestionMaterial(task:entry["task"],answered:true)
        HStack{Spacer();Text(learnerAnswer(entry["answer"].text)).padding(14).background(StudyStyle.purple.opacity(0.12),in:RoundedRectangle(cornerRadius:16))}
        FeedbackBubble(feedback:entry["feedback"])
        DisclosureGroup("参考表达"){ForEach(Array(referenceAnswers(entry["task"]).enumerated()),id:\.offset){_,answer in Text(answer).font(.subheadline)}}
        discussionTurns(entry["task"]["id"].text)
        Button("追问这道题"){discussionTaskID=entry["task"]["id"].text;coaching=true;focus = -1}
    }
    @ViewBuilder func currentQuestion(_ proxy:ScrollViewProxy)->some View{
        QuestionMaterial(task:task,answered:false)
        if !task["audio"].text.isEmpty{listeningControls}
        ForEach(Array(questions.enumerated()),id:\.offset){index,item in
            VStack(alignment:.leading,spacing:12){
                if questions.count>1{Text("\(index+1). "+item["prompt"].text).font(.headline)}
                if !item["options"].list.isEmpty{
                    ForEach(Array(item["options"].list.enumerated()),id:\.offset){option,value in choice(index:index,option:option,value:value.text)}
                }else if questions.count>1 && verticalSize == .compact{
                    Button{focus=index}label:{Text(answers.indices.contains(index) && !answers[index].isEmpty ? answers[index]:"填写第 \(index+1) 项回答").frame(maxWidth:.infinity,alignment:.leading).padding(12).background(.background,in:RoundedRectangle(cornerRadius:12))}.buttonStyle(.plain)
                }else if questions.count>1{
                    AnswerEditor(text:answerBinding(index),active:focus==index,identifier:"answer-\(index)",returnKey:index+1<questions.count ? .next:.send,onFocus:{focus=index},onReturn:{
                        if index+1<questions.count{focus=index+1;withAnimation{proxy.scrollTo("field-\(index+1)",anchor:.center)}}else{submit()}
                    }).frame(height:90).id("field-\(index)")
                }
            }
        }
        Button(hint ? "提示已展开":"给我一点提示"){hint=true;persistDraft()}
        if hint{Text(task["hint"].text).font(.subheadline).foregroundStyle(.secondary)}
    }
    @ViewBuilder var listeningControls:some View{
        HStack{
            Button{if !store.speech.isSpeaking{replays=min(100,replays+1)};store.speak(task["audio"].text);persistDraft()}label:{Label(store.speech.isSpeaking ? "停止播放":"播放听力",systemImage:"play.circle.fill")}
            Button(transcript ? "收起原文":"查看原文"){transcript.toggle();usedTranscript=true;persistDraft()}
        }
        if transcript{Text(task["audio"].text).font(.subheadline).foregroundStyle(.secondary)}
    }
    func choice(index:Int,option:Int,value:String)->some View{
        let selected=answers.indices.contains(index) && answers[index]==value
        return Button{setAnswer(index,value)}label:{
            HStack(alignment:.top,spacing:12){
                Text(String(UnicodeScalar(65+option)!)).font(.subheadline.weight(.semibold)).frame(width:24)
                Text(value).frame(maxWidth:.infinity,alignment:.leading)
                if selected{Image(systemName:"checkmark.circle.fill")}
            }.padding(14)
                .background(selected ? StudyStyle.purple.opacity(0.14):Color(uiColor:.secondarySystemGroupedBackground),in:RoundedRectangle(cornerRadius:14))
                .overlay(RoundedRectangle(cornerRadius:14).stroke(StudyStyle.purple.opacity(selected ? 0.7:0.1)))
        }.buttonStyle(.plain).accessibilityIdentifier("option-\(index)-\(option)")
    }
    var compactIndex:Int?{
        if let index=focus,index>=0,index<questions.count,questions[index]["options"].list.isEmpty{return index}
        return questions.indices.first{questions[$0]["options"].list.isEmpty}
    }
    var composer:some View{
        Group{
            if verticalSize == .compact,questions.count>1,!coaching,!session["feedback"].exists,let index=compactIndex{compactComposer(index)}
            else{standardComposer}
        }.padding(verticalSize == .compact ? 8:12).background(.regularMaterial).disabled(!store.busy.isEmpty)
    }
    func compactComposer(_ index:Int)->some View{
        VStack(alignment:.leading,spacing:6){
            HStack(spacing:10){
                Picker("输入用途",selection:$coaching){Text("作答").tag(false);Text("问教练").tag(true)}.pickerStyle(.segmented).frame(width:150)
                Button{focus=max(0,index-1)}label:{Image(systemName:"chevron.left")}.disabled(index==0).accessibilityLabel("上一项回答")
                Text("\(index+1)/\(questions.count)").font(.caption)
                Button{focus=min(questions.count-1,index+1)}label:{Image(systemName:"chevron.right")}.disabled(index+1==questions.count).accessibilityLabel("下一项回答")
                Spacer()
                Button(action:submit){Image(systemName:"arrow.up")}.buttonStyle(.borderedProminent).disabled(!complete).accessibilityIdentifier("send-answer")
            }
            Text(questions[index]["prompt"].text).font(.subheadline).lineLimit(2)
            AnswerEditor(text:answerBinding(index),active:focus==index,identifier:"answer-\(index)",returnKey:index+1<questions.count ? .next:.send,onFocus:{focus=index},onReturn:{if index+1<questions.count{focus=index+1}else{submit()}}).frame(height:54).id("compact-answer-\(index)")
            if !draftWarning.isEmpty{Text(draftWarning).font(.caption).foregroundStyle(.red)}
        }
    }
    var standardComposer:some View{VStack(spacing:10){
        if !draftWarning.isEmpty{Text(draftWarning).font(.caption).foregroundStyle(.red)}
        if !discussionTaskID.isEmpty && discussionTaskID != task["id"].text{HStack{Text("正在追问之前的题目").font(.caption);Spacer();Button("回到当前题"){discussionTaskID=task["id"].text}}}
        if session["feedback"].exists{Button{Task{if session["history"].list.count>=session["targetCount"].int{finish()}else{await store.perform("正在切换下一题…"){store.state=try await store.request("session/next",["sessionId":session["id"],"taskId":task["id"]]);coaching=false}}}}label:{Label(session["history"].list.count>=session["targetCount"].int ? "生成本轮小结":session["nextReady"].flag ? "下一题已准备好，继续":"继续下一题",systemImage:"arrow.right")}.buttonStyle(.borderedProminent).accessibilityIdentifier("next-task")}
        HStack{if !session["feedback"].exists{Picker("输入用途",selection:$coaching){Text("作答").tag(false);Text("问教练").tag(true)}.pickerStyle(.segmented).frame(maxWidth:190)}else{Text("继续问教练").font(.subheadline.weight(.medium))};Spacer();if questions.count>1 && !coaching && !session["feedback"].exists{Text("\(answers.filter{!$0.isEmpty}.count)/\(questions.count)").font(.caption).foregroundStyle(.secondary)}}
        if coaching || session["feedback"].exists{AnswerEditor(text:$coachText,active:focus == -1,identifier:"coach-message",limit:2000,onFocus:{focus = -1},onReturn:{sendCoach()}).frame(height:verticalSize == .compact ? 44:76)}
        else if questions.count==1 && questions[0]["options"].list.isEmpty{AnswerEditor(text:answerBinding(0),active:focus==0,identifier:"answer-0",onFocus:{focus=0},onReturn:{submit()}).frame(height:verticalSize == .compact ? 44:90)}
        HStack{Text(coaching || session["feedback"].exists ? "中文或英文都可以":"可用键盘麦克风听写").font(.caption).foregroundStyle(.secondary);Spacer();Button{if coaching || session["feedback"].exists{sendCoach()}else{submit()}}label:{Image(systemName:"arrow.up").font(.headline).frame(width:40,height:36)}.buttonStyle(.borderedProminent).disabled(!store.busy.isEmpty || (coaching || session["feedback"].exists ? coachText.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty:!complete)).accessibilityIdentifier("send-answer")}
    }}
    func answerBinding(_ index:Int)->Binding<String>{Binding(get:{answers.indices.contains(index) ? answers[index]:""},set:{setAnswer(index,$0)})}
    func setAnswer(_ index:Int,_ value:String){if answers.count != questions.count{answers=Array(repeating:"",count:questions.count)};answers[index]=String(value.prefix(4000));persistDraft()}
    func persistDraft(immediately:Bool=false){
        draftSave?.cancel();guard !store.runtime.fixture,!task["id"].text.isEmpty else{return}
        let value=J.object(["taskId":task["id"],"answers":.array(answers.map{.s($0)}),"coachText":.s(coachText),"coaching":.bool(coaching),"seconds":.n(seconds),"hint":.bool(hint),"transcriptViewed":.bool(usedTranscript),"replays":.n(replays),"discussionTaskID":.s(discussionTaskID),"requestId":.s(requestID)]).json
        if immediately{saveDraft(value);return}
        draftSave=Task{@MainActor in do{try await Task.sleep(nanoseconds:300_000_000);try Task.checkCancellation();saveDraft(value)}catch{}}
    }
    func saveDraft(_ value:String){do{try store.runtime.vault.write("native-draft",value);draftWarning=""}catch{draftWarning="草稿暂未保存，请检查手机空间并保留当前页面。"}}
    func restoreDraft(){
        guard lastTask != task["id"].text else{return};draftSave?.cancel();lastTask=task["id"].text;discussionTaskID=task["id"].text;answers=Array(repeating:"",count:questions.count);hint=false;transcript=false;usedTranscript=false;replays=0;seconds=0;coachText="";coaching=session["feedback"].exists;focus=nil
        guard !store.runtime.fixture else{return}
        do{if let text=try store.runtime.vault.read("native-draft"){
            let value=try J.decode(Data(text.utf8));guard value["taskId"]==task["id"],value["answers"].list.count==questions.count else{return}
            coaching=session["feedback"].exists || value["coaching"].flag;answers=value["answers"].list.map{String($0.text.prefix(4000))};coachText=String(value["coachText"].text.prefix(2000));seconds=min(1800,max(0,value["seconds"].int));replays=min(100,max(0,value["replays"].int));hint=value["hint"].flag;usedTranscript=value["transcriptViewed"].flag
            let discussionID=value["discussionTaskID"].text
            if discussionID==task["id"].text || session["history"].list.contains(where:{$0["task"]["id"].text==discussionID}){discussionTaskID=discussionID}
            if UUID(uuidString:value["requestId"].text) != nil{requestID=value["requestId"].text}
        }}catch{draftWarning="未能恢复上次草稿，已保存的正式作答仍然保留。"}
    }
    func submit(){guard complete,!session["feedback"].exists else{return};focus=nil;persistDraft(immediately:true);UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);Task{await store.perform("正在批改并准备下一题…"){store.state=try await store.request("session/answer",["sessionId":session["id"],"taskId":task["id"],"answer":.s(answers.count>1 ? J.array(answers.map{.s($0)}).json:answers[0]),"activeSeconds":.n(seconds),"hintUsed":.bool(hint),"transcriptViewed":.bool(usedTranscript),"replays":.n(replays)]);coaching=true}}}
    func sendCoach(){let text=coachText.trimmingCharacters(in:.whitespacesAndNewlines);guard !text.isEmpty else{return};focus=nil;Task{await store.perform("教练正在看你的问题…"){store.state=try await store.request("session/discuss",["sessionId":session["id"],"taskId":.s(discussionTaskID.isEmpty ? task["id"].text:discussionTaskID),"message":.s(text),"requestId":.s(requestID),"draftAnswer":.s(answers.joined(separator:"\n"))]);coachText="";requestID=UUID().uuidString.lowercased();persistDraft()}}}
    func finish(){Task{let id=session["id"];await store.perform("整理本轮小结…"){store.state=try await store.request("session/finish",["sessionId":id]);summary=try await store.request("session/detail",["id":id]);showSummary=true}}}
    func displayAnswer(_ raw:String)->String{if let value=try? J.decode(Data(raw.utf8)),!value.list.isEmpty{return value.list.map(\.text).joined(separator:"\n")};return raw}
    func referenceAnswers(_ value:J)->[String]{value["questions"].list.isEmpty ? [value["answer"].text]:value["questions"].list.map{$0["answer"].text}}
    func discussionTurns(_ id:String)->some View{ForEach(session["discussions"][id].list,id:\.recordID){turn in VStack(alignment:.leading,spacing:10){Text("你："+turn["message"].text).foregroundStyle(.secondary);Text(turn["reply"].text)}.padding(16).background(.background,in:RoundedRectangle(cornerRadius:16))}}
}
struct QuestionMaterial:View {
    let task:J,answered:Bool
    var body:some View{
        VStack(alignment:.leading,spacing:14){
            HStack{Label(task["skill"].text,systemImage:skillSymbol(task["skill"].text));Text(task["level"].text).fontWeight(.semibold)}.font(.caption).foregroundStyle(StudyStyle.purple)
            if !task["passage"].text.isEmpty{
                Text(task["passage"].text).textSelection(.enabled)
                if answered && !task["translation"].text.isEmpty{Divider();Text(task["translation"].text).font(.subheadline).foregroundStyle(.secondary)}
            }
            if answered && !task["audio"].text.isEmpty{Text(task["audio"].text).textSelection(.enabled)}
            Text(task["prompt"].text).font(.headline).fixedSize(horizontal:false,vertical:true)
            if answered && task["questions"].list.count>1{
                ForEach(Array(task["questions"].list.enumerated()),id:\.offset){index,question in Text("\(index+1). "+question["prompt"].text).font(.subheadline)}
            }
        }.frame(maxWidth:.infinity,alignment:.leading)
    }
}
struct FeedbackBubble:View {let feedback:J;var body:some View{VStack(alignment:.leading,spacing:12){Label(feedback["correct"].flag ? "回答正确":"一起改得更准确",systemImage:feedback["correct"].flag ? "checkmark.circle":"pencil.circle").font(.subheadline.weight(.semibold));Text(feedback["explanation"].text);if !feedback["suggestion"].text.isEmpty{Divider();Text("你的表达，优化后").font(.caption).foregroundStyle(.secondary);Text(feedback["suggestion"].text).textSelection(.enabled)}}.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(StudyStyle.purple.opacity(0.08),in:RoundedRectangle(cornerRadius:16))}}
