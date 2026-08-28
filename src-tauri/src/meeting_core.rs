use meeting_core_rust::{
    initialize_runtime,
    pipeline::{self, Config, PipelineControl, Source},
    run_id, Record,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Default)]
pub struct CoreManager {
    inner: Arc<Mutex<Session>>,
}

#[derive(Default)]
struct Session {
    active: bool,
    paused: bool,
    device: Option<String>,
    output: Option<PathBuf>,
    error: Option<String>,
    control: Option<PipelineControl>,
    enrollment: Option<PipelineControl>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    active: bool,
    paused: bool,
    device: Option<String>,
    output: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    id: String,
    label: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    id: String,
    name: String,
    role: String,
    location: String,
    voice_ready: bool,
    sample_seconds: f32,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonInput {
    id: Option<String>,
    name: String,
    role: String,
    location: String,
}

impl Session {
    fn status(&self) -> CoreStatus {
        CoreStatus {
            active: self.active,
            paused: self.paused,
            device: self.device.clone(),
            output: self.output.as_ref().map(|path| path.display().to_string()),
            error: self.error.clone(),
        }
    }
}

fn lock(manager: &CoreManager) -> Result<std::sync::MutexGuard<'_, Session>, String> {
    manager
        .inner
        .lock()
        .map_err(|_| "Meeting core state is unavailable".to_owned())
}

#[tauri::command]
pub fn core_status(manager: State<'_, CoreManager>) -> Result<CoreStatus, String> {
    Ok(lock(manager.inner())?.status())
}

#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .output()
        .map_err(|error| format!("Không tìm thấy FFmpeg: {error}"))?;
    let diagnostics = String::from_utf8_lossy(&output.stderr);
    let mut devices = Vec::new();
    for line in diagnostics.lines().filter(|line| line.contains("(audio)")) {
        if let Some(start) = line.find('"') {
            if let Some(end) = line[start + 1..].find('"') {
                let name = line[start + 1..start + 1 + end].to_owned();
                if !devices.iter().any(|device: &AudioDevice| device.id == name) {
                    devices.push(AudioDevice {
                        id: name.clone(),
                        label: name,
                    });
                }
            }
        }
    }
    if devices.is_empty() {
        return Err("FFmpeg không tìm thấy thiết bị thu âm DirectShow".to_owned());
    }
    Ok(devices)
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    manager: State<'_, CoreManager>,
    device: Option<String>,
    profiles_path: Option<String>,
    stt_api: Option<bool>,
) -> Result<CoreStatus, String> {
    initialize_runtime().map_err(|error| format!("Khởi tạo core thất bại: {error:#}"))?;
    let manager = manager.inner().clone();
    {
        let session = lock(&manager)?;
        if session.active {
            return Ok(session.status());
        }
    }

    let selected_device = match device {
        Some(device) => device,
        None => list_audio_devices()?.remove(0).id,
    };
    let profiles_path = resolve_profiles_path(&app, profiles_path)?;
    let profiles = pipeline::load_profiles(&profiles_path).map_err(|error| {
        format!(
            "Không thể đọc hồ sơ giọng nói {}: {error:#}",
            profiles_path.display()
        )
    })?;
    let output = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("runs")
        .join(run_id());
    let control = PipelineControl::new();
    let config = Config {
        source: Source::Microphone(selected_device.clone()),
        profiles,
        output: output.clone(),
        speed: 1.0,
        stt_api: stt_api.unwrap_or(false),
        ground_truth: None,
    };

    let initial = {
        let mut session = lock(&manager)?;
        session.active = true;
        session.paused = false;
        session.device = Some(selected_device);
        session.output = Some(output);
        session.error = None;
        session.control = Some(control.clone());
        session.status()
    };

    let (event_tx, event_rx) = std::sync::mpsc::channel::<Record>();
    let event_app = app.clone();
    std::thread::spawn(move || {
        for record in event_rx {
            let _ = event_app.emit("meeting://record", record);
        }
    });

    let done_app = app.clone();
    let done_manager = manager.clone();
    std::thread::spawn(move || {
        let result = pipeline::run_controlled(config, control, Some(event_tx));
        let status = match lock(&done_manager) {
            Ok(mut session) => {
                session.active = false;
                session.paused = false;
                session.control = None;
                session.error = result.err().map(|error| format!("{error:#}"));
                session.status()
            }
            Err(error) => CoreStatus {
                active: false,
                paused: false,
                device: None,
                output: None,
                error: Some(error),
            },
        };
        let _ = done_app.emit("meeting://status", status);
    });

    let _ = app.emit("meeting://status", initial.clone());
    Ok(initial)
}

