#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test "$(uname)" = Darwin || { echo 'IPA compilation requires macOS with Xcode.'; exit 1; }
OUT="$PWD/build/ios"
mkdir -p "$OUT"
COMMON=(-project ios/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$OUT/App.xcarchive")
if [[ "${SIGNED:-false}" == true ]]; then
  PROFILE_PLIST="${RUNNER_TEMP:?}/profile.plist"
  TEAM=$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$PROFILE_PLIST")
  PROFILE_UUID=$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$PROFILE_PLIST")
  xcodebuild "${COMMON[@]}" archive CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM" PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" CODE_SIGN_IDENTITY='Apple Distribution' 2>&1 | tee "$OUT/archive.log"
  export TEAM PROFILE_UUID OUT
  python3 - <<'PY'
import os, plistlib
with open(os.environ['OUT'] + '/ExportOptions.plist', 'wb') as f:
    plistlib.dump({'method': 'release-testing', 'signingStyle': 'manual',
        'teamID': os.environ['TEAM'], 'signingCertificate': 'Apple Distribution',
        'provisioningProfiles': {'com.languagestudycoach.app': os.environ['PROFILE_UUID']}}, f)
PY
  xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportPath "$OUT" -exportOptionsPlist "$OUT/ExportOptions.plist"
else
  xcodebuild "${COMMON[@]}" archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO 2>&1 | tee "$OUT/archive.log"
  mkdir -p "$OUT/unsigned/Payload"
  ditto "$OUT/App.xcarchive/Products/Applications/App.app" "$OUT/unsigned/Payload/App.app"
  (cd "$OUT/unsigned" && zip -qr "$OUT/LanguageStudyCoach-unsigned.ipa" Payload)
  echo 'Unsigned IPA generated. It cannot be installed until signed.'
fi
