import SwiftUI
import AVFoundation

@MainActor final class StudyStore:ObservableObject {
    @Published var state:J = .null
    @Published var busy=""
    @Published var error=""
    @Published var notice=""
    @Published var practice=false
    @Published var coachDraft=""
    @Published var goal=UserDefaults.standard.string(forKey:"native-goal") ?? "四级"
    @Published var tab=0
    @Published var showSwitch=false
    var pendingStart:(mode:String,goal:String,reviewID:String?,reviewQuestionIndex:Int?,recommendationID:String?,useProfileFocus:Bool)?
    let runtime:StudyRuntime
    let speech=AVSpeechSynthesizer()
    var current:J{state["sessions"].list.first(where:{!$0["finishedAt"].exists}) ?? .null}
    var configured:Bool{state["configured"].flag}
    init(fixture:Bool=false){runtime=StudyRuntime(fixture:fixture)}
    func request(_ path:String,_ body:[String:J]=[:])async throws->J{try await runtime.request(path,.object(body))}
    func refresh()async {do{state=try await request("state");if current.exists{goal=current["goal"].text}}catch{self.error=error.localizedDescription}}
    @discardableResult func perform(_ label:String,_ work:()async throws->Void)async->Bool {
        guard busy.isEmpty else{return false};busy=label;error="";notice="";speech.stopSpeaking(at:.immediate)
        defer{busy=""}
        do{try await work();return true}catch{self.error=error.localizedDescription;return false}
    }
    func start(_ mode:String,reviewID:String?=nil,reviewQuestionIndex:Int?=nil,recommendationID:String?=nil,useProfileFocus:Bool=false,replaceCurrent:Bool=false)async{
        if current.exists && !replaceCurrent{
            if current["mode"].text==mode && current["goal"].text==goal && reviewID==nil && recommendationID==nil && !useProfileFocus{practice=true;return}
            pendingStart=(mode,goal,reviewID,reviewQuestionIndex,recommendationID,useProfileFocus);showSwitch=true;return
        }
        guard configured else{tab=3;notice="先连接 AI，再开始练习。";return}
        await perform("正在准备第一题…"){
            var input:[String:J]=["goal":.s(goal),"mode":.s(mode),"placement":.bool(false)]
            if let id=reviewID{input["reviewId"] = .s(id)}
            if let index=reviewQuestionIndex{input["reviewQuestionIndex"] = .n(index)}
            if let id=recommendationID{input["recommendationId"] = .s(id)}
            if useProfileFocus{input["useProfileFocus"] = .bool(true)}
            if replaceCurrent && current.exists{
                input["replaceSessionId"]=current["id"];input["draftTaskId"]=current["current"]["id"]
                if let raw=try runtime.vault.read("native-draft"),let draft=try? J.decode(Data(raw.utf8)),draft["taskId"]==current["current"]["id"]{
                    let values=draft["answers"].list
                    input["draftAnswer"] = .s(values.count>1 ? J.array(values).json:values.first?.text ?? "")
                }
            }
            state=try await request("session/start",input);practice=true
        }
    }
    func switchPractice()async{
        guard let request=pendingStart else{return};pendingStart=nil;goal=request.goal
        await start(request.mode,reviewID:request.reviewID,reviewQuestionIndex:request.reviewQuestionIndex,recommendationID:request.recommendationID,useProfileFocus:request.useProfileFocus,replaceCurrent:true)
    }
    func speak(_ text:String,rate:Float=0.48){
        if speech.isSpeaking{speech.stopSpeaking(at:.immediate);return}
        try? AVAudioSession.sharedInstance().setCategory(.playback,mode:.spokenAudio,options:[.allowBluetoothA2DP])
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance=AVSpeechUtterance(string:"Get ready. " + text);utterance.voice=AVSpeechSynthesisVoice(language:"en-US");utterance.rate=rate
        utterance.preUtteranceDelay=0.7;speech.speak(utterance)
    }
    func foreground()async{
        guard busy.isEmpty else{return}
        do{let status=try await request("sync/status");if status["enabled"].flag{_ = try await request("sync/run")};await refresh()}catch{ /* Saved local practice remains available while offline. */ }
    }
}

