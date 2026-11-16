import { execFileSync } from 'node:child_process';
if(process.platform!=='darwin')throw new Error('打开 SwiftUI 工程需要 macOS；Windows 可运行 npm run ios:sync 准备资源。');
await import('./build-native-ios.mjs');
execFileSync('xcodegen',['generate','--spec','ios/project.yml','--project','ios'],{stdio:'inherit'});
execFileSync('open',['ios/App.xcodeproj'],{stdio:'inherit'});
