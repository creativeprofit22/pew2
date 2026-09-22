use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};

pub const VERSION: u8 = 3;
pub const MAX_FRAME: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Busy {
    ActiveTurn,
    PendingApproval,
    OpeningSession,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    Ready,
    Stopping,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Status {
    pub lifecycle: Lifecycle,
    pub bind_address: String,
    pub port: u16,
    /// Live LAN phone sockets after hello proof, excluding CLI watchers and pre-hello sockets.
    pub authenticated_connections: u32,
    pub busy: Option<Busy>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Pairing {
    pub link: String,
    // Only deserialization is compact: the webview still receives booleans.
    #[serde(deserialize_with = "decode_modules")]
    pub modules: Vec<Vec<bool>>,
}
fn decode_modules<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<Vec<bool>>, D::Error> {
    let rows = Vec::<String>::deserialize(deserializer)?;
    let n = rows.len();
    if !(21..=177).contains(&n)
        || !(n - 21).is_multiple_of(4)
        || rows
            .iter()
            .any(|row| row.len() != n || !row.bytes().all(|b| b == b'0' || b == b'1'))
    {
        return Err(serde::de::Error::custom("invalid QR rows"));
    }
    Ok(rows
        .into_iter()
        .map(|row| row.bytes().map(|b| b == b'1').collect())
        .collect())
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Payload {
    Status { status: Status },
    ConfirmationRequired { busy: Busy },
    Pairing { pairing: Pairing },
    Hidden,
    CommandError { code: String },
    Failure { code: String },
}
#[derive(Deserialize, Serialize)]
pub struct Response {
    pub v: u8,
    pub id: String,
    pub instance: String,
    #[serde(flatten)]
    pub payload: Payload,
}

pub fn read_frame(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, &'static str> {
    let mut frame = Vec::with_capacity(1024);
    loop {
        let bytes = reader.fill_buf().map_err(|_| "channel_broken")?;
        if bytes.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err("invalid_frame")
            };
        }
        let end = bytes.iter().position(|b| *b == b'\n');
        let take = end.unwrap_or(bytes.len());
        if frame.len() + take > MAX_FRAME {
            return Err("invalid_frame");
        }
        frame.extend_from_slice(&bytes[..take]);
        reader.consume(take + usize::from(end.is_some()));
        if end.is_some() {
            return Ok(Some(frame));
        }
    }
}

pub fn decode(bytes: &[u8], id: u64, instance: &str) -> Result<Response, &'static str> {
    if bytes.len() > MAX_FRAME {
        return Err("invalid_frame");
    }
    let mut value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "invalid_frame")?;
    let object = value.as_object().ok_or("invalid_frame")?;
    if object.get("v").and_then(|v| v.as_u64()) != Some(VERSION as u64) {
        return Err("protocol_mismatch");
    }
    // A terminal frame belongs to this owned pipe, not a request identity.
    // Validate its exact schema before normalizing to the existing typed failure
    // path. Never accept correlation exceptions on ordinary replies.
    if object.get("type").and_then(|v| v.as_str()) == Some("terminal") {
        if object.len() != 3 || !object.contains_key("code") {
            return Err("invalid_frame");
        }
        value = serde_json::json!({
            "v": VERSION, "id": id.to_string(), "instance": instance,
            "type": "failure", "code": object["code"],
        });
    }
    let object = value.as_object().ok_or("invalid_frame")?;
    let extra = match object.get("type").and_then(|v| v.as_str()) {
        Some("status") => Some("status"),
        Some("confirmation-required") => Some("busy"),
        Some("pairing") => Some("pairing"),
        Some("failure" | "command-error") => Some("code"),
        Some("hidden") => None,
        _ => return Err("invalid_frame"),
    };
    if object.len() != 4 + usize::from(extra.is_some())
        || object.keys().any(|key| {
            !["v", "id", "instance", "type"].contains(&key.as_str()) && Some(key.as_str()) != extra
        })
    {
        return Err("invalid_frame");
    }
    let response: Response = serde_json::from_value(value).map_err(|_| "invalid_frame")?;
    if response.id != id.to_string() || response.instance != instance {
        return Err("protocol_mismatch");
    }
    match &response.payload {
        Payload::Status { status } if status.bind_address != "0.0.0.0" || status.port == 0 => {
            return Err("invalid_frame")
        }
        Payload::Pairing { pairing } => validate_pairing(pairing)?,
        Payload::CommandError { code } if code != "pairing_unavailable" => {
            return Err("invalid_frame")
        }
        Payload::Failure { code }
            if ![
                "protocol_mismatch",
                "invalid_frame",
                "missing_profile",
                "relay_configured",
                "port_unavailable",
                "startup_failed",
                "channel_broken",
                "startup_timeout",
            ]
            .contains(&code.as_str()) =>
        {
            return Err("invalid_frame")
        }
        _ => (),
    }
    Ok(response)
}
fn validate_pairing(pairing: &Pairing) -> Result<(), &'static str> {
    let n = pairing.modules.len();
    if !(21..=177).contains(&n)
        || !(n - 21).is_multiple_of(4)
        || pairing.modules.iter().any(|row| row.len() != n)
        || pairing.link.len() > 4096
    {
        return Err("invalid_frame");
    }
    let url = tauri::Url::parse(&pairing.link).map_err(|_| "invalid_frame")?;
    if url.scheme() != "ws"
        || url
            .host_str()
            .and_then(|s| s.parse::<std::net::Ipv4Addr>().ok())
            .is_none()
        || url.path() != "/"
        || !url.username().is_empty()
        || url.password().is_some()
        || !url
            .query_pairs()
            .any(|(k, v)| k == "token" && v.len() >= 32)
        || !url
            .fragment()
            .is_some_and(|s| s.starts_with("k=") && s.len() == 45)
    {
        return Err("invalid_frame");
    }
    Ok(())
}

