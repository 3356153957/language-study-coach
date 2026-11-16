import Foundation
import Security
import UIKit
import SafariServices
import Network

final class StudyHTTP:NSObject,URLSessionTaskDelegate {
    lazy var session:URLSession={let config=URLSessionConfiguration.ephemeral;config.timeoutIntervalForRequest=60;config.timeoutIntervalForResource=65;return URLSession(configuration:config,delegate:self,delegateQueue:nil)}()
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
    func send(_ input:J)async throws->J {
        guard let url=URL(string:input["url"].text),url.scheme=="https",url.user==nil,url.password==nil else{throw StudyError("手机接口地址须为 HTTPS，且不能包含账号密码。")}
        var request=URLRequest(url:url);request.httpMethod=input["method"].text.isEmpty ? "GET":input["method"].text
        request.timeoutInterval=Double(min(60000,max(1000,input["timeout"].int == 0 ? 60000:input["timeout"].int)))/1000
        for (key,value) in input["headers"].dictionary{request.setValue(value.text,forHTTPHeaderField:key)}
        if input["body"].exists{request.httpBody=Data(input["body"].text.utf8)}
        let data:Data,response:URLResponse
        do{(data,response)=try await session.data(for:request)}catch{throw StudyError((error as? URLError)?.code == .timedOut ? "请求超时，请稍后重试。":"无法连接服务，请检查网络后重试。")}
        guard let http=response as? HTTPURLResponse,data.count<=5*1024*1024 else{throw StudyError("服务返回的内容过大或格式无效。")}
        if (300..<400).contains(http.statusCode){throw StudyError("接口发生跳转，已停止请求，请检查接口基础地址。")}
        let headers=http.allHeaderFields.reduce(into:[String:J]()){result,entry in result[String(describing:entry.key).lowercased()] = .s(String(describing:entry.value))}
        return .object(["status":.n(http.statusCode),"headers":.object(headers),"body":.s(String(data:data,encoding:.utf8) ?? "")])
    }
}

enum SignedIdentity {
    static func data(_ value:String)throws->Data{
        var raw=value.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");raw+=String(repeating:"=",count:(4-raw.count%4)%4)
        guard let data=Data(base64Encoded:raw) else{throw StudyError("ChatGPT 身份校验失败，本次授权未保存。")};return data
    }
    static func der(_ tag:UInt8,_ bytes:Data)->Data{
        var result=Data([tag]);let count=bytes.count
        if count<128{result.append(UInt8(count))}else{var n=count,parts=[UInt8]();while n>0{parts.insert(UInt8(n&255),at:0);n>>=8};result.append(UInt8(0x80|parts.count));result.append(contentsOf:parts)}
        result.append(bytes);return result
    }
    static func integer(_ bytes:Data)->Data{var value=bytes;while value.count>1 && value.first==0{value.removeFirst()};if (value.first ?? 0)&0x80 != 0{value.insert(0,at:0)};return der(2,value)}
    static func verify(_ input:J,keys:J)throws->J {
        do{
            let token=input["token"].text,parts=token.split(separator:".",omittingEmptySubsequences:false).map(String.init)
            guard parts.count==3 else{throw StudyError("")}
            let header=try J.decode(data(parts[0])),payload=try J.decode(data(parts[1])),now=Double(input["now"].int)/1000
            let audience=payload["aud"].text==input["clientId"].text || payload["aud"].list.contains(.s(input["clientId"].text))
            guard header["alg"].text=="RS256",!header["crit"].exists,payload["iss"].text=="https://auth.openai.com",audience,payload["nonce"].text==input["nonce"].text,!payload["sub"].text.isEmpty,payload["exp"].int>Int(now),payload["iat"].int>0,payload["iat"].int<=Int(now)+60 else{throw StudyError("")}
            if payload["nbf"].exists{guard case .number(let validAfter)=payload["nbf"],validAfter<=now else{throw StudyError("")}}
            let matches=keys["keys"].list.filter{$0["kty"].text=="RSA" && (!$0["use"].exists || $0["use"].text=="sig") && (!$0["alg"].exists || $0["alg"].text=="RS256") && (header["kid"].text.isEmpty || $0["kid"].text==header["kid"].text)}
            guard matches.count==1 else{throw StudyError("")};let jwk=matches[0]
            let keyData=der(0x30,try integer(data(jwk["n"].text))+integer(data(jwk["e"].text)))
            let attributes:[CFString:Any]=[kSecAttrKeyType:kSecAttrKeyTypeRSA,kSecAttrKeyClass:kSecAttrKeyClassPublic]
            guard let key=SecKeyCreateWithData(keyData as CFData,attributes as CFDictionary,nil),SecKeyVerifySignature(key,.rsaSignatureMessagePKCS1v15SHA256,Data((parts[0]+"."+parts[1]).utf8) as CFData,try data(parts[2]) as CFData,nil) else{throw StudyError("")}
            return .object(["subject":payload["sub"],"email":payload["email"].exists ? payload["email"]:.s("")])
        }catch{throw StudyError("ChatGPT 身份校验失败，本次授权未保存。")}
    }
}