extension StudyRuntime {
    static let fixtureState="{\"version\":1,\"config\":{\"provider\":\"compatible\",\"baseURL\":\"https://fixture.invalid/v1\",\"model\":\"fixture\",\"apiKey\":\"test-only\"},\"profiles\":{},\"sessions\":[]}"
    static let fixtureScript=""
    func fixtureHTTP(_ input:J)async throws->J{
        let url=input["url"].text
        let body=(try? J.decode(Data(input["body"].text.utf8))) ?? .null
        var result:J = .object([:]);var status=200
        if url.contains("/auth/v1/verify"){
            if body["token"].text != "123456"{status=400;result = .object(["error":.s("invalid_otp")])}
            else{result = .object(["access_token":.s("fixture-access"),"refresh_token":.s("fixture-refresh"),"expires_in":.n(3600),"user":.object(["id":.s("fixture-user"),"email":.s("qa@example.com")])])}
        }else if url.contains("/models"){
            result = .object(["data":.array([.object(["id":.s("fixture"),"name":.s("Fixture")])])])
        }else if url.contains("/chat/completions"){
            let messages=body["messages"].list,system=messages.first?["content"].text ?? "",context=(try? J.decode(Data((messages.last?["content"].text ?? "{}").utf8))) ?? .null
            let mode=context["mode"].text
            var task:[String:J]=["kind":.s("text"),"skill":.s("表达"),"level":.s("A2"),"prompt":.s("What did you prepare before dinner? \(UUID().uuidString.prefix(4))"),"passage":.s(""),"audio":.s(""),"options":.array([]),"answer":.s("I had put the plates on the table."),"hint":.s("想想提前完成的准备。"),"reason":.s("隔离原生验收样例。")]
            if mode=="写作" && context["history"].list.isEmpty{task["questions"] = .array([.object(["prompt":.s("What did you prepare?"),"options":.array([]),"answer":.s("I had put the plates on the table.")]),.object(["prompt":.s("What would you like to cook?"),"options":.array([]),"answer":.s("I would like to cook rice.")])])}
            if mode=="阅读" || mode=="听力"{task["kind"] = .s(mode=="听力" ? "listening":"choice");task["skill"] = .s(mode);task["options"] = .array([.s("On the table."),.s("On the desk.")]);task["answer"] = .s("On the table.");task["prompt"] = .s("Where are the plates? \(UUID().uuidString.prefix(4))");task[mode=="听力" ? "audio":"passage"] = .s("The plates are on the kitchen table.");task["translation"] = .s("盘子在厨房的桌子上。")}
            let skipped=context["telemetry"]["skippedQuestions"].list.map{ $0.int }
            let itemFeedback:[J]=context["task"]["questions"].list.enumerated().map{index,_ in .object(["correct":.bool(!skipped.contains(index)),"explanation":.s(skipped.contains(index) ? "未作答，下一轮继续巩固。":"隔离验收：本项回答已收到。"),"suggestion":.s(""),"weakness":.s(skipped.contains(index) ? "未掌握本项":"")])}
            let feedback:J = .object(["questions":.array(itemFeedback),"correct":.bool(skipped.isEmpty),"explanation":.s("隔离验收：已保存回答和不会标记。"),"suggestion":.s(""),"weakness":.s(skipped.isEmpty ? "":"未掌握本项")])
            var output:J = .object(task)
            if system.contains("connection-test") || context["action"].text=="connection-test"{output = .object(["ok":.bool(true)])}
            else if context["conversation"].exists{output = .object(["reply":.s("隔离验收：可以先说说你最近对什么感兴趣。")])}
            else if system.contains("definitions"),!context["words"].list.isEmpty{output = .object(["definitions":.array(context["words"].list.map{.object(["word":$0["word"],"meaning":.s($0["word"].text=="plates" ? "盘子；餐盘":"桌子"),"translation":.s("盘子在厨房的桌子上。")])})])}
            else if system.contains("当前 goal 的通过概率"){output = .object(["probability":.number(12.23),"reason":.s("隔离验收：根据已有练习评估，样本有限。")])}
            else if system.contains("本次同时准备下一题"){output = .object(["feedback":feedback,"nextTask":.object(task)])}
            else if system.contains("最新 message"){output = .object(["reply":.s("你想说的是提前把盘子摆在桌子上，可以说 put the plates on the table。")])}
            else if system.contains("根据本次完整答题"){output = .object(["level":.s("A2"),"summary":.s("隔离验收：本轮练习已完成。"),"nextFocus":.s("继续练习准确表达。"),"skills":.array(["阅读","听力","词汇","语法","表达"].map{.object(["name":.s($0),"level":.s("A2"),"evidence":.s("隔离作答样例。")])})])}
            else if context["task"].exists{output=feedback}
            result = .object(["choices":.array([.object(["message":.object(["content":.s(output.json)])])])])
        }
        return .object(["status":.n(status),"headers":.object([:]),"body":.s(result.json)])
    }
}
