import Capacitor
import CryptoKit
import Foundation
import Security

class StudyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StudyStoragePlugin())
    }
}

// Records and user API keys are encrypted together; only the encryption key is
// stored in Keychain. The atomic write preserves the previous state on failure.
@objc(StudyStoragePlugin)
public class StudyStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StudyStoragePlugin"
    public let jsName = "StudyStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "com.languagestudycoach.storage")

    private func fileURL() throws -> URL {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true)
        return directory.appendingPathComponent("learning-state.enc")
    }

    private func key(create: Bool) throws -> SymmetricKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "com.languagestudycoach.app",
            kSecAttrAccount as String: "study-storage-key-v1"]
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecSuccess, let bytes = result as? Data { return SymmetricKey(data: bytes) }
        guard status == errSecItemNotFound, create else {
            throw NSError(domain: "StudyStorage", code: Int(status))
        }
        let key = SymmetricKey(size: .bits256)
        var record = query
        record[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        record[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(record as CFDictionary, nil)
        guard added == errSecSuccess else { throw NSError(domain: "StudyStorage", code: Int(added)) }
        return key
    }

    @objc public func load(_ call: CAPPluginCall) {
        queue.async {
            do {
                let url = try self.fileURL()
                guard FileManager.default.fileExists(atPath: url.path) else {
                    call.resolve(["value": NSNull()]); return
                }
                let box = try AES.GCM.SealedBox(combined: Data(contentsOf: url))
                let clear = try AES.GCM.open(box, using: self.key(create: false))
                guard let value = String(data: clear, encoding: .utf8) else {
                    call.reject("学习记录编码无效"); return
                }
                call.resolve(["value": value])
            } catch { call.reject("无法读取加密学习记录") }
        }
    }

    @objc public func save(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), let clear = value.data(using: .utf8) else {
            call.reject("缺少学习记录"); return
        }
        queue.async {
            do {
                var url = try self.fileURL()
                let exists = FileManager.default.fileExists(atPath: url.path)
                let box = try AES.GCM.seal(clear, using: self.key(create: !exists))
                guard let encrypted = box.combined else { call.reject("记录加密失败"); return }
                try encrypted.write(to: url, options: [.atomic, .completeFileProtection])
                // The key is device-only, so an encrypted backup on another phone
                // would not be recoverable. Do not include this file in cloud backup.
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try? url.setResourceValues(values)
                call.resolve()
            } catch { call.reject("无法保存加密学习记录") }
        }
    }
}
