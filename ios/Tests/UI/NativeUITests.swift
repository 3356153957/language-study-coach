import XCTest

final class NativeUITests:XCTestCase {
    func launchExamFixture(withEstimate:Bool,withDecimalChange:Bool=false)->XCUIApplication{
        let file=Bundle(for:Self.self).url(forResource:"exam-backup",withExtension:"json")!
        let backup=try! JSONSerialization.jsonObject(with:Data(contentsOf:file)) as! [String:Any]
        var state=backup["data"] as! [String:Any];state["version"]=1
        if !withEstimate{
            var sessions=state["sessions"] as! [[String:Any]]
            var report=sessions[sessions.count-1]["report"] as! [String:Any];report["examEstimate"]=NSNull()
            sessions[sessions.count-1]["report"]=report;state["sessions"]=sessions
        }
        if withDecimalChange{
            var sessions=state["sessions"] as! [[String:Any]]
            var older=sessions[sessions.count-1]["report"] as! [String:Any]
            older["examEstimate"]=["probability":11,"reason":"此前的练习依据"]
            older["updatedAt"]="2026-11-13T10:00:00.000Z"
            sessions[sessions.count-2]["report"]=older;sessions[sessions.count-2]["finishedAt"]="2026-11-13T10:00:00.000Z"
            var latest=sessions[sessions.count-1]["report"] as! [String:Any]
            latest["examEstimate"]=["probability":12.23,"reason":"新增作答后的初步估计"]
            sessions[sessions.count-1]["report"]=latest;state["sessions"]=sessions
        }
        let app=XCUIApplication();app.launchArguments=["--ui-testing"]
        app.launchEnvironment["LSC_UI_TEST_STATE"]=String(data:try! JSONSerialization.data(withJSONObject:state),encoding:.utf8)!
        app.launch();return app
    }
    func openExam(_ app:XCUIApplication){
        XCTAssertTrue(app.buttons["learning-goal"].waitForExistence(timeout:15))
        app.buttons["learning-goal"].tap();app.buttons["四级"].firstMatch.tap()
        let link=app.buttons["exam-progress"]
        for _ in 0..<6{if link.isHittable{break};app.swipeUp()}
        XCTAssertTrue(link.isHittable);link.tap()
    }
    func testImportedPredictionIsVisibleWithoutCache(){
        let app=launchExamFixture(withEstimate:true);openExam(app)
        let estimate=app.staticTexts["exam-estimate"]
        XCTAssertTrue(estimate.waitForExistence(timeout:10));XCTAssertEqual(estimate.label,"45.00%")
        XCTAssertTrue(app.staticTexts["生成于 2026-11-14"].exists)
        capture(app,"07-native-restored-prediction")
    }
    func testDecimalPredictionShowsChangeFromPreviousReport(){
        let app=launchExamFixture(withEstimate:true,withDecimalChange:true);openExam(app)
        let estimate=app.staticTexts["exam-estimate"]
        XCTAssertTrue(estimate.waitForExistence(timeout:10));XCTAssertEqual(estimate.label,"12.23%")
        XCTAssertEqual(app.staticTexts["exam-change"].label,"较上次 +1.23 个百分点")
        capture(app,"09-native-decimal-prediction")
    }
    func testEligibleSamplesWithoutEstimateExplainNextStep(){
        let app=launchExamFixture(withEstimate:false);openExam(app)
        let status=app.staticTexts["exam-status"]
        XCTAssertTrue(status.waitForExistence(timeout:10));XCTAssertEqual(status.label,"暂未形成预测")
        XCTAssertTrue(app.staticTexts["exam-message"].label.contains("最低样本已满足"))
        capture(app,"08-native-prediction-pending")
    }
    func capture(_ app:XCUIApplication,_ name:String){let shot=XCTAttachment(screenshot:XCUIScreen.main.screenshot());shot.name=name;shot.lifetime = .keepAlways;add(shot)}
    func testNativeKeyboardMultiAnswerAndFeedback(){
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        XCTAssertTrue(app.buttons["start-写作"].waitForExistence(timeout:20));capture(app,"01-native-home")
        app.buttons["start-写作"].tap()
        let first=app.textViews["answer-0"],second=app.textViews["answer-1"]
        XCTAssertTrue(first.waitForExistence(timeout:15));first.tap();first.typeText("I had put the plates on the table.\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:5));XCTAssertTrue(second.isHittable)
        capture(app,"02-native-keyboard")
        second.typeText("I would like to cook rice.\n")
        XCTAssertTrue(app.buttons["next-task"].waitForExistence(timeout:15));capture(app,"03-native-feedback")
        app.buttons["next-task"].tap();XCTAssertTrue(app.textViews["answer-0"].waitForExistence(timeout:10))
    }
    func revealPracticeControl(_ element:XCUIElement,in app:XCUIApplication){
        let scroll=app.scrollViews["practice-log"]
        XCTAssertTrue(scroll.exists)
        func visible()->Bool{element.exists && element.isHittable && element.frame.minY>=scroll.frame.minY+4 && element.frame.maxY<=scroll.frame.maxY-4}
        for _ in 0..<6{if visible(){break};scroll.swipeUp()}
        XCTAssertTrue(visible(),"Practice control must be inside the scroll area, above the fixed composer")
    }
    func testSkipOneQuestionAndInspectRegradeHistory(){
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        app.buttons["start-写作"].tap()
        let first=app.textViews["answer-0"]
        XCTAssertTrue(first.waitForExistence(timeout:15));first.tap();first.typeText("I prepared the plates.")
        let dismiss=app.buttons["收起键盘"];if dismiss.exists{dismiss.tap()}
        let skip=app.buttons["skip-1"]
        for _ in 0..<5{if skip.isHittable{break};app.swipeUp()}
        XCTAssertTrue(skip.isHittable);skip.tap()
        XCTAssertTrue(app.buttons["send-answer"].isEnabled);app.buttons["send-answer"].tap()
        XCTAssertTrue(app.buttons["next-task"].waitForExistence(timeout:15))
        XCTAssertTrue(app.staticTexts["本组答对 1 / 2 小题"].exists)
        capture(app,"11-native-skipped-question")
        let regrade=app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@","regrade-")).firstMatch
        revealPracticeControl(regrade,in:app);regrade.tap()
        let revised=NSPredicate{_,_ in regrade.label.contains("1/3")}
        expectation(for:revised,evaluatedWith:regrade);waitForExpectations(timeout:15)
        let history=app.descendants(matching:.any).matching(NSPredicate(format:"identifier BEGINSWITH %@","revision-history-")).firstMatch
        XCTAssertTrue(history.waitForExistence(timeout:15));revealPracticeControl(history,in:app);history.tap()
        XCTAssertTrue(app.staticTexts["复核前"].exists);XCTAssertTrue(app.staticTexts["复核后"].exists)
        capture(app,"12-native-regrade-history")
    }
    func testWrongOTPHasInlineError(){
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        app.tabBars.buttons["设置"].tap()
        let email=app.textFields["sync-email"]
        for _ in 0..<7{if email.isHittable{break};app.swipeUp()}
        XCTAssertTrue(email.waitForExistence(timeout:10));email.tap();email.typeText("qa@example.com")
        app.buttons["发送验证码"].tap()
        let code=app.textFields["sync-code"];code.tap();code.typeText("000000")
        if app.buttons["完成"].exists{app.buttons["完成"].tap()}
        app.buttons["verify-code"].tap()
        let error=app.staticTexts["otp-error"]
        XCTAssertTrue(error.waitForExistence(timeout:10));XCTAssertTrue(error.label.contains("验证码无效"));capture(app,"04-native-otp-error")
        code.tap();code.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:6)+"123456")
        if app.buttons["完成"].exists{app.buttons["完成"].tap()}
        app.buttons["verify-code"].tap()
        XCTAssertTrue(app.buttons["开启自动同步"].waitForExistence(timeout:10));XCTAssertFalse(error.exists);capture(app,"05-native-otp-corrected")
    }
    func testNewlineAndNextAnswerButtonsKeepSeparateDrafts(){
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        app.buttons["start-写作"].tap()
        let first=app.textViews["answer-0"],second=app.textViews["answer-1"]
        XCTAssertTrue(first.waitForExistence(timeout:15));first.tap();first.typeText("First line")
        let newline=app.buttons["insert-newline"],next=app.buttons["next-answer-field"]
        XCTAssertTrue(newline.waitForExistence(timeout:5));newline.tap();first.typeText("Second line")
        XCTAssertEqual(first.value as? String,"First line\nSecond line")
        XCTAssertTrue(next.exists);next.tap();second.typeText("Separate answer")
        XCTAssertEqual(second.value as? String,"Separate answer")
        XCTAssertFalse(app.buttons["next-task"].exists)
        capture(app,"10-native-newline-next-field")
    }
    func testLandscapeKeyboardKeepsAnswerVisibleWithoutWebContent(){
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        app.buttons["start-写作"].tap()
        let first=app.textViews["answer-0"];XCTAssertTrue(first.waitForExistence(timeout:15))
        XCUIDevice.shared.orientation = .landscapeLeft
        defer{XCUIDevice.shared.orientation = .portrait}
        first.tap();first.typeText("I had prepared the plates.")
        let keyboard=app.keyboards.firstMatch;XCTAssertTrue(keyboard.waitForExistence(timeout:5))
        // Each frame access requests an accessibility snapshot. Read each once so
        // a slow simulator can finish one complete comparison before the deadline.
        let visible=NSPredicate{_,_ in
            guard keyboard.exists,first.isHittable else{return false}
            let bounds=app.frame,answer=first.frame,keys=keyboard.frame,bar=app.navigationBars.firstMatch.frame
            return bounds.width>bounds.height && answer.width>0 && answer.height>0 && answer.minX>=bounds.minX && answer.maxX<=bounds.maxX && answer.minY>=bar.maxY && answer.maxY<=keys.minY
        }
        expectation(for:visible,evaluatedWith:first);waitForExpectations(timeout:15)
        XCTAssertEqual(first.value as? String,"I had prepared the plates.")
        print("Landscape bounds: app=\(app.frame), answer=\(first.frame), keyboard=\(keyboard.frame)")
        XCTAssertEqual(app.webViews.count,0);capture(app,"06-native-landscape-keyboard")
    }
}
