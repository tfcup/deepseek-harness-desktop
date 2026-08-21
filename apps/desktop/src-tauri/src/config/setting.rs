use super::constants::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Setting {
    pub installed: bool,
    pub port: u16,
    pub language: String,
}

impl Default for Setting {
    fn default() -> Self {
        Self {
            installed: false,
            port: DSH_PORT,
            language: "zh-CN".to_string(),
        }
    }
}

pub fn set_store_dat_setting(app_handle: &AppHandle, setting: Setting) {
    let store = app_handle
        .store(crate::config::get_base_dir(app_handle).join(STORE_DAT_FILE))
        .expect("Failed to load store");
    store.set(STORE_SETTING_KEY, serde_json::to_value(&setting).unwrap());
    store.save().expect("Failed to save store");
    app_handle
        .emit("setting_updated", &serde_json::to_value(&setting).unwrap())
        .expect("Failed to emit event");
}

pub fn get_store_dat_setting(app_handle: &AppHandle) -> Setting {
    let store = app_handle
        .store(crate::config::get_base_dir(app_handle).join(STORE_DAT_FILE))
        .expect("Failed to load store");
    let raw = store.get(STORE_SETTING_KEY);
    let value = raw.as_ref().and_then(|v| {
        v.as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .or_else(|| Some(v.clone()))
    });
    value
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(Setting::default)
}
