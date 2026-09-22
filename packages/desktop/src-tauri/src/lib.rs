#[cfg(not(all(windows, target_arch = "x86_64")))]
compile_error!("pew2 desktop is supported only on Windows x64 pending independent verification");

mod commands;
mod configuration;
mod control_codec;
mod controller;
mod windows_job;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

fn local_navigation(url: &tauri::Url, development: bool) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    (url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none())
        || (url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none())
        || (development
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1432))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("local-navigation")
                .on_navigation(|_, url| local_navigation(url, cfg!(debug_assertions)))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let preferences = app.path().app_config_dir()?.join("selection.json");
            let executable = std::env::current_exe()?
                .parent()
                .ok_or("launcher directory missing")?
                .join("pew2-daemon.exe");
            app.manage(Arc::new(Mutex::new(controller::Controller::new(
                preferences,
                executable,
            ))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::desktop_start,
            commands::desktop_status,
            commands::desktop_stop,
            commands::desktop_confirm_stop,
            commands::desktop_reveal_pairing,
            commands::desktop_hide_pairing,
            commands::desktop_choose_home,
            commands::desktop_finish_close,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<commands::Shared>();
                let owned = state
                    .try_lock()
                    .map(|mut controller| controller.has_child())
                    .unwrap_or(true);
                if owned {
                    api.prevent_close();
                    let _ = window.emit("desktop-close-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("pew2 desktop runtime failed")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<commands::Shared>();
                if state
                    .try_lock()
                    .map(|mut controller| controller.has_child())
                    .unwrap_or(true)
                {
                    api.prevent_exit();
                    let _ = app.emit("desktop-close-requested", ());
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_is_packaged_only_outside_development() {
        for local in ["http://tauri.localhost/", "tauri://localhost/"] {
            assert!(local_navigation(&tauri::Url::parse(local).unwrap(), false));
        }
        for remote in [
            "https://example.com/",
            "http://tauri.localhost.evil/",
            "http://evil@tauri.localhost/",
            "http://127.0.0.1:1432/",
        ] {
            assert!(!local_navigation(
                &tauri::Url::parse(remote).unwrap(),
                false
            ));
        }
        assert!(local_navigation(
            &tauri::Url::parse("http://127.0.0.1:1432/").unwrap(),
            true
        ));
        assert!(!local_navigation(
            &tauri::Url::parse("http://127.0.0.1:9000/").unwrap(),
            true
        ));
    }
}
