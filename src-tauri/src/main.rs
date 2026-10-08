#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;
struct PendingRequest {
    pending: Pending,
    id: String,
}
impl PendingRequest {
    fn register(
        pending: &Pending,
        connected: &AtomicBool,
        id: String,
    ) -> Result<(Self, oneshot::Receiver<Result<Value, String>>), String> {
        let mut callbacks = pending.lock().map_err(|e| e.to_string())?;
        if !connected.load(Ordering::SeqCst) {
            return Err("Pi SDK 后台连接已关闭".into());
        }
        let (send, receive) = oneshot::channel();
        callbacks.insert(id.clone(), send);
        Ok((
            Self {
                pending: pending.clone(),
                id,
            },
            receive,
        ))
    }
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        if let Ok(mut callbacks) = self.pending.lock() {
            callbacks.remove(&self.id);
        }
    }
}
fn close_requests(pending: &Pending, connected: &AtomicBool) {
    let mut callbacks = pending.lock().unwrap();
    // Registration and closure share the lock, so a late caller cannot miss
    // the disconnect drain and wait until the normal request timeout.
    connected.store(false, Ordering::SeqCst);
    for (_, callback) in callbacks.drain() {
        let _ = callback.send(Err("Pi SDK 后台已退出".into()));
    }
}
fn external_protocol_url(value: &str) -> Result<String, String> {
    if value.chars().any(|c| c <= ' ' || c == '\u{7f}') {
        return Err("链接包含无效字符".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "无效的协议链接".to_owned())?;
    if matches!(
        url.scheme(),
        "javascript"
            | "vbscript"
            | "data"
            | "blob"
            | "about"
            | "file"
            | "http"
            | "https"
            | "mailto"
            | "tel"
    ) || value.len() <= url.scheme().len() + 1
        || (url.scheme().len() == 1
            && value
                .as_bytes()
                .get(2)
                .is_some_and(|c| *c == b'/' || *c == b'\\'))
    {
        return Err("链接协议不受支持".into());
    }
    Ok(url.to_string())
}

#[tauri::command]
async fn open_external_protocol(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = external_protocol_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod protocol_tests {
    use super::external_protocol_url;
    #[test]
    fn disconnect_rejects_pending_and_future_requests() {
        let pending: super::Pending = Default::default();
        let connected = super::AtomicBool::new(true);
        let (_request, mut receive) =
            super::PendingRequest::register(&pending, &connected, "1".into()).unwrap();
        super::close_requests(&pending, &connected);
        assert!(receive.try_recv().unwrap().is_err());
        assert!(super::PendingRequest::register(&pending, &connected, "2".into()).is_err());
        assert!(pending.lock().unwrap().is_empty());
    }
    #[test]
    fn abandoned_request_releases_its_callback() {
        let pending: super::Pending = Default::default();
        let connected = super::AtomicBool::new(true);
        let (request, mut receive) =
            super::PendingRequest::register(&pending, &connected, "1".into()).unwrap();
        drop(request);
        assert!(receive.try_recv().is_err());
        assert!(pending.lock().unwrap().is_empty());
    }
    #[test]
    fn authenticated_channel_reads_packets_arriving_after_handshake() {
        use std::{
            io::{Read, Write},
            net::{TcpListener, TcpStream},
            time::Duration,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let token = "12345678901234567890123456789012";
        client.write_all(format!("{token}\n").as_bytes()).unwrap();
        let (server, _) = listener.accept().unwrap();
        let mut server = super::authenticate_channel(server, token).unwrap().unwrap();
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            client.write_all(b"packet\n").unwrap();
        });
        let mut packet = [0u8; 7];
        let result = server.read_exact(&mut packet);
        writer.join().unwrap();
        result.unwrap();
        assert_eq!(&packet, b"packet\n");
    }
    #[test]
    fn accepts_external_protocols_and_rejects_content_and_paths() {
        for value in [
            "vscode://file/C:/work/a.ts:12:3",
            "obsidian://open?vault=Notes&file=hello%20world",
            "pi-test:open?id=1",
            "PI-TEST:open",
        ] {
            assert!(external_protocol_url(value).is_ok(), "{value}");
        }
        for value in [
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "data:text/html,hi",
            "vbscript:msgbox(1)",
            "blob:https://example.com/id",
            "about:blank",
            "file:///C:/a.exe",
            "C:/a.exe",
            "C:\\a.exe",
            "pi-test:",
            "pi-test:open\n",
            "/relative",
            "//example.com",
            "https://example.com",
        ] {
            assert!(external_protocol_url(value).is_err(), "{value}");
        }
    }
}
struct Backend {
    stdin: Mutex<TcpStream>,
    child: Mutex<Child>,
    pending: Pending,
    connected: Arc<AtomicBool>,
    sequence: Mutex<u64>,
    shutdown_requested: AtomicBool,
}

#[tauri::command]
async fn sdk_action(
    backend: tauri::State<'_, Backend>,
    action: String,
    args: Value,
) -> Result<Value, String> {
    let id = {
        let mut sequence = backend.sequence.lock().map_err(|e| e.to_string())?;
        *sequence += 1;
        sequence.to_string()
    };
    let (_request, receive) =
        PendingRequest::register(&backend.pending, &backend.connected, id.clone())?;
    let record = json!({ "id": id, "action": action, "args": args });
    let write = (|| {
        let mut stdin = backend.stdin.lock().map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", record)
            .and_then(|_| stdin.flush())
            .map_err(|e| e.to_string())
    })();
    if let Err(error) = write {
        return Err(error);
    }
    match tokio::time::timeout(Duration::from_secs(600), receive).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Pi SDK 后台连接已关闭".into()),
        Err(_) => Err("操作超时".into()),
    }
}

