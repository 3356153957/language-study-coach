import Capacitor
import CryptoKit
import Foundation
import Security
import UIKit
import WebKit
import Network
import SafariServices
import UniformTypeIdentifiers

class StudyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StudyStoragePlugin())
        bridge?.registerPluginInstance(StudyDevicePlugin())
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        updateSafeArea()
    }
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        updateSafeArea()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        updateSafeArea()
    }
    private func updateSafeArea() {
        guard isViewLoaded else { return }
        let i = view.safeAreaInsets
        let script = "document.documentElement.style.setProperty('--safe-top','\(i.top)px');document.documentElement.style.setProperty('--safe-bottom','\(i.bottom)px');document.documentElement.style.setProperty('--safe-left','\(i.left)px');document.documentElement.style.setProperty('--safe-right','\(i.right)px');"
        webView?.evaluateJavaScript(script, completionHandler: nil)
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
        ,CAPPluginMethod(name: "loadAuth", returnType: CAPPluginReturnPromise)
        ,CAPPluginMethod(name: "saveAuth", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "com.languagestudycoach.storage")

    private func fileURL(_ name: String = "learning-state.enc") throws -> URL {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true)
        return directory.appendingPathComponent(name)
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

    @objc public func loadAuth(_ call: CAPPluginCall) {
        queue.async {
            do {
                let url = try self.fileURL("chatgpt-auth.enc")
                guard FileManager.default.fileExists(atPath: url.path) else { call.resolve(["value": NSNull()]); return }
                let box = try AES.GCM.SealedBox(combined: Data(contentsOf: url))
                let clear = try AES.GCM.open(box, using: self.key(create: false))
                guard let value = String(data: clear, encoding: .utf8) else { call.reject("授权记录编码无效"); return }
                call.resolve(["value": value])
            } catch { call.reject("无法读取 ChatGPT 授权记录") }
        }
    }
    @objc public func saveAuth(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), let clear = value.data(using: .utf8) else { call.reject("缺少授权记录"); return }
        queue.async {
            do {
                var url = try self.fileURL("chatgpt-auth.enc")
                let box = try AES.GCM.seal(clear, using: self.key(create: true))
                guard let encrypted = box.combined else { call.reject("授权加密失败"); return }
                try encrypted.write(to: url, options: [.atomic, .completeFileProtection])
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try url.setResourceValues(values)
                call.resolve()
            } catch { call.reject("无法保存 ChatGPT 授权") }
        }
    }
}

