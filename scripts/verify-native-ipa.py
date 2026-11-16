"""Verify the exported SwiftUI package, without treating it as a device test."""
import argparse
import hashlib
import json
import plistlib
import struct
import zipfile
from pathlib import Path


def require(condition, message):
    if not condition:
        raise SystemExit(message)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("ipa", type=Path)
parser.add_argument("--resources", type=Path, default=Path("ios/App/App/NativeResources"))
parser.add_argument("--version", default="2.0.2")
parser.add_argument("--build", default="10")
parser.add_argument("--commit", required=True)
parser.add_argument("--run", required=True)
args = parser.parse_args()

with zipfile.ZipFile(args.ipa) as archive:
    require(archive.testzip() is None, "IPA ZIP integrity check failed")
    names = archive.namelist()
    prefix = "Payload/App.app/"
    info = plistlib.loads(archive.read(prefix + "Info.plist"))
    require(info["CFBundleIdentifier"] == "com.languagestudycoach.app", "Unexpected Bundle ID")
    require(info["CFBundleShortVersionString"] == args.version, "Wrong app version")
    require(str(info["CFBundleVersion"]) == args.build, "Wrong app build number")
    require(isinstance(info.get("UIApplicationSceneManifest"), dict), "Native scene manifest missing")
    require(not info.get("UIMainStoryboardFile"), "Unexpected legacy storyboard entry")
    executable = archive.read(prefix + info["CFBundleExecutable"])
    magic, cpu, _, kind, commands, _, _, _ = struct.unpack_from("<8I", executable)
    require(magic == 0xFEEDFACF and cpu == 0x100000C and kind == 2, "Expected arm64 Mach-O executable")
    libraries, platform, offset = [], None, 32
    for _ in range(commands):
        command, size = struct.unpack_from("<II", executable, offset)
        require(size >= 8 and offset + size <= len(executable), "Invalid Mach-O load command")
        if command in (0xC, 0x18, 0x80000018, 0x1F, 0x8000001F):
            start = offset + struct.unpack_from("<I", executable, offset + 8)[0]
            libraries.append(executable[start:offset + size].split(b"\0")[0].decode())
        if command == 0x32:
            platform = struct.unpack_from("<I", executable, offset + 8)[0]
        offset += size
    require(platform == 2, "Expected an iPhoneOS build, not a simulator build")
    for framework in ("SwiftUI", "JavaScriptCore"):
        require(any(f"/{framework}.framework/" in name for name in libraries), f"{framework} framework missing")
    require(not any("Capacitor" in name or name.endswith("/public/index.html") for name in names), "Legacy web assets found")
    forbidden = ("learning-state.enc", "chatgpt-auth.enc", "cloud-sync.enc", ".env", ".env.local")
    require(not any(name.rsplit("/", 1)[-1] in forbidden for name in names), "Personal data found in package")
    for resource in ("study-engine.js", "public-config.json"):
        require(archive.read(prefix + "NativeResources/" + resource) == (args.resources / resource).read_bytes(), f"Bundled {resource} differs from verified resources")
    signed = any(name.startswith(prefix + "_CodeSignature/") for name in names)

report = {
    "file": str(args.ipa.resolve()),
    "sha256": hashlib.sha256(args.ipa.read_bytes()).hexdigest(),
    "bytes": args.ipa.stat().st_size,
    "version": args.version,
    "build": args.build,
    "bundleId": info["CFBundleIdentifier"],
    "minimumOS": info["MinimumOSVersion"],
    "architecture": "arm64",
    "platform": "iPhoneOS",
    "ui": "SwiftUI",
    "engine": "JavaScriptCore",
    "nativeSceneManifest": True,
    "legacyWebAssets": False,
    "personalDataBundled": False,
    "engineAndPublicConfigMatchLocal": True,
    "signed": signed,
    "sourceCommit": args.commit,
    "buildRun": args.run,
    "deviceTesting": "not run",
}
destination = args.ipa.with_name("verification.json")
destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
