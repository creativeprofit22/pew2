fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_start",
            "desktop_status",
            "desktop_stop",
            "desktop_confirm_stop",
            "desktop_reveal_pairing",
            "desktop_hide_pairing",
            "desktop_choose_home",
            "desktop_finish_close",
        ]),
    ))
    .expect("desktop permission manifest failed");
}