@objc(StudyDevicePlugin)
public class StudyDevicePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, SFSafariViewControllerDelegate {
    public let identifier = "StudyDevicePlugin"
    public let jsName = "StudyDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "safeArea", returnType: CAPPluginReturnPromise)
    ]
    private var pickerCall: CAPPluginCall?
    private var authCall: CAPPluginCall?
    private var listener: NWListener?
    private var safari: SFSafariViewController?
    private var redirectURI: String?
    private var authTimeout: DispatchWorkItem?

    @objc public func safeArea(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let i = self.bridge?.viewController?.view.safeAreaInsets ?? .zero
            call.resolve(["top": i.top, "bottom": i.bottom, "left": i.left, "right": i.right])
        }
    }
    @objc public func exportFile(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), let bytes = value.data(using: .utf8), bytes.count <= 20 * 1024 * 1024 else { call.reject("备份内容无效或超过 20 MB"); return }
        DispatchQueue.main.async {
            do {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("language-study-coach-\(UUID().uuidString).json")
                try bytes.write(to: url, options: .atomic)
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = self.bridge?.viewController?.view
                sheet.completionWithItemsHandler = { _, completed, _, _ in
                    try? FileManager.default.removeItem(at: url)
                    call.resolve(["completed": completed])
                }
                self.bridge?.viewController?.present(sheet, animated: true)
            } catch { call.reject("无法创建备份文件") }
        }
    }
    @objc public func importFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else { call.reject("文件选择器已打开"); return }
            self.pickerCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
            picker.delegate = self; picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { pickerCall?.resolve(["cancelled": true]); pickerCall = nil }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall else { return }; pickerCall = nil
        guard let url = urls.first else { call.reject("未选择文件"); return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 20 * 1024 * 1024 else { call.reject("备份文件超过 20 MB"); return }
            let data = try Data(contentsOf: url)
            guard data.count <= 20 * 1024 * 1024, let value = String(data: data, encoding: .utf8) else { call.reject("文件不是有效的 JSON 文本"); return }
            call.resolve(["value": value])
        } catch { call.reject("文件无法读取") }
    }
    private func closeAuth() {
        listener?.cancel(); listener = nil; redirectURI = nil
        authTimeout?.cancel(); authTimeout = nil
        safari?.dismiss(animated: true); safari = nil
    }
    @objc public func prepareAuth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.authCall?.reject("已取消上次授权"); self.authCall = nil; self.closeAuth()
            do {
                let params = NWParameters.tcp
                params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
                let listener = try NWListener(using: params)
                self.listener = listener
                var answered = false
                listener.stateUpdateHandler = { state in
                    if case .ready = state, !answered, let port = listener.port {
                        answered = true
                        let uri = "http://127.0.0.1:\(port.rawValue)/auth/callback"
                        self.redirectURI = uri; call.resolve(["redirectURI": uri])
                        listener.stateUpdateHandler = nil
                    } else if case .failed = state, !answered { answered = true; self.closeAuth(); call.reject("无法启动本机授权回调") }
                }
                listener.newConnectionHandler = { connection in self.receiveCallback(connection) }
                listener.start(queue: .main)
                let timeout = DispatchWorkItem { [weak self] in
                    self?.authCall?.reject("授权超时，请重新登录"); self?.authCall = nil; self?.closeAuth()
                }
                self.authTimeout = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 600, execute: timeout)
            } catch { call.reject("无法准备授权连接") }
        }
    }
    @objc public func openAuth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https", url.host == "auth.openai.com", url.path == "/api/accounts/authorize",
                let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                components.queryItems?.first(where: { $0.name == "redirect_uri" })?.value == self.redirectURI,
                self.listener != nil else { call.reject("授权地址校验失败"); return }
            self.authCall = call
            let safari = SFSafariViewController(url: url); safari.delegate = self
            self.safari = safari; self.bridge?.viewController?.present(safari, animated: true)
        }
    }
    private func receiveCallback(_ connection: NWConnection) {
        connection.start(queue: .main)
        receiveHeaders(connection, buffer: Data())
    }
    private func receiveHeaders(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, error in
            guard let self = self else { connection.cancel(); return }
            var bytes = buffer; if let data = data { bytes.append(data) }
            guard bytes.count <= 16384 else { connection.cancel(); return }
            guard let request = String(data: bytes, encoding: .utf8), request.contains("\r\n\r\n") else {
                if !complete && error == nil { self.receiveHeaders(connection, buffer: bytes) } else { connection.cancel() }
                return
            }
            let fields = request.components(separatedBy: "\r\n")[0].split(separator: " ")
            guard fields.count == 3, fields[0] == "GET", fields[1].hasPrefix("/auth/callback?"), let base = self.redirectURI, self.authCall != nil else { connection.cancel(); return }
            let origin = String(base.dropLast("/auth/callback".count))
            let callback = origin + String(fields[1])
            let body = "<!doctype html><meta name=viewport content=width=device-width><p>Return to Language Study Coach.</p>"
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
            connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in connection.cancel() })
            let call = self.authCall; self.authCall = nil; self.closeAuth()
            call?.resolve(["callbackURL": callback])
        }
    }
    @objc public func cancelAuth(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.authCall?.reject("已取消授权"); self.authCall = nil; self.closeAuth(); call.resolve() }
    }
    public func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        authCall?.reject("已取消 ChatGPT 授权"); authCall = nil; closeAuth()
    }
}
