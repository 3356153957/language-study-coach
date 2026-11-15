import SwiftUI
import AVFoundation

@MainActor final class StudyStore:ObservableObject {
    @Published var state:J = .null
    @Published var busy="",error="",notice=""
    @Published var practice=false,goal=UserDefaults.standard.string(forKey:"native-goal") ?? "四级"
    @Published var tab=0
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
    func start(_ mode:String,reviewID:String?=nil)async{
        if current.exists{practice=true;return}
        guard configured else{tab=3;notice="先连接 AI，再开始练习。";return}
        await perform("正在准备第一题…"){
            var input:[String:J]=["goal":.s(goal),"mode":.s(mode),"placement":.bool(false)]
            if let id=reviewID{input["reviewId"] = .s(id)}
            state=try await request("session/start",input);practice=true
        }
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
            let feedback:J = .object(["correct":.bool(true),"explanation":.s("隔离验收：回答已经收到。"),"suggestion":.s("I had put the plates on the table."),"weakness":.s("")])
            var output:J = .object(task)
            if system.contains("connection-test") || context["action"].text=="connection-test"{output = .object(["ok":.bool(true)])}
            else if system.contains("本次同时准备下一题"){output = .object(["feedback":feedback,"nextTask":.object(task)])}
            else if system.contains("最新 message"){output = .object(["reply":.s("你想说的是提前把盘子摆在桌子上，可以说 put the plates on the table。")])}
            else if system.contains("根据本次完整答题"){output = .object(["level":.s("A2"),"summary":.s("隔离验收：本轮练习已完成。"),"nextFocus":.s("继续练习准确表达。"),"skills":.array(["阅读","听力","词汇","语法","表达"].map{.object(["name":.s($0),"level":.s("A2"),"evidence":.s("隔离作答样例。")])})])}
            else if context["task"].exists{output=feedback}
            result = .object(["choices":.array([.object(["message":.object(["content":.s(output.json)])])])])
        }
        return .object(["status":.n(status),"headers":.object([:]),"body":.s(result.json)])
    }
}
