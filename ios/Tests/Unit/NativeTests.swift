import XCTest
import CryptoKit
@testable import App

@MainActor final class NativeTests:XCTestCase {
    func testLoopbackAuthorizationPreparationCanCloseAndRestart()async throws{
        let auth=StudyAuthorization();defer{auth.cancel()}
        let first=try await auth.prepare()
        XCTAssertEqual(URL(string:first)?.host,"127.0.0.1");XCTAssertEqual(URL(string:first)?.path,"/auth/callback")
        auth.cancel()
        let again=try await auth.prepare();XCTAssertNotNil(URL(string:again)?.port)
    }
    func testJSONPresentationIsStableAndOversizedNumbersDoNotTrap()throws{
        let first=try J.decode(Data("{\"z\":1,\"a\":2}".utf8)),second=try J.decode(Data("{\"a\":2,\"z\":1}".utf8))
        XCTAssertEqual(first.json,second.json)
        let huge=try J.decode(Data("1e100".utf8));XCTAssertEqual(huge.int,0);XCTAssertFalse(huge.text.isEmpty)
    }
    func testNativeEngineGradesPreparesNextTaskAndKeepsBackupPortable()async throws{
        let runtime=StudyRuntime(fixture:true)
        XCTAssertNil(runtime.startupError)
        var state=try await runtime.request("session/start",.object(["goal":.s("四级"),"mode":.s("写作")]))
        let session=state["sessions"].list[0],task=session["current"]
        XCTAssertEqual(task["questions"].list.count,2)
        XCTAssertFalse(task["questions"].list[0]["answer"].exists)
        state=try await runtime.request("session/answer",.object(["sessionId":session["id"],"taskId":task["id"],"answer":.s("[\"I had put the plates on the table.\",\"I would like to cook rice.\"]")]))
        XCTAssertTrue(state["sessions"].list[0]["nextReady"].flag)
        XCTAssertEqual(state["sessions"].list[0]["history"].list.count,1)
        state=try await runtime.request("session/next",.object(["sessionId":session["id"],"taskId":task["id"]]))
        XCTAssertNotEqual(state["sessions"].list[0]["current"]["id"],task["id"])
        let backup=try await runtime.request("data/export")
        XCTAssertEqual(backup["format"].text,"language-study-coach")
        XCTAssertFalse(backup.json.contains("test-only"))
    }
    func testWrongOTPProducesVisibleMessageAndNeverLogsIn()async throws{
        let runtime=StudyRuntime(fixture:true)
        _ = try await runtime.request("sync/send-code",.object(["email":.s("qa@example.com")]))
        do{_ = try await runtime.request("sync/verify",.object(["email":.s("qa@example.com"),"code":.s("000000")]));XCTFail("Invalid code was accepted")}
        catch{XCTAssertTrue(error.localizedDescription.contains("验证码无效"))}
        let status=try await runtime.request("sync/status");XCTAssertFalse(status["connected"].flag)
        let result=try await runtime.request("sync/verify",.object(["email":.s("qa@example.com"),"code":.s("123456")]))
        XCTAssertTrue(result["status"]["connected"].flag)
    }
    func testNativeWordbookDefinitionsAndManualAssessmentStayPortable()async throws{
        let runtime=StudyRuntime(fixture:true)
        var state=try await runtime.request("session/start",.object(["goal":.s("四级"),"mode":.s("阅读")]))
        let session=state["sessions"].list[0],task=session["current"]
        state=try await runtime.request("vocabulary/mark",.object(["sessionId":session["id"],"taskId":task["id"],"word":.s("plates"),"status":.s("learning")]))
        XCTAssertEqual(state["wordbook"].list.count,1)
        state=try await runtime.request("vocabulary/define",.object(["words":.array([.s("plates")])]))
        XCTAssertEqual(state["wordbook"].list[0]["meaning"].text,"盘子；餐盘")
        XCTAssertFalse(state["wordbook"].list[0]["sources"].list[0]["translation"].text.isEmpty)
        state=try await runtime.request("session/answer",.object(["sessionId":session["id"],"taskId":task["id"],"answer":.s("On the table.")]))
        XCTAssertFalse(state["examOutlook"]["四级"]["estimate"].exists)
        state=try await runtime.request("exam/assess",.object(["goal":.s("四级"),"requestId":.s(UUID().uuidString.lowercased())]))
        XCTAssertEqual(state["examOutlook"]["四级"]["estimate"]["probabilityText"].text,"12.23%")
        let backup=try await runtime.request("data/export")
        XCTAssertTrue(backup.json.contains("盘子；餐盘"));XCTAssertTrue(backup.json.contains("examAssessments"))
    }
    func testVaultKeepsExistingAESGCMFormat()throws{
        let vault=StudyVault(),name="migration-test-"+UUID().uuidString
        let content="{\"version\":1,\"sessions\":[]}",key=try vault.key(create:true)
        let legacy=try AES.GCM.seal(Data(content.utf8),using:key).combined!
        try legacy.write(to:vault.directory.appendingPathComponent(name+".enc"),options:.atomic)
        defer{try? FileManager.default.removeItem(at:vault.directory.appendingPathComponent(name+".enc"))}
        XCTAssertEqual(try vault.read(name),content)
        try vault.write(name,content)
        let box=try AES.GCM.SealedBox(combined:Data(contentsOf:vault.directory.appendingPathComponent(name+".enc")))
        XCTAssertEqual(try AES.GCM.open(box,using:key),Data(content.utf8))
    }
    func testFoundationURLAdapterPreservesEncodedPathsAndNativeRandomBytes()throws{
        let runtime=StudyRuntime(fixture:true)
        let result=runtime.context.evaluateScript("(()=>{const u=new URL('https://fixture.invalid/proxy%2Fv1/models');u.searchParams.set('pageToken','a+b');return u.href;})()")?.toString()
        XCTAssertEqual(result,"https://fixture.invalid/proxy%2Fv1/models?pageToken=a%2Bb")
        XCTAssertEqual(runtime.context.evaluateScript("crypto.getRandomValues(new Int32Array(4)).length")?.toInt32(),4)
    }
    func testSignedChatGPTIdentityRejectsTamperingNonceAndAudience()throws{
        let file=Bundle(for:Self.self).url(forResource:"identity-fixture",withExtension:"json")!
        let fixture=try J.decode(Data(contentsOf:file)),input=fixture["input"],keys=fixture["keys"]
        XCTAssertEqual(try SignedIdentity.verify(input,keys:keys)["subject"].text,"fixture-subject")
        for (field,value) in [("nonce","wrong"),("clientId","wrong"),("token",input["token"].text+"bad")]{var modified=input.dictionary;modified[field] = .s(value);XCTAssertThrowsError(try SignedIdentity.verify(.object(modified),keys:keys))}
    }
}
