import XCTest

final class NativeUITests:XCTestCase {
    func capture(_ app:XCUIApplication,_ name:String){let shot=XCTAttachment(screenshot:app.screenshot());shot.name=name;shot.lifetime = .keepAlways;add(shot)}
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
    }
}
