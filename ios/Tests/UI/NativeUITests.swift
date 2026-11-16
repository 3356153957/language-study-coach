import XCTest

final class NativeUITests:XCTestCase {
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
    func testLandscapeKeyboardKeepsAnswerVisibleWithoutWebContent(){
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        app.buttons["start-写作"].tap()
        let first=app.textViews["answer-0"];XCTAssertTrue(first.waitForExistence(timeout:15))
        XCUIDevice.shared.orientation = .landscapeLeft
        defer{XCUIDevice.shared.orientation = .portrait}
        first.tap();first.typeText("I had prepared the plates.")
        let keyboard=app.keyboards.firstMatch;XCTAssertTrue(keyboard.waitForExistence(timeout:5))
        let visible=NSPredicate{_,_ in app.frame.width>app.frame.height && first.isHittable && first.frame.width>0 && first.frame.height>0 && first.frame.minX>=app.frame.minX && first.frame.maxX<=app.frame.maxX && first.frame.minY>=app.navigationBars.firstMatch.frame.maxY && first.frame.maxY<=keyboard.frame.minY}
        expectation(for:visible,evaluatedWith:first);waitForExpectations(timeout:5)
        XCTAssertEqual(first.value as? String,"I had prepared the plates.")
        print("Landscape bounds: app=\(app.frame), answer=\(first.frame), keyboard=\(keyboard.frame)")
        XCTAssertEqual(app.webViews.count,0);capture(app,"06-native-landscape-keyboard")
    }
}