pub fn write_request(
    writer: &mut impl Write,
    id: u64,
    instance: &str,
    command: &str,
) -> Result<(), &'static str> {
    if ![
        "hello",
        "status",
        "stop-request",
        "confirm-stop",
        "reveal-pairing",
        "hide-pairing",
    ]
    .contains(&command)
    {
        return Err("invalid_frame");
    }
    let mut bytes = serde_json::to_vec(&serde_json::json!({ "v": VERSION, "id": id.to_string(), "instance": instance, "command": command })).map_err(|_| "invalid_frame")?;
    bytes.push(b'\n');
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|_| "channel_broken")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn bounded_and_complete() {
        assert!(read_frame(&mut Cursor::new(vec![b'x'; MAX_FRAME + 1])).is_err());
        assert!(read_frame(&mut Cursor::new(b"partial")).is_err());
        assert_eq!(
            read_frame(&mut Cursor::new(b"{}\n")).unwrap().unwrap(),
            b"{}"
        );
        let mut exact = vec![b'x'; MAX_FRAME];
        exact.push(b'\n');
        assert_eq!(
            read_frame(&mut Cursor::new(exact)).unwrap().unwrap().len(),
            MAX_FRAME
        );
    }
    #[test]
    fn phone_count_survives_status_decode_and_snapshot_serialization() {
        for count in [0, 1, 2] {
            let frame = serde_json::json!({ "v": VERSION, "id": "1", "instance": "a", "type": "status", "status": {
                "lifecycle": "ready", "bindAddress": "0.0.0.0", "port": 8787,
                "authenticatedConnections": count, "busy": null
            }});
            let response = decode(&serde_json::to_vec(&frame).unwrap(), 1, "a").unwrap();
            let Payload::Status { status } = response.payload else {
                panic!("wrong payload")
            };
            assert_eq!(status.authenticated_connections, count);
            let snapshot = crate::controller::Snapshot {
                lifecycle: "ready",
                instance: Some("a".into()),
                home: None,
                status: Some(status),
                failure: None,
                confirmation: None,
                force_confirmation: false,
                network_exposure: "unverified",
            };
            assert_eq!(
                serde_json::to_value(snapshot).unwrap()["status"]["authenticatedConnections"],
                count
            );
        }
    }
    #[test]
    fn compact_qr_bounds_and_ui_shape() {
        for n in (21..=177).step_by(4) {
            let rows: Vec<String> = (0..n)
                .map(|y| {
                    (0..n)
                        .map(|x| if (x + y) % 2 == 0 { '1' } else { '0' })
                        .collect()
                })
                .collect();
            let frame = serde_json::json!({ "v": VERSION, "id": "1", "instance": "a", "type": "pairing", "pairing": {
                "link": format!("ws://192.168.255.255:65535/?token={}#k={}", "a".repeat(1024), "b".repeat(43)), "modules": rows
            }});
            let bytes = serde_json::to_vec(&frame).unwrap();
            assert!(bytes.len() <= MAX_FRAME);
            let response = decode(&bytes, 1, "a").unwrap();
            let Payload::Pairing { pairing } = response.payload else {
                panic!("wrong payload")
            };
            assert_eq!(pairing.modules.len(), n);
            for (y, row) in pairing.modules.iter().enumerate() {
                for (x, cell) in row.iter().enumerate() {
                    assert_eq!(*cell, (x + y) % 2 == 0);
                }
            }
            assert!(serde_json::to_value(&pairing).unwrap()["modules"][0][0].is_boolean());
        }
    }
    #[test]
    fn rejects_malformed_qr_and_unknown_command_errors() {
        for rows in [
            serde_json::json!(vec!["0".repeat(21); 1]),
            serde_json::json!(vec!["0".repeat(20); 21]),
            serde_json::json!(vec!["x".repeat(21); 21]),
            serde_json::json!(vec!["０".repeat(7); 21]),
            serde_json::json!(vec![vec![false; 21]; 21]),
            serde_json::json!(vec!["0".repeat(181); 181]),
        ] {
            let frame = serde_json::json!({ "v": VERSION, "id": "1", "instance": "a", "type": "pairing", "pairing": { "link": format!("ws://192.168.1.2/?token={}#k={}", "a".repeat(32), "b".repeat(43)), "modules": rows }});
            assert!(decode(&serde_json::to_vec(&frame).unwrap(), 1, "a").is_err());
        }
        for (code, valid) in [
            ("pairing_unavailable", true),
            ("startup_failed", false),
            ("arbitrary", false),
        ] {
            let frame = serde_json::json!({ "v": VERSION, "id": "1", "instance": "a", "type": "command-error", "code": code });
            assert_eq!(
                decode(&serde_json::to_vec(&frame).unwrap(), 1, "a").is_ok(),
                valid
            );
        }
    }
    #[test]
    fn terminal_frames_are_fixed_allowlisted_and_uncorrelated() {
        for code in ["startup_timeout", "protocol_mismatch", "invalid_frame"] {
            let frame = serde_json::json!({ "v": VERSION, "type": "terminal", "code": code });
            let response = decode(&serde_json::to_vec(&frame).unwrap(), 7, "owned").unwrap();
            assert!(
                matches!(response.payload, Payload::Failure { code: actual } if actual == code)
            );
        }
        for frame in [
            serde_json::json!({ "v": VERSION, "type": "terminal", "code": "arbitrary" }),
            serde_json::json!({ "v": VERSION, "type": "terminal", "code": 5 }),
            serde_json::json!({ "v": VERSION, "type": "terminal", "code": "protocol_mismatch", "id": "1" }),
            serde_json::json!({ "v": VERSION, "type": "terminal", "code": "protocol_mismatch", "secret": "do-not-echo" }),
        ] {
            assert!(matches!(
                decode(&serde_json::to_vec(&frame).unwrap(), 1, "a"),
                Err("invalid_frame")
            ));
        }
    }
    #[test]
    fn rejects_unknown_mismatched_and_late_frames() {
        let good = br#"{"v":3,"id":"1","instance":"a","type":"hidden"}"#;
        assert!(decode(good, 1, "a").is_ok());
        assert!(decode(good, 2, "a").is_err());
        assert!(decode(good, 1, "b").is_err());
        assert!(decode(
            br#"{"v":1,"id":"1","instance":"a","type":"hidden"}"#,
            1,
            "a"
        )
        .is_err());
        assert!(decode(
            br#"{"v":3,"id":"1","instance":"a","type":"hidden","extra":true}"#,
            1,
            "a"
        )
        .is_err());
        assert!(decode(&[255], 1, "a").is_err());
    }
}
