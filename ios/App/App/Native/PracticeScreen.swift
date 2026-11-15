import SwiftUI
import UIKit

// Native UITextView preserves IME composition, selection and keyboard focus.
struct AnswerEditor:UIViewRepresentable {
    @Binding var text:String
    var active:Bool=false
    var identifier:String
    var onFocus:()->Void={}
    var onReturn:()->Void={}
    func makeUIView(context:Context)->UITextView {
        let view=UITextView();view.font = .preferredFont(forTextStyle:.body);view.adjustsFontForContentSizeCategory=true;view.backgroundColor = .secondarySystemGroupedBackground
        view.layer.cornerRadius=12;view.textContainerInset=UIEdgeInsets(top:12,left:10,bottom:12,right:10)
        view.delegate=context.coordinator;view.accessibilityLabel="你的回答";view.accessibilityIdentifier=identifier;view.returnKeyType = .next
        return view
    }
    func updateUIView(_ view:UITextView,context:Context){context.coordinator.parent=self;if view.text != text && view.markedTextRange==nil{view.text=text};if active && !view.isFirstResponder{DispatchQueue.main.async{view.becomeFirstResponder()}}}
    func makeCoordinator()->Coordinator{Coordinator(self)}
    class Coordinator:NSObject,UITextViewDelegate {
        var parent:AnswerEditor
        init(_ parent:AnswerEditor){self.parent=parent}
        func textViewDidBeginEditing(_ textView:UITextView){parent.onFocus()}
        func textViewDidChange(_ textView:UITextView){parent.text=String(textView.text.prefix(4000))}
        func textView(_ textView:UITextView,shouldChangeTextIn range:NSRange,replacementText text:String)->Bool{
            if text=="\n" && textView.markedTextRange==nil{parent.onReturn();return false};return true
        }
    }
}
struct PracticeScreen:View {
    @EnvironmentObject var store:StudyStore
    @Environment(\.dismiss) var dismiss
    @State private var answers:[String]=[],coachText="",coaching=false,focus:Int?=nil,hint=false,transcript=false,replays=0,seconds=0
    @State private var lastTask="",requestID=UUID().uuidString.lowercased()
    @State private var summary:J = .null,showSummary=false
    private let timer=Timer.publish(every:1,on:.main,in:.common).autoconnect()
    var session:J{store.current}
    var task:J{session["current"]}
    var questions:[J]{task["questions"].list.isEmpty ? [.object(["prompt":task["prompt"],"options":task["options"]])]:task["questions"].list}
    var complete:Bool{answers.count==questions.count && answers.allSatisfy{!$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}}
    var body:some View{
        NavigationStack{ScrollViewReader{proxy in
            ScrollView{LazyVStack(alignment:.leading,spacing:22){
                ForEach(session["history"].list,id:\.json){entry in
                    QuestionMaterial(task:entry["task"],answered:true)
                    HStack{Spacer();Text(displayAnswer(entry["answer"].text)).padding(14).background(StudyStyle.purple.opacity(0.12),in:RoundedRectangle(cornerRadius:16))}
                    FeedbackBubble(feedback:entry["feedback"])
                }
                if !session["feedback"].exists{QuestionMaterial(task:task,answered:false)
                    if !task["audio"].text.isEmpty{HStack{Button{replays+=1;store.speak(task["audio"].text)}label:{Label(store.speech.isSpeaking ? "停止播放":"播放听力",systemImage:"play.circle.fill")};Button("查看原文"){transcript.toggle()}};if transcript{Text(task["audio"].text).font(.subheadline).foregroundStyle(.secondary)}}
                    ForEach(Array(questions.enumerated()),id:\.offset){index,item in
                        VStack(alignment:.leading,spacing:12){if questions.count>1{Text("\(index+1). "+item["prompt"].text).font(.headline)}
                            if !item["options"].list.isEmpty{ForEach(Array(item["options"].list.enumerated()),id:\.offset){option,value in Button{setAnswer(index,value.text)}label:{HStack(alignment:.top,spacing:12){Text(String(UnicodeScalar(65+option)!)).font(.subheadline.weight(.semibold)).frame(width:24);Text(value.text).frame(maxWidth:.infinity,alignment:.leading);if answers.indices.contains(index) && answers[index]==value.text{Image(systemName:"checkmark.circle.fill")}}.padding(14).background(answers.indices.contains(index) && answers[index]==value.text ? StudyStyle.purple.opacity(0.14):Color(uiColor:.secondarySystemGroupedBackground),in:RoundedRectangle(cornerRadius:14)).overlay(RoundedRectangle(cornerRadius:14).stroke(StudyStyle.purple.opacity(answers.indices.contains(index) && answers[index]==value.text ? 0.7:0.1)))}.buttonStyle(.plain).accessibilityIdentifier("option-\(index)-\(option)")}}
                            else if questions.count>1{AnswerEditor(text:answerBinding(index),active:focus==index,identifier:"answer-\(index)",onFocus:{focus=index},onReturn:{if index+1<questions.count{focus=index+1;withAnimation{proxy.scrollTo("field-\(index+1)",anchor:.center)}}else{submit()}}).frame(height:90).id("field-\(index)")}
                        }
                    }
                    Button(hint ? "提示已展开":"给我一点提示"){hint=true};if hint{Text(task["hint"].text).font(.subheadline).foregroundStyle(.secondary)}
                }
                ForEach(session["discussions"][task["id"].text].list,id:\.json){turn in VStack(alignment:.leading,spacing:10){Text("你："+turn["message"].text).foregroundStyle(.secondary);Text(turn["reply"].text)}.padding(16).background(.background,in:RoundedRectangle(cornerRadius:16))}
                if !store.busy.isEmpty{HStack{ProgressView();Text(store.busy).font(.subheadline)}.accessibilityIdentifier("practice-busy")}
                Color.clear.frame(height:1).id("latest")
            }.padding(18)}.scrollDismissesKeyboard(.interactively).background(StudyStyle.background)
            .safeAreaInset(edge:.bottom,spacing:0){composer}
            .navigationTitle(session.exists ? session["goal"].text+" · "+session["mode"].text+"练习":"练习")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar{ToolbarItem(placement:.navigationBarLeading){Button("学习"){dismiss()}};ToolbarItem(placement:.navigationBarTrailing){Button("结束本轮"){finish()}.disabled(!store.busy.isEmpty)}}
            .onChange(of:session["history"].list.count){_ in withAnimation{proxy.scrollTo("latest",anchor:.bottom)}}
            .onChange(of:session["discussions"][task["id"].text].list.count){_ in withAnimation{proxy.scrollTo("latest",anchor:.bottom)}}
        }.onAppear{restoreDraft()}.onChange(of:task["id"].text){_ in restoreDraft()}.onReceive(timer){_ in if !session["feedback"].exists && store.busy.isEmpty{seconds=min(1800,seconds+1)}}
        .sheet(isPresented:$showSummary,onDismiss:{if !store.current.exists{dismiss()}}){RoundDetail(round:summary)}
        .alert("未能完成",isPresented:Binding(get:{!store.error.isEmpty},set:{if !$0{store.error=""}})){Button("知道了"){store.error=""}}message:{Text(store.error)}
        .onDisappear{store.speech.stopSpeaking(at:.immediate);persistDraft()}}
    }
    var composer:some View{VStack(spacing:10){
        if session["feedback"].exists{Button{Task{if session["history"].list.count>=session["targetCount"].int{finish()}else{await store.perform("正在切换下一题…"){store.state=try await store.request("session/next",["sessionId":session["id"],"taskId":task["id"]]);coaching=false}}}}label:{Label(session["history"].list.count>=session["targetCount"].int ? "生成本轮小结":session["nextReady"].flag ? "下一题已准备好，继续":"继续下一题",systemImage:"arrow.right")}.buttonStyle(.borderedProminent).accessibilityIdentifier("next-task")}
        HStack{if !session["feedback"].exists{Picker("输入用途",selection:$coaching){Text("作答").tag(false);Text("问教练").tag(true)}.pickerStyle(.segmented).frame(maxWidth:190)}else{Text("继续问教练").font(.subheadline.weight(.medium))};Spacer();if questions.count>1 && !coaching && !session["feedback"].exists{Text("\(answers.filter{!$0.isEmpty}.count)/\(questions.count)").font(.caption).foregroundStyle(.secondary)}}
        if coaching || session["feedback"].exists{AnswerEditor(text:$coachText,active:focus == -1,identifier:"coach-message",onFocus:{focus = -1},onReturn:{sendCoach()}).frame(height:76)}
        else if questions.count==1 && questions[0]["options"].list.isEmpty{AnswerEditor(text:answerBinding(0),active:focus==0,identifier:"answer-0",onFocus:{focus=0},onReturn:{submit()}).frame(height:90)}
        HStack{Text(coaching || session["feedback"].exists ? "中文或英文都可以":"可用键盘麦克风听写").font(.caption).foregroundStyle(.secondary);Spacer();Button{if coaching || session["feedback"].exists{sendCoach()}else{submit()}}label:{Image(systemName:"arrow.up").font(.headline).frame(width:40,height:36)}.buttonStyle(.borderedProminent).disabled(!store.busy.isEmpty || (coaching || session["feedback"].exists ? coachText.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty:!complete)).accessibilityIdentifier("send-answer")}
    }.padding(12).background(.regularMaterial)}
    func answerBinding(_ index:Int)->Binding<String>{Binding(get:{answers.indices.contains(index) ? answers[index]:""},set:{setAnswer(index,$0)})}
    func setAnswer(_ index:Int,_ value:String){if answers.count != questions.count{answers=Array(repeating:"",count:questions.count)};answers[index]=String(value.prefix(4000));persistDraft()}
    func persistDraft(){guard !store.runtime.fixture,!task["id"].text.isEmpty else{return};try? store.runtime.vault.write("native-draft",J.object(["taskId":task["id"],"answers":.array(answers.map{.s($0)}),"coachText":.s(coachText)]).json)}
    func restoreDraft(){guard lastTask != task["id"].text else{return};lastTask=task["id"].text;answers=Array(repeating:"",count:questions.count);hint=false;transcript=false;replays=0;seconds=0;coaching=session["feedback"].exists;focus=nil
        if !store.runtime.fixture,let text=try? store.runtime.vault.read("native-draft"),let value=try? J.decode(Data(text.utf8)),value["taskId"]==task["id"],value["answers"].list.count==questions.count{answers=value["answers"].list.map(\.text);coachText=value["coachText"].text}}
    func submit(){guard complete,!session["feedback"].exists else{return};focus=nil;UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);Task{await store.perform("正在批改并准备下一题…"){store.state=try await store.request("session/answer",["sessionId":session["id"],"taskId":task["id"],"answer":.s(answers.count>1 ? J.array(answers.map{.s($0)}).json:answers[0]),"activeSeconds":.n(seconds),"hintUsed":.bool(hint),"transcriptViewed":.bool(transcript),"replays":.n(replays)]);coaching=true}}}
    func sendCoach(){let text=coachText.trimmingCharacters(in:.whitespacesAndNewlines);guard !text.isEmpty else{return};focus=nil;Task{await store.perform("教练正在看你的问题…"){store.state=try await store.request("session/discuss",["sessionId":session["id"],"taskId":task["id"],"message":.s(text),"requestId":.s(requestID),"draftAnswer":.s(answers.joined(separator:"\n"))]);coachText="";requestID=UUID().uuidString.lowercased();persistDraft()}}}
    func finish(){Task{let id=session["id"];await store.perform("整理本轮小结…"){store.state=try await store.request("session/finish",["sessionId":id]);summary=try await store.request("session/detail",["id":id]);showSummary=true}}}
    func displayAnswer(_ raw:String)->String{if let value=try? J.decode(Data(raw.utf8)),!value.list.isEmpty{return value.list.map(\.text).joined(separator:"\n")};return raw}
}
struct QuestionMaterial:View {let task:J,answered:Bool;var body:some View{VStack(alignment:.leading,spacing:14){HStack{Label(task["skill"].text,systemImage:skillSymbol(task["skill"].text));Text(task["level"].text).fontWeight(.semibold)}.font(.caption).foregroundStyle(StudyStyle.purple);if !task["passage"].text.isEmpty{Text(task["passage"].text).textSelection(.enabled);if answered && !task["translation"].text.isEmpty{Divider();Text(task["translation"].text).font(.subheadline).foregroundStyle(.secondary)}};Text(task["prompt"].text).font(.headline).fixedSize(horizontal:false,vertical:true)}.frame(maxWidth:.infinity,alignment:.leading)}}
struct FeedbackBubble:View {let feedback:J;var body:some View{VStack(alignment:.leading,spacing:12){Label(feedback["correct"].flag ? "回答正确":"一起改得更准确",systemImage:feedback["correct"].flag ? "checkmark.circle":"pencil.circle").font(.subheadline.weight(.semibold));Text(feedback["explanation"].text);if !feedback["suggestion"].text.isEmpty{Divider();Text("你的表达，优化后").font(.caption).foregroundStyle(.secondary);Text(feedback["suggestion"].text).textSelection(.enabled)}}.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(StudyStyle.purple.opacity(0.08),in:RoundedRectangle(cornerRadius:16))}}