#[tauri::command]
pub fn set_recording_paused(
    paused: bool,
    manager: State<'_, CoreManager>,
) -> Result<CoreStatus, String> {
    let status = {
        let mut session = lock(manager.inner())?;
        if !session.active {
            return Err("Không có phiên ghi âm đang hoạt động".to_owned());
        }
        if let Some(control) = &session.control {
            control.set_paused(paused);
        }
        session.paused = paused;
        session.status()
    };
    Ok(status)
}

#[tauri::command]
pub fn stop_recording(manager: State<'_, CoreManager>) -> Result<CoreStatus, String> {
    let mut session = lock(manager.inner())?;
    if let Some(control) = &session.control {
        control.stop();
    }
    session.paused = false;
    Ok(session.status())
}

#[tauri::command]
pub fn list_people(app: AppHandle) -> Result<Vec<Person>, String> {
    load_people(&app)
}

#[tauri::command]
pub fn save_person(app: AppHandle, person: PersonInput) -> Result<Person, String> {
    let name = person.name.trim();
    if name.is_empty() {
        return Err("Tên không được để trống".to_owned());
    }
    let mut people = load_people(&app)?;
    if people.iter().any(|item| {
        item.name.eq_ignore_ascii_case(name) && person.id.as_deref() != Some(item.id.as_str())
    }) {
        return Err("Tên này đã được dùng cho một hồ sơ khác".to_owned());
    }
    let now = unix_time();
    let saved = if let Some(id) = person.id {
        let item = people
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or("Không tìm thấy hồ sơ")?;
        item.name = name.to_owned();
        item.role = person.role.trim().to_owned();
        item.location = person.location.trim().to_owned();
        item.updated_at = now;
        item.clone()
    } else {
        let item = Person {
            id: format!("person-{now}-{}", people.len() + 1),
            name: name.to_owned(),
            role: person.role.trim().to_owned(),
            location: person.location.trim().to_owned(),
            voice_ready: false,
            sample_seconds: 0.0,
            updated_at: now,
        };
        people.push(item.clone());
        item
    };
    save_people(&app, &people)?;
    rebuild_profiles(&app, &people)?;
    Ok(saved)
}

#[tauri::command]
pub fn delete_person(app: AppHandle, id: String) -> Result<(), String> {
    let mut people = load_people(&app)?;
    people.retain(|person| person.id != id);
    let audio = people_root(&app)?.join("audio").join(format!("{id}.wav"));
    let _ = std::fs::remove_file(audio);
    save_people(&app, &people)?;
    rebuild_profiles(&app, &people)
}

#[tauri::command]
pub fn start_voice_enrollment(
    app: AppHandle,
    manager: State<'_, CoreManager>,
    person_id: String,
    device: Option<String>,
) -> Result<(), String> {
    initialize_runtime().map_err(|error| format!("Khởi tạo core thất bại: {error:#}"))?;
    if !load_people(&app)?
        .iter()
        .any(|person| person.id == person_id)
    {
        return Err("Không tìm thấy hồ sơ".to_owned());
    }
    let manager = manager.inner().clone();
    let control = {
        let mut session = lock(&manager)?;
        if session.active || session.enrollment.is_some() {
            return Err("Một phiên thu âm khác đang hoạt động".to_owned());
        }
        let control = PipelineControl::new();
        session.enrollment = Some(control.clone());
        control
    };
    let selected = match device {
        Some(value) => value,
        None => list_audio_devices()?.remove(0).id,
    };
    let output = people_root(&app)?
        .join("audio")
        .join(format!("{person_id}.wav"));
    let (level_tx, level_rx) = std::sync::mpsc::channel();
    let level_app = app.clone();
    std::thread::spawn(move || {
        for level in level_rx {
            let _ = level_app.emit("voice://level", level);
        }
    });
    let done_app = app.clone();
    let done_manager = manager.clone();
    std::thread::spawn(move || {
        let result = meeting_core_rust::enrollment::record_microphone(
            selected,
            &output,
            control,
            Some(level_tx),
        );
        if let Ok(mut session) = lock(&done_manager) {
            session.enrollment = None;
        }
        let payload = match result {
            Ok(seconds) => mark_voice_ready(&done_app, &person_id, seconds)
                .map(|person| serde_json::json!({ "person": person })),
            Err(error) => Err(format!("{error:#}")),
        };
        let event = match payload {
            Ok(value) => value,
            Err(error) => serde_json::json!({ "error": error }),
        };
        let _ = done_app.emit("voice://enrollment-finished", event);
    });
    Ok(())
}

