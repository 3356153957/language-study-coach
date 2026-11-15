import Foundation
import SwiftUI
import JavaScriptCore
import CryptoKit
import Security

enum J: Codable, Equatable {
    case object([String:J]), array([J]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c=try decoder.singleValueContainer()
        if c.decodeNil(){self = .null}
        else if let v=try? c.decode(Bool.self){self = .bool(v)}
        else if let v=try? c.decode(Double.self){self = .number(v)}
        else if let v=try? c.decode(String.self){self = .string(v)}
        else if let v=try? c.decode([String:J].self){self = .object(v)}
        else{self = .array(try c.decode([J].self))}
    }
    func encode(to encoder: Encoder) throws {
        var c=encoder.singleValueContainer()
        switch self{case .null:try c.encodeNil();case .object(let v):try c.encode(v);case .array(let v):try c.encode(v);case .string(let v):try c.encode(v);case .number(let v):try c.encode(v);case .bool(let v):try c.encode(v)}
    }
    subscript(_ key:String)->J{if case .object(let v)=self{return v[key] ?? .null};return .null}
    var text:String{switch self{case .string(let v):return v;case .number(let v):return Int(exactly:v).map{String($0)} ?? String(v);default:return ""}}
    var list:[J]{if case .array(let v)=self{return v};return []}
    var dictionary:[String:J]{if case .object(let v)=self{return v};return [:]}
    var flag:Bool{if case .bool(let v)=self{return v};return false}
    var int:Int{if case .number(let v)=self{return Int(exactly:v) ?? 0};return 0}
    var exists:Bool{self != .null}
    var json:String{let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys];return String(data:(try? encoder.encode(self)) ?? Data("null".utf8),encoding:.utf8)!}
    var recordID:String{self["id"].text}
    var dateKey:String{self["date"].text}
    static func decode(_ data:Data)throws->J{try JSONDecoder().decode(J.self,from:data)}
    static func s(_ text:String)->J{.string(text)}
    static func n(_ value:Int)->J{.number(Double(value))}
}
struct StudyError:LocalizedError {let message:String;init(_ text:String){message=text};var errorDescription:String?{message}}

// Uses the exact Keychain service/account and AES-GCM format of the earlier IPA.
struct StudyVault {
    var directory:URL {get throws{try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)}}
    func key(create:Bool)throws->SymmetricKey {
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:Bundle.main.bundleIdentifier ?? "com.languagestudycoach.app",kSecAttrAccount as String:"study-storage-key-v1"]
        var lookup=query;lookup[kSecReturnData as String]=true;lookup[kSecMatchLimit as String]=kSecMatchLimitOne
        var result:CFTypeRef?;let status=SecItemCopyMatching(lookup as CFDictionary,&result)
        if status==errSecSuccess,let data=result as? Data{return SymmetricKey(data:data)}
        guard status==errSecItemNotFound,create else{throw StudyError("无法读取本机加密密钥，请勿卸载应用。")}
        let key=SymmetricKey(size:.bits256);var record=query
        record[kSecValueData as String]=key.withUnsafeBytes{Data($0)};record[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(record as CFDictionary,nil)==errSecSuccess else{throw StudyError("无法保存本机加密密钥。")};return key
    }
    func read(_ name:String)throws->String? {
        let file=try directory.appendingPathComponent(name+".enc")
        guard FileManager.default.fileExists(atPath:file.path) else{return nil}
        let box=try AES.GCM.SealedBox(combined:Data(contentsOf:file))
        let data=try AES.GCM.open(box,using:key(create:false))
        guard let value=String(data:data,encoding:.utf8) else{throw StudyError("学习记录无法解码，请勿卸载应用。")};return value
    }
    func write(_ name:String,_ value:String)throws {
        var folder=try directory
        var values=URLResourceValues();values.isExcludedFromBackup=true;try folder.setResourceValues(values)
        let file=folder.appendingPathComponent(name+".enc")
        let encrypted=try AES.GCM.seal(Data(value.utf8),using:key(create:true)).combined!
        try encrypted.write(to:file,options:[.atomic,.completeFileProtection])
    }
}

