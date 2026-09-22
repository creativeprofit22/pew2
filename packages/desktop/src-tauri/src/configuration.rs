use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, &'static str>;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preferences {
    home: PathBuf,
}

pub fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = File::open(path).map_err(|_| "missing_profile")?;
    if !file.metadata().map_err(|_| "missing_profile")?.is_file() {
        return Err("missing_profile");
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "missing_profile")?;
    if bytes.len() as u64 > limit {
        return Err("missing_profile");
    }
    Ok(bytes)
}

/// Native picker/env/preferences are the only sources; frontend passes no path.
pub fn validate_home(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err("missing_profile");
    }
    let canonical = fs::canonicalize(path).map_err(|_| "missing_profile")?;
    if !canonical.is_dir() {
        return Err("missing_profile");
    }
    let bytes = read_bounded(&canonical.join("pairing.json"), 16 * 1024)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "missing_profile")?;
    let value = value.as_object().ok_or("missing_profile")?;
    if value.get("relay").is_some_and(|v| v.as_str() != Some(""))
        || std::env::var_os("PEW2_RELAY").is_some_and(|v| !v.is_empty())
    {
        return Err("relay_configured");
    }
    let token = value
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or("missing_profile")?;
    let key = value
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or("missing_profile")?;
    if !(32..=1024).contains(&token.len())
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || key.len() != 64
        || !key.bytes().all(|b| b.is_ascii_hexdigit())
        // Match JavaScript string.length, not UTF-8 bytes or Unicode scalars.
        || value.get("claimedBy").is_some_and(|v| {
            v.as_str()
                .is_none_or(|claim| claim.encode_utf16().count() > 256)
        })
    {
        return Err("missing_profile");
    }
    Ok(canonical)
}

pub fn initial_home(preferences: &Path) -> Result<PathBuf> {
    if let Some(home) = std::env::var_os("PEW2_HOME") {
        return validate_home(Path::new(&home));
    }
    if preferences.exists() {
        let saved: Preferences = serde_json::from_slice(&read_bounded(preferences, 32 * 1024)?)
            .map_err(|_| "preferences_invalid")?;
        return validate_home(&saved.home);
    }
    let user = std::env::var_os("USERPROFILE").ok_or("missing_profile")?;
    validate_home(&PathBuf::from(user).join(".pew2"))
}

pub fn workspace() -> Result<PathBuf> {
    let selected = std::env::var_os("PEW2_WORKSPACE")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("workspace_missing")?;
    let path = fs::canonicalize(selected).map_err(|_| "workspace_missing")?;
    if !path.is_dir() || path.parent().is_none() {
        return Err("workspace_missing");
    }
    Ok(path)
}

/// Only nonsecret launcher preferences are replaced; daemon files are read-only.
/// A failed staging write/rename leaves the previous selection intact.
pub fn save_home(preferences: &Path, home: &Path) -> Result<()> {
    let home = validate_home(home)?;
    if preferences.exists() {
        serde_json::from_slice::<Preferences>(&read_bounded(preferences, 32 * 1024)?)
            .map_err(|_| "preferences_invalid")?;
    }
    let parent = preferences.parent().ok_or("preferences_failed")?;
    fs::create_dir_all(parent).map_err(|_| "preferences_failed")?;
    let staging = parent.join(format!("selection-{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(&Preferences { home }).map_err(|_| "preferences_failed")?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(|_| "preferences_failed")?;
    let written = file.write_all(&bytes).and_then(|_| file.sync_all());
    drop(file);
    if written.is_err() || fs::rename(&staging, preferences).is_err() {
        // create_new succeeded above: this invocation owns only this temporary
        // file. Remove it on failure so a corrected permission can be retried.
        let _ = fs::remove_file(&staging);
        return Err("preferences_failed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_atomic_and_does_not_remove_an_unowned_staging_file() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let home = std::env::temp_dir().join(format!(
            "pew2 preference test {}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&home).unwrap();
        fs::write(
            home.join("pairing.json"),
            serde_json::json!({"token": "a".repeat(64), "key": "b".repeat(64)}).to_string(),
        )
        .unwrap();
        let preference = home.join("selection.json");
        save_home(&preference, &home).unwrap();
        let original = fs::read(&preference).unwrap();
        assert!(save_home(&preference, &home.join("missing")).is_err());
        assert_eq!(fs::read(&preference).unwrap(), original);
        let staging = home.join(format!("selection-{}.tmp", std::process::id()));
        fs::write(&staging, "not-owned-by-this-write").unwrap();
        assert!(save_home(&preference, &home).is_err());
        assert_eq!(
            fs::read_to_string(staging).unwrap(),
            "not-owned-by-this-write"
        );
        assert_eq!(fs::read(preference).unwrap(), original);
    }

    #[test]
    fn shared_profile_acceptance_preserves_rejected_selection() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../daemon/src/desktop-control/profile-vectors.json"
        ))
        .unwrap();
        let root = std::env::temp_dir().join(format!(
            "pew2-profile-vectors-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let previous = root.join("previous");
        let candidate = root.join("candidate");
        fs::create_dir_all(&previous).unwrap();
        fs::create_dir(&candidate).unwrap();
        fs::write(previous.join("pairing.json"), vectors["base"].to_string()).unwrap();
        let preferences = root.join("selection.json");
        save_home(&preferences, &previous).unwrap();
        let original = fs::read(&preferences).unwrap();
        for vector in vectors["cases"].as_array().unwrap() {
            let name = vector["name"].as_str().unwrap();
            let mut value = vectors["base"].clone();
            let record = value.as_object_mut().unwrap();
            if let Some(patch) = vector.get("patch") {
                record.extend(patch.as_object().unwrap().clone());
            }
            if let Some(repeat) = vector.get("repeat") {
                record.insert(
                    repeat["field"].as_str().unwrap().into(),
                    (repeat["text"]
                        .as_str()
                        .unwrap()
                        .repeat(repeat["count"].as_u64().unwrap() as usize)
                        + repeat["suffix"].as_str().unwrap_or(""))
                    .into(),
                );
            }
            if let Some(omit) = vector["omit"].as_str() {
                record.remove(omit);
            }
            if let Some(root_value) = vector.get("root") {
                value = root_value.clone();
            }
            let bytes = value.to_string();
            let path = candidate.join("pairing.json");
            fs::write(&path, &bytes).unwrap();
            let expected = vector["expected"].as_str().unwrap();
            let result = validate_home(&candidate);
            if expected == "ok" {
                assert_eq!(
                    result.unwrap(),
                    fs::canonicalize(&candidate).unwrap(),
                    "{name}"
                );
            } else {
                assert_eq!(result, Err(expected), "{name}");
                assert_eq!(save_home(&preferences, &candidate), Err(expected), "{name}");
                assert_eq!(fs::read(&preferences).unwrap(), original, "{name}");
            }
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes, "{name}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_nonexistent_and_relative_profiles_without_creation() {
        assert!(validate_home(Path::new("relative")).is_err());
        let missing = std::env::temp_dir().join(format!("pew2-no-profile-{}", std::process::id()));
        assert!(validate_home(&missing).is_err());
        assert!(!missing.exists());
    }
}