#[tauri::command]
pub fn stop_voice_enrollment(manager: State<'_, CoreManager>) -> Result<(), String> {
    let session = lock(manager.inner())?;
    if let Some(control) = &session.enrollment {
        control.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn upload_voice_sample(
    app: AppHandle,
    person_id: String,
    file_path: String,
) -> Result<Person, String> {
    if !load_people(&app)?
        .iter()
        .any(|person| person.id == person_id)
    {
        return Err("Không tìm thấy hồ sơ".to_owned());
    }
    let source = Path::new(&file_path);
    if !source.is_file() {
        return Err("File không tồn tại".to_owned());
    }
    let audio = meeting_core_rust::decode_audio(source)
        .map_err(|error| format!("Không thể đọc file âm thanh: {error:#}"))?;
    let seconds = audio.len() as f32 / 16_000.0;
    if seconds < 1.0 {
        return Err("File quá ngắn, cần ít nhất 1 giây âm thanh".to_owned());
    }
    let output = people_root(&app)?
        .join("audio")
        .join(format!("{person_id}.wav"));
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    meeting_core_rust::write_wav(&output, &audio)
        .map_err(|error| format!("Không thể ghi file: {error:#}"))?;
    mark_voice_ready(&app, &person_id, seconds)
}

fn resolve_profiles_path(app: &AppHandle, explicit: Option<String>) -> Result<PathBuf, String> {
    let local = people_root(app)?.join("profiles.json");
    let candidates = [
        explicit.map(PathBuf::from),
        std::env::var_os("MEETING_PROFILES_PATH").map(PathBuf::from),
        Some(local),
        Some(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../meeting_script_30m_5speakers_omnivoice/profiles.json"),
        ),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| profile_file_has_entries(path))
        .ok_or_else(|| {
            "Không tìm thấy profiles.json; đặt biến MEETING_PROFILES_PATH hoặc truyền profilesPath"
                .to_owned()
        })
}

fn profile_file_has_entries(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| {
            serde_json::from_slice::<std::collections::BTreeMap<String, PathBuf>>(&bytes).ok()
        })
        .is_some_and(|profiles| !profiles.is_empty())
}

fn people_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("voice_profiles"))
}

fn load_people(app: &AppHandle) -> Result<Vec<Person>, String> {
    let path = people_root(app)?.join("people.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn save_people(app: &AppHandle, people: &[Person]) -> Result<(), String> {
    let root = people_root(app)?;
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    std::fs::write(
        root.join("people.json"),
        serde_json::to_vec_pretty(people).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn rebuild_profiles(app: &AppHandle, people: &[Person]) -> Result<(), String> {
    let root = people_root(app)?;
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let profiles: std::collections::BTreeMap<_, _> = people
        .iter()
        .filter(|person| person.voice_ready)
        .map(|person| {
            (
                person.name.clone(),
                root.join("audio").join(format!("{}.wav", person.id)),
            )
        })
        .collect();
    std::fs::write(
        root.join("profiles.json"),
        serde_json::to_vec_pretty(&profiles).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn mark_voice_ready(app: &AppHandle, id: &str, seconds: f32) -> Result<Person, String> {
    let mut people = load_people(app)?;
    let person = people
        .iter_mut()
        .find(|person| person.id == id)
        .ok_or("Không tìm thấy hồ sơ")?;
    person.voice_ready = seconds >= 5.0;
    person.sample_seconds = seconds;
    person.updated_at = unix_time();
    let result = person.clone();
    save_people(app, &people)?;
    rebuild_profiles(app, &people)?;
    Ok(result)
}

fn unix_time() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
