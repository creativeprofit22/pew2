use crate::{
    control_codec::Pairing,
    controller::{Controller, Snapshot},
};
use std::sync::{Arc, Mutex};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

pub type Shared = Arc<Mutex<Controller>>;
async fn with_controller<T: Send + 'static>(
    shared: Shared,
    operation: impl FnOnce(&mut Controller) -> Result<T, &'static str> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Repeated clicks are rejected, not queued behind a long startup.
        let mut controller = shared
            .try_lock()
            .map_err(|_| "operation_in_progress".to_owned())?;
        operation(&mut controller).map_err(str::to_owned)
    })
    .await
    .map_err(|_| "controller_failed".to_owned())?
}
#[tauri::command]
pub async fn desktop_start(state: State<'_, Shared>) -> Result<Snapshot, String> {
    with_controller(state.inner().clone(), Controller::start).await
}
#[tauri::command]
pub async fn desktop_status(state: State<'_, Shared>) -> Result<Snapshot, String> {
    with_controller(state.inner().clone(), |controller| Ok(controller.status())).await
}
#[tauri::command]
pub async fn desktop_stop(state: State<'_, Shared>) -> Result<Snapshot, String> {
    with_controller(state.inner().clone(), Controller::stop).await
}
#[tauri::command]
pub async fn desktop_confirm_stop(
    state: State<'_, Shared>,
    instance: String,
    force: bool,
) -> Result<Snapshot, String> {
    if instance.len() > 64 {
        return Err("stale_confirmation".into());
    }
    with_controller(state.inner().clone(), move |controller| {
        controller.confirm_stop(&instance, force)
    })
    .await
}
#[tauri::command]
pub async fn desktop_reveal_pairing(state: State<'_, Shared>) -> Result<Pairing, String> {
    with_controller(state.inner().clone(), Controller::reveal_pairing).await
}
#[tauri::command]
pub async fn desktop_hide_pairing(state: State<'_, Shared>) -> Result<(), String> {
    with_controller(state.inner().clone(), Controller::hide_pairing).await
}
#[tauri::command]
pub async fn desktop_choose_home(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
) -> Result<Snapshot, String> {
    let shared = state.inner().clone();
    with_controller(shared, move |controller| {
        if controller.has_child() {
            return Err("already_running");
        }
        let selected = app
            .dialog()
            .file()
            .set_title("Select your existing pew2 data folder")
            .blocking_pick_folder();
        match selected {
            Some(folder) => {
                controller.select_home(folder.into_path().map_err(|_| "missing_profile")?)
            }
            None => Ok(controller.snapshot()),
        }
    })
    .await
}
#[tauri::command]
pub async fn desktop_finish_close(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
) -> Result<(), String> {
    with_controller(state.inner().clone(), |controller| {
        if controller.has_child() {
            Err("still_running")
        } else {
            Ok(())
        }
    })
    .await?;
    app.exit(0);
    Ok(())
}