@MainActor final class StudyAuthorization:NSObject,SFSafariViewControllerDelegate {
    private var listener:NWListener?
    private var safari:SFSafariViewController?
    private var redirectURI:String?
    private var preparation:CheckedContinuation<String,Error>?
    private var pending:CheckedContinuation<String,Error>?
    private var preparationTimeout:Task<Void,Never>?
    private var timeout:Task<Void,Never>?
    private var attempt=UUID()

    func cancel(){close("已取消 ChatGPT 授权。")}
    private func close(_ reason:String){
        attempt=UUID()
        listener?.cancel();listener=nil
        preparationTimeout?.cancel();preparationTimeout=nil
        timeout?.cancel();timeout=nil
        safari?.dismiss(animated:true);safari=nil;redirectURI=nil
        let preparing=preparation,waiting=pending;preparation=nil;pending=nil
        preparing?.resume(throwing:StudyError(reason));waiting?.resume(throwing:StudyError(reason))
    }
    func prepare()async throws->String{
        cancel()
        let generation=attempt
        let parameters=NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
        let server:NWListener
        do{server=try NWListener(using:parameters)}catch{throw StudyError("无法准备本机授权连接，请重试。")}
        listener=server
        return try await withCheckedThrowingContinuation{continuation in
            preparation=continuation
            server.stateUpdateHandler={ [weak self] state in
                Task{@MainActor [weak self] in self?.listenerChanged(state,generation:generation)}
            }
            server.newConnectionHandler={ [weak self] connection in
                Task{@MainActor [weak self] in
                    guard let self=self,self.attempt==generation else{connection.cancel();return}
                    connection.start(queue:.main);self.receive(connection,Data(),generation:generation)
                }
            }
            server.start(queue:.main)
            preparationTimeout=Task{@MainActor [weak self] in
                do{try await Task.sleep(nanoseconds:10_000_000_000)}catch{return}
                guard let self=self,self.attempt==generation,self.preparation != nil else{return}
                self.close("无法准备授权连接，请重试。")
            }
        }
    }
    private func listenerChanged(_ state:NWListener.State,generation:UUID){
        guard attempt==generation else{return}
        switch state{
        case .ready:
            guard let port=listener?.port,let continuation=preparation else{return}
            let uri="http://127.0.0.1:\(port.rawValue)/auth/callback"
            redirectURI=uri;preparation=nil;preparationTimeout?.cancel();preparationTimeout=nil
            continuation.resume(returning:uri)
        case .failed,.cancelled:close("本机授权连接已中断，请重试。")
        default:break
        }
    }
    func open(_ raw:String)async throws->String{
        guard let url=URL(string:raw),url.scheme=="https",url.host=="auth.openai.com",url.path=="/api/accounts/authorize",let components=URLComponents(url:url,resolvingAgainstBaseURL:false),components.queryItems?.first(where:{$0.name=="redirect_uri"})?.value==redirectURI,listener != nil else{throw StudyError("授权地址校验失败。")}
        guard let root=UIApplication.shared.connectedScenes.compactMap({$0 as? UIWindowScene}).flatMap({$0.windows}).first(where:{$0.isKeyWindow})?.rootViewController else{throw StudyError("暂时无法打开授权页面。")}
        let generation=attempt
        return try await withCheckedThrowingContinuation{continuation in
            pending=continuation
            let controller=SFSafariViewController(url:url);controller.delegate=self;safari=controller
            var presenter=root;while let presented=presenter.presentedViewController{presenter=presented}
            presenter.present(controller,animated:true)
            timeout=Task{@MainActor [weak self] in
                do{try await Task.sleep(nanoseconds:600_000_000_000)}catch{return}
                guard let self=self,self.attempt==generation else{return}
                self.close("本次授权已超时，请重新登录。")
            }
        }
    }
    private func receive(_ connection:NWConnection,_ previous:Data,generation:UUID){
        connection.receive(minimumIncompleteLength:1,maximumLength:16384){ [weak self] data,_,complete,error in
            Task{@MainActor [weak self] in
                self?.received(connection,previous:previous,data:data,complete:complete,error:error,generation:generation)
            }
        }
    }
    private func received(_ connection:NWConnection,previous:Data,data:Data?,complete:Bool,error:NWError?,generation:UUID){
        guard generation==attempt else{connection.cancel();return}
        var bytes=previous;if let data=data{bytes.append(data)}
        guard bytes.count<=16384 else{connection.cancel();return}
        guard let request=String(data:bytes,encoding:.utf8),request.contains("\r\n\r\n") else{
            if !complete && error==nil{receive(connection,bytes,generation:generation)}else{connection.cancel()};return
        }
        let fields=request.components(separatedBy:"\r\n")[0].split(separator:" ")
        guard fields.count==3,fields[0]=="GET",fields[1].hasPrefix("/auth/callback?"),let uri=redirectURI,pending != nil else{connection.cancel();return}
        let callback=String(uri.dropLast("/auth/callback".count))+String(fields[1])
        let body="<!doctype html><meta name=viewport content=width=device-width><p>Return to Language Study Coach.</p>"
        let response="HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
        connection.send(content:Data(response.utf8),completion:.contentProcessed{_ in connection.cancel()})
        let continuation=pending;pending=nil;cancel();continuation?.resume(returning:callback)
    }
    nonisolated func safariViewControllerDidFinish(_ controller:SFSafariViewController){
        Task{@MainActor [weak self] in self?.cancel()}
    }
}
