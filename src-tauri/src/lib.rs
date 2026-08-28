mod meeting_core;

use meeting_core::CoreManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(CoreManager::default())
        .invoke_handler(tauri::generate_handler![
            meeting_core::core_status,
            meeting_core::list_audio_devices,
            meeting_core::start_recording,
            meeting_core::set_recording_paused,
            meeting_core::stop_recording,
            meeting_core::list_people,
            meeting_core::save_person,
            meeting_core::delete_person,
            meeting_core::start_voice_enrollment,
            meeting_core::stop_voice_enrollment,
            meeting_core::upload_voice_sample,
        ])
        .setup(|app| {
            if let Ok(resources) = app.path().resource_dir() {
                let core_home = resources.join("meeting-core");
                if core_home.join("weights").is_dir() {
                    std::env::set_var("MEETING_CORE_HOME", core_home);
                }
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
