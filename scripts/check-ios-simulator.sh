#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/build/ios-simulator"
mkdir -p "$OUT"
RUNTIME=$(xcrun simctl list runtimes available --json | python3 -c 'import json,sys; r=[r for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; print(sorted(r,key=lambda x:tuple(map(int,x["version"].split("."))))[-1]["identifier"])')
DEVICE=$(xcrun simctl create LanguageStudyCoach-QA com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro "$RUNTIME")
trap 'xcrun simctl shutdown "$DEVICE" || true' EXIT
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool NO
xcodebuild -project ios/App.xcodeproj -scheme App -configuration Debug -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$OUT/DerivedData" build CODE_SIGNING_ALLOWED=NO > "$OUT/build.log" 2>&1 || { tail -80 "$OUT/build.log"; exit 1; }
xcrun simctl status_bar "$DEVICE" override --time '9:41' --batteryState charged --batteryLevel 100
xcrun simctl install "$DEVICE" "$OUT/DerivedData/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl launch "$DEVICE" com.languagestudycoach.app
sleep 10
xcrun simctl io "$DEVICE" screenshot "$OUT/iphone16pro.png"
set +e
xcodebuild -project ios/App.xcodeproj -scheme App -configuration Debug -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$OUT/DerivedData" -resultBundlePath "$OUT/NativeTests.xcresult" -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 120 -maximum-test-execution-time-allowance 180 test CODE_SIGNING_ALLOWED=NO 2>&1 | tee "$OUT/tests.log"
TEST_EXIT=${PIPESTATUS[0]}
set -e
xcrun xcresulttool export attachments --path "$OUT/NativeTests.xcresult" --output-path "$OUT/screenshots" || true
exit "$TEST_EXIT"