fn launch(app: &tauri::AppHandle) -> Result<Backend, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let mut command = if cfg!(debug_assertions) {
        let mut c = Command::new("node");
        c.current_dir(root)
            .args(["--import", "tsx", "backend/server.ts", "--desktop-channel"]);
        c
    } else {
        let runtime = app.path().resource_dir()?.join("runtime");
        let mut c = Command::new(runtime.join(if cfg!(windows) { "node.exe" } else { "node" }));
        c.current_dir(&runtime)
            .arg("server.mjs")
            .arg("--desktop-channel");
        c
    };
    command
        .env(
            "PI_DESKTOP_CHANNEL_PORT",
            listener.local_addr()?.port().to_string(),
        )
        .env("PI_DESKTOP_CHANNEL_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Missing SDK stdout")?;
    let stderr = child.stderr.take().ok_or("Missing SDK stderr")?;
    // Drain output before channel authentication, so noisy startup cannot block
    // the backend on a full pipe. Neither stream is interpreted as protocol.
    let log_path = app.path().app_log_dir()?.join("sdk.log");
    for source in [Box::new(stdout) as Box<dyn Read + Send>, Box::new(stderr)] {
        let path = log_path.clone();
        std::thread::spawn(move || {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
            {
                let _ = std::io::copy(&mut { source }, &mut file);
            } else {
                let _ = std::io::copy(&mut { source }, &mut std::io::sink());
            }
        });
    }
    let channel = accept_channel(&listener, &token, &mut child);
    let stdin = match channel {
        Ok(channel) => channel,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.into());
        }
    };
    let stdout = stdin.try_clone()?;
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let callbacks = pending.clone();
    let connected = Arc::new(AtomicBool::new(true));
    let reader_connected = connected.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut clean_shutdown = false;
        let mut requested_exit = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if let Some(event) = value.get("event") {
                    let _ = handle.emit("pi:event", event);
                    if event.get("type").and_then(Value::as_str) == Some("shutdown") {
                        clean_shutdown = true;
                        requested_exit =
                            Some(event.get("exitCode").and_then(Value::as_i64).unwrap_or(0) as i32);
                    }
                }
                if let Some(id) = value.get("id").and_then(Value::as_str) {
                    if id == "shutdown" && value.get("error").is_none() {
                        clean_shutdown = true;
                    }
                    if let Some(callback) = callbacks.lock().unwrap().remove(id) {
                        let result = match value.get("error").and_then(Value::as_str) {
                            Some(error) => Err(error.to_owned()),
                            None => Ok(value.get("data").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = callback.send(result);
                    }
                }
            }
        }
        close_requests(&callbacks, &reader_connected);
        if let Some(code) = requested_exit {
            handle.exit(code);
        } else if !clean_shutdown {
            let _ = handle.emit("pi:event", json!({"type":"notice", "level":"error", "message":"Pi SDK 后台已退出，请重新打开应用"}));
        }
    });
    Ok(Backend {
        stdin: Mutex::new(stdin),
        child: Mutex::new(child),
        pending,
        connected,
        sequence: Mutex::new(0),
        shutdown_requested: AtomicBool::new(false),
    })
}
fn accept_channel(
    listener: &TcpListener,
    token: &str,
    child: &mut Child,
) -> std::io::Result<TcpStream> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if child.try_wait()?.is_some() {
            return Err(std::io::Error::other(
                "SDK exited before channel connection",
            ));
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(stream) = authenticate_channel(stream, token)? {
                    return Ok(stream);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "SDK channel connection timed out",
    ))
}
fn authenticate_channel(mut stream: TcpStream, token: &str) -> std::io::Result<Option<TcpStream>> {
    // Windows accepts inherit the listener's nonblocking mode. The reader
    // thread must wait for future packets rather than interpreting WouldBlock
    // as EOF between the handshake and the first SDK command.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    let mut handshake = [0u8; 33];
    if stream.read_exact(&mut handshake).is_ok()
        && handshake[..32] == *token.as_bytes()
        && handshake[32] == b'\n'
    {
        stream.set_read_timeout(None)?;
        stream.set_nodelay(true)?;
        Ok(Some(stream))
    } else {
        Ok(None)
    }
}
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let backend = launch(app.handle())?;
            app.manage(backend);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sdk_action, open_external_protocol])
        .build(tauri::generate_context!())
        .expect("Failed to start Pi Desktop");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
        {
            api.prevent_exit();
            let backend = app.state::<Backend>();
            if !backend.shutdown_requested.swap(true, Ordering::SeqCst) {
                let handle = app.clone();
                std::thread::spawn(move || {
                    let backend = handle.state::<Backend>();
                    let request = {
                        let mut stdin = backend.stdin.lock().unwrap();
                        writeln!(stdin, "{}", json!({"id":"shutdown", "action":"shutdown"}))
                            .and_then(|_| stdin.flush())
                    };
                    let code = {
                        let mut child = backend.child.lock().unwrap();
                        if request.is_err() {
                            // The backend cannot accept cleanup when its input
                            // pipe is broken. Do not leave that child orphaned.
                            let _ = child.kill();
                            let _ = child.wait();
                            1
                        } else {
                            child
                                .wait()
                                .ok()
                                .and_then(|status| status.code())
                                .unwrap_or(1)
                        }
                    };
                    handle.exit(code);
                });
            }
        }
        if let tauri::RunEvent::Exit = event {
            let backend = app.state::<Backend>();
            let _ = writeln!(
                backend.stdin.lock().unwrap(),
                "{}",
                json!({"id":"shutdown", "action":"shutdown"})
            );
            let mut child = backend.child.lock().unwrap();
            for _ in 0..30 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    });
}
