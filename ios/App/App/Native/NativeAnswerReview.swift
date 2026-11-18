import SwiftUI

struct NativeAnswerReview:View {
    let entry:J
    var questions:[J]{entry["task"]["questions"].list.isEmpty ? [entry["task"]]:entry["task"]["questions"].list}
    var answers:[String]{questions.count>1 ? ((try? J.decode(Data(entry["answer"].text.utf8)))?.list.map{$0.text} ?? []):[entry["answer"].text]}
    var body:some View{
        VStack(alignment:.leading,spacing:16){
            ForEach(Array(questions.enumerated()),id:\.offset){index,item in
                VStack(alignment:.leading,spacing:7){
                    if questions.count>1{Text("\(index+1). "+item["prompt"].text).font(.subheadline.bold())}
                    if entry["skippedQuestions"].list.contains(.n(index)){Text("未作答（已标记不会）").foregroundStyle(.secondary)}
                    Text("你的回答："+(answers.indices.contains(index) ? answers[index]:"（未填写）")).textSelection(.enabled)
                    Text((item["options"].list.isEmpty ? "参考表达：":"参考答案：")+item["answer"].text).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
            RevisionHistory(entry:entry)
        }.font(.subheadline)
    }
}

struct RevisionHistory:View {
    let entry:J
    var revisions:[J]{entry["revisions"].list}
    var body:some View{
        if !revisions.isEmpty{
            DisclosureGroup("查看批改复核记录（\(revisions.count)/3）"){
                ForEach(Array(revisions.enumerated()),id:\.offset){index,revision in
                    VStack(alignment:.leading,spacing:8){
                        Text("第 \(index+1) 次复核 · "+String(revision["at"].text.prefix(10))).font(.caption.bold())
                        Text("复核前").font(.caption);FeedbackBubble(feedback:revision["previousFeedback"],skippedQuestions:entry["skippedQuestions"].list.map{ $0.int })
                        Text("复核后").font(.caption);FeedbackBubble(feedback:index+1<revisions.count ? revisions[index+1]["previousFeedback"]:entry["feedback"],skippedQuestions:entry["skippedQuestions"].list.map{ $0.int })
                    }
                }
            }.accessibilityIdentifier("revision-history-"+entry["task"]["id"].text)
        }
    }
}