@MainActor final class StudyRuntime {
    let context=JSContext()!
    let vault=StudyVault()
    let http=StudyHTTP()
    let auth=StudyAuthorization()
    var timers:[Int:DispatchWorkItem]=[:],timerID=0
    var nativeTasks:[String:Task<Void,Never>]=[:]
    var continuations:[String:CheckedContinuation<J,Error>]=[:]
    var startupError:String?
    let fixture:Bool
    init(fixture:Bool=false){
        self.fixture=fixture
        var stores:[String:String]=[:]
        if fixture{stores["learning-state"]=Self.fixtureState}
        if !fixture {do{for name in ["learning-state","chatgpt-auth","cloud-sync"]{stores[name]=try vault.read(name)}}catch{startupError="无法读取手机上的加密记录，原文件已保留。请勿卸载应用。"}}
        context.exceptionHandler={ [weak self] _,_ in self?.startupError="手机学习服务暂时无法启动，请保留本机记录并更新应用。" }
        let load:@convention(block)(String)->String={ [weak self] name in
            if let cached=stores.removeValue(forKey:name){return cached}
            if fixture{return "null"}
            do{return try self?.vault.read(name) ?? "null"}catch{return "{unreadable"}
        };context.setObject(load,forKeyedSubscript:"__nativeLoad" as NSString)
        let save:@convention(block)(String,String)->String={ [weak self] name,value in
            guard let self=self else{return "应用已关闭。"};if fixture{stores[name]=value;return ""}
            do{try self.vault.write(name,value);return ""}catch{return "保存失败，原记录未覆盖，请检查手机存储空间。"}
        };context.setObject(save,forKeyedSubscript:"__nativeSave" as NSString)
        let config:@convention(block)()->String={
            if fixture{return "{\"url\":\"https://fixture.supabase.co\",\"publishableKey\":\"sb_publishable_native_fixture_only\"}"}
            guard let url=Bundle.main.url(forResource:"public-config",withExtension:"json",subdirectory:"NativeResources"),let text=try? String(contentsOf:url) else{return "{}"};return text
        };context.setObject(config,forKeyedSubscript:"__nativeConfig" as NSString)
        let zone:@convention(block)()->String={TimeZone.current.identifier};context.setObject(zone,forKeyedSubscript:"__nativeTimeZone" as NSString)
        let uuid:@convention(block)()->String={UUID().uuidString.lowercased()};context.setObject(uuid,forKeyedSubscript:"__nativeUUID" as NSString)
        let random:@convention(block)(Int)->String={count in
            guard (0...65536).contains(count) else{return "null"}
            var data=[UInt8](repeating:0,count:count)
            guard SecRandomCopyBytes(kSecRandomDefault,data.count,&data)==errSecSuccess else{return "null"}
            return String(data:try! JSONEncoder().encode(data),encoding:.utf8)!
        };context.setObject(random,forKeyedSubscript:"__nativeRandom" as NSString)
        let digest:@convention(block)(String)->String={text in let bytes=(try? JSONDecoder().decode([UInt8].self,from:Data(text.utf8))) ?? [];return String(data:try! JSONEncoder().encode(Array(SHA256.hash(data:Data(bytes)))),encoding:.utf8)!};context.setObject(digest,forKeyedSubscript:"__nativeSHA256" as NSString)
        let base64:@convention(block)(String,Bool)->String={text,encode in if encode{return Data(text.unicodeScalars.map{UInt8(truncatingIfNeeded:$0.value)}).base64EncodedString()};var raw=text.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");raw+=String(repeating:"=",count:(4-raw.count%4)%4);return String((Data(base64Encoded:raw) ?? Data()).map{Character(UnicodeScalar($0))})};context.setObject(base64,forKeyedSubscript:"__nativeBase64" as NSString)
        let url:@convention(block)(String,String)->String={raw,base in
            guard let u=URL(string:raw,relativeTo:URL(string:base))?.absoluteURL,let c=URLComponents(url:u,resolvingAgainstBaseURL:true),let scheme=c.scheme,let host=c.host else{return "{\"error\":true}"}
            let origin="\(scheme)://\(host)"+(c.port.map{":\($0)"} ?? "")
            return J.object(["href":.s(u.absoluteString),"origin":.s(origin),"protocol":.s(scheme+":"),"hostname":.s(host),"port":.s(c.port.map{String($0)} ?? ""),"pathname":.s(c.percentEncodedPath.isEmpty ? "/":c.percentEncodedPath),"search":.s(c.percentEncodedQuery.map{"?"+$0} ?? ""),"hash":.s(c.percentEncodedFragment.map{"#"+$0} ?? ""),"username":.s(c.user ?? ""),"password":.s(c.password ?? "")]).json
        };context.setObject(url,forKeyedSubscript:"__nativeURL" as NSString)
        let timer:@convention(block)(JSValue,Double)->Int={ [weak self] callback,ms in guard let self=self else{return 0};self.timerID+=1;let id=self.timerID;let item=DispatchWorkItem{ [weak self] in self?.timers.removeValue(forKey:id);callback.call(withArguments:[])};self.timers[id]=item;DispatchQueue.main.asyncAfter(deadline:.now()+ms/1000,execute:item);return id};context.setObject(timer,forKeyedSubscript:"__nativeTimer" as NSString)
        let clear:@convention(block)(Int)->Void={ [weak self] id in self?.timers.removeValue(forKey:id)?.cancel()};context.setObject(clear,forKeyedSubscript:"__nativeClearTimer" as NSString)
        let invoke:@convention(block)(String,String,String)->Void={ [weak self] id,action,json in
            guard let self=self else{return}
            self.nativeTasks[id]=Task{@MainActor [weak self] in
                guard let self=self else{return};defer{self.nativeTasks.removeValue(forKey:id)}
                do{try Task.checkCancellation();let input=try J.decode(Data(json.utf8));let value=try await self.native(action,input);try Task.checkCancellation();self.context.objectForKeyedSubscript("nativeDeliver").call(withArguments:[id,value.json,""])}
                catch{self.context.objectForKeyedSubscript("nativeDeliver").call(withArguments:[id,"null",error.localizedDescription])}
            }
        };context.setObject(invoke,forKeyedSubscript:"__nativeInvoke" as NSString)
        let cancel:@convention(block)(String)->Void={ [weak self] id in self?.nativeTasks.removeValue(forKey:id)?.cancel() };context.setObject(cancel,forKeyedSubscript:"__nativeCancel" as NSString)
        let complete:@convention(block)(String,String,String)->Void={ [weak self] id,json,error in guard let c=self?.continuations.removeValue(forKey:id) else{return};if !error.isEmpty{c.resume(throwing:StudyError(error))}else{do{c.resume(returning:try J.decode(Data(json.utf8)))}catch{c.resume(throwing:error)}}};context.setObject(complete,forKeyedSubscript:"__complete" as NSString)
        guard startupError==nil,let resource=Bundle.main.url(forResource:"study-engine",withExtension:"js",subdirectory:"NativeResources"),let script=try? String(contentsOf:resource) else{startupError=startupError ?? "找不到学习引擎，请重新安装更新包。";return}
        context.evaluateScript(script)
        context.exceptionHandler={_,_ in}
        if fixture{context.evaluateScript(Self.fixtureScript)}
    }
    func request(_ path:String,_ body:J = .object([:]))async throws->J {
        if let error=startupError{throw StudyError(error)}
        let id=UUID().uuidString
        return try await withCheckedThrowingContinuation{c in continuations[id]=c;context.evaluateScript("Promise.resolve().then(()=>studyRequest(\(J.s(path).json),\(body.json))).then(v=>__complete(\(J.s(id).json),JSON.stringify(v),''),e=>__complete(\(J.s(id).json),'null',String(e.message||e)));")}
    }
    func native(_ action:String,_ input:J)async throws->J {
        switch action{
        case "http":if fixture{return try await fixtureHTTP(input)};return try await http.send(input)
        case "prepareAuth":return .object(["redirectURI":.s(try await auth.prepare())])
        case "openAuth":return .object(["callbackURL":.s(try await auth.open(input["url"].text))])
        case "cancelAuth":auth.cancel();return .null
        case "verifyIdentity":
            let response=try await http.send(.object(["url":.s("https://auth.openai.com/.well-known/jwks.json")]))
            guard response["status"].int==200 else{throw StudyError("暂时无法验证 ChatGPT 身份，请重试。")}
            let keys=try J.decode(Data(response["body"].text.utf8))
            return try SignedIdentity.verify(input,keys:keys)
        default:throw StudyError("不支持的手机操作。")
        }
    }
}
