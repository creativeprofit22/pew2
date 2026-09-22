use crate::{
    configuration,
    control_codec::{self, Busy, Pairing, Payload, Status},
    windows_job::{self, OwnedProcess},
};
use serde::Serialize;
use std::{
    fs::File,
    io::{BufReader, Read},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, Receiver, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static GENERATION: AtomicU64 = AtomicU64::new(0);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub lifecycle: &'static str,
    pub instance: Option<String>,
    pub home: Option<String>,
    pub status: Option<Status>,
    pub failure: Option<String>,
    pub confirmation: Option<Busy>,
    pub force_confirmation: bool,
    pub network_exposure: &'static str,
}
struct Child {
    owned: OwnedProcess,
    input: Option<File>,
    frames: Receiver<Result<Vec<u8>, &'static str>>,
    readers: Vec<thread::JoinHandle<()>>,
    instance: String,
    request_id: u64,
}
impl Child {
    fn request(&mut self, command: &str) -> Result<Payload, &'static str> {
        self.request_id += 1;
        control_codec::write_request(
            self.input.as_mut().ok_or("channel_broken")?,
            self.request_id,
            &self.instance,
            command,
        )?;
        let timeout = Duration::from_secs(if command == "hello" { 30 } else { 5 });
        self.receive(command, timeout)
    }
    fn receive(&mut self, command: &str, timeout: Duration) -> Result<Payload, &'static str> {
        // Native is the sole hello deadline owner. EOF is not a timeout.
        let frame = self
            .frames
            .recv_timeout(timeout)
            .map_err(|error| match error {
                RecvTimeoutError::Timeout if command == "hello" => "startup_timeout",
                RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected => "channel_broken",
            })??;
        let response = control_codec::decode(&frame, self.request_id, &self.instance)?;
        let matches = matches!(
            (command, &response.payload),
            ("hello" | "status", Payload::Status { .. })
                | (
                    "stop-request",
                    Payload::Status { .. } | Payload::ConfirmationRequired { .. }
                )
                | ("confirm-stop", Payload::Status { .. })
                | (
                    "reveal-pairing",
                    Payload::Pairing { .. } | Payload::CommandError { .. }
                )
                | ("hide-pairing", Payload::Hidden)
                | (_, Payload::Failure { .. })
        );
        if !matches {
            return Err("invalid_frame");
        }
        Ok(response.payload)
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        // Controller drops only exited children or explicitly force-approved jobs.
        // Drop receiver before joins so a blocked bounded send can finish.
        self.input.take();
        let (_, empty) = sync_channel(1);
        let previous = std::mem::replace(&mut self.frames, empty);
        drop(previous);
        for reader in self.readers.drain(..) {
            // Never block the window on a provider that retained a pipe handle.
            if reader.is_finished() {
                let _ = reader.join();
            }
        }
    }
}

pub struct Controller {
    child: Option<Child>,
    home: Option<PathBuf>,
    preferences: PathBuf,
    executable: PathBuf,
    state: Snapshot,
    stopping_since: Option<Instant>,
    forced_stop: bool,
}
impl Controller {
    pub fn new(preferences: PathBuf, executable: PathBuf) -> Self {
        let selected = configuration::initial_home(&preferences);
        let (home, failure) = match selected {
            Ok(home) => (Some(home), None),
            Err(error) => (None, Some(error.to_owned())),
        };
        let state = Snapshot {
            lifecycle: "stopped",
            instance: None,
            home: home.as_ref().map(|p| p.display().to_string()),
            status: None,
            failure,
            confirmation: None,
            force_confirmation: false,
            network_exposure: "unverified",
        };
        Self {
            child: None,
            home,
            preferences,
            executable,
            state,
            stopping_since: None,
            forced_stop: false,
        }
    }
    pub fn snapshot(&mut self) -> Snapshot {
        self.reap();
        self.state.clone()
    }
    pub fn has_child(&mut self) -> bool {
        self.reap();
        self.child.is_some()
    }
    fn reap(&mut self) {
        if self.child.is_some()
            && self
                .stopping_since
                .is_some_and(|since| since.elapsed() > Duration::from_secs(5))
        {
            self.state.force_confirmation = true;
            self.state.failure = Some("shutdown_timeout".into());
        }
        let exited = self
            .child
            .as_ref()
            .and_then(|c| c.owned.exited().ok().flatten());
        if let Some(code) = exited {
            self.child.take();
            self.stopping_since = None;
            let expected = self.state.lifecycle == "stopping" && (code == 0 || self.forced_stop);
            self.forced_stop = false;
            self.state.lifecycle = if expected { "stopped" } else { "failed" };
            if expected {
                self.state.failure = None;
            }
            if !expected && self.state.failure.is_none() {
                self.state.failure = Some("unexpected_exit".into());
            }
            self.state.status = None;
            self.state.confirmation = None;
            self.state.force_confirmation = false;
            self.state.instance = None;
        }
    }
    pub fn select_home(&mut self, home: PathBuf) -> Result<Snapshot, &'static str> {
        if self.has_child() {
            return Err("already_running");
        }
        let home = configuration::validate_home(&home)?;
        configuration::save_home(&self.preferences, &home)?;
        self.state.home = Some(home.display().to_string());
        self.state.failure = None;
        self.home = Some(home);
        Ok(self.snapshot())
    }
    pub fn start(&mut self) -> Result<Snapshot, &'static str> {
        if self.has_child() {
            return Err("already_running");
        }
        let home = configuration::validate_home(self.home.as_deref().ok_or("missing_profile")?)?;
        let workspace = configuration::workspace()?;
        let launched = windows_job::launch(&self.executable, &home, &workspace)?;
        let instance = format!(
            "{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "clock_failed")?
                .as_nanos(),
            GENERATION.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = sync_channel(1);
        let stdout = thread::spawn(move || {
            let mut reader = BufReader::new(launched.stdout);
            loop {
                let frame = match control_codec::read_frame(&mut reader) {
                    Ok(Some(frame)) => Ok(frame),
                    Ok(None) => Err("channel_broken"),
                    Err(error) => Err(error),
                };
                let ended = frame.is_err();
                if sender.send(frame).is_err() || ended {
                    break;
                }
            }
        });
        let stderr = thread::spawn(move || {
            let mut reader = launched.stderr;
            let mut buffer = [0u8; 4096];
            // Arbitrary daemon/provider output is deliberately discarded rather
            // than retained as a potential credential-bearing diagnostic log.
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 {
                    break;
                }
            }
        });
        self.child = Some(Child {
            owned: launched.owned,
            input: Some(launched.stdin),
            frames: receiver,
            readers: vec![stdout, stderr],
            instance: instance.clone(),
            request_id: 0,
        });
        self.state.instance = Some(instance);
        self.state.lifecycle = "starting";
        self.stopping_since = None;
        self.forced_stop = false;
        self.state.failure = None;
        self.state.status = None;
        self.state.confirmation = None;
        self.state.force_confirmation = false;
        self.action("hello")?;
        Ok(self.snapshot())
    }
    fn action(&mut self, command: &str) -> Result<Option<Pairing>, &'static str> {
        let result = self.child.as_mut().ok_or("not_running")?.request(command);
        self.apply_response(command, result)
    }
    fn apply_response(
        &mut self,
        command: &str,
        result: Result<Payload, &'static str>,
    ) -> Result<Option<Pairing>, &'static str> {
        match result {
            Ok(Payload::Status { status }) => {
                self.state.lifecycle = if status.lifecycle == control_codec::Lifecycle::Stopping {
                    "stopping"
                } else {
                    "ready"
                };
                if status.lifecycle == control_codec::Lifecycle::Stopping {
                    self.stopping_since = Some(Instant::now());
                }
                self.state.status = Some(status);
                if command != "status" {
                    self.state.confirmation = None;
                }
                Ok(None)
            }
            Ok(Payload::ConfirmationRequired { busy }) => {
                self.state.confirmation = Some(busy);
                Ok(None)
            }
            Ok(Payload::Pairing { pairing }) => Ok(Some(pairing)),
            Ok(Payload::Hidden) => Ok(None),
            // A failed reveal is not a failed daemon. Keep ownership, status,
            // pending stop confirmation and the control pipe unchanged.
            Ok(Payload::CommandError { .. }) => Err("pairing_unavailable"),
            Ok(Payload::Failure { code }) => {
                self.state.failure = Some(code);
                self.state.lifecycle = "failed";
                self.state.force_confirmation = true;
                // Terminal failures request the same EOF cleanup as receive errors.
                self.child.as_mut().unwrap().input.take();
                Err("daemon_failed")
            }
            Err(error) => {
                self.state.failure = Some(error.into());
                self.state.lifecycle = "failed";
                self.state.force_confirmation = true;
                // EOF asks the daemon to clean up. Keep its Job handle until it
                // exits or the user explicitly approves destructive termination.
                self.child.as_mut().unwrap().input.take();
                Err(error)
            }
        }
    }
    pub fn status(&mut self) -> Snapshot {
        self.reap();
        if self.child.is_some() && self.state.lifecycle == "ready" {
            let _ = self.action("status");
        }
        self.snapshot()
    }
    pub fn stop(&mut self) -> Result<Snapshot, &'static str> {
        self.reap();
        if self.child.is_some() && !self.state.force_confirmation {
            self.action("stop-request")?;
        }
        Ok(self.snapshot())
    }
    pub fn confirm_stop(&mut self, instance: &str, force: bool) -> Result<Snapshot, &'static str> {
        self.reap();
        let child = self.child.as_mut().ok_or("not_running")?;
        if child.instance != instance {
            return Err("stale_confirmation");
        }
        if self.state.force_confirmation != force || (!force && self.state.confirmation.is_none()) {
            return Err("confirmation_changed");
        }
        if force {
            child.owned.terminate()?;
            self.forced_stop = true;
            self.stopping_since = Some(Instant::now());
            self.state.force_confirmation = false;
            self.state.confirmation = None;
            self.state.lifecycle = "stopping";
        } else {
            self.action("confirm-stop")?;
        }
        Ok(self.snapshot())
    }
    pub fn reveal_pairing(&mut self) -> Result<Pairing, &'static str> {
        if self.state.lifecycle != "ready" {
            return Err("not_running");
        }
        self.action("reveal-pairing")?.ok_or("invalid_frame")
    }
    pub fn hide_pairing(&mut self) -> Result<(), &'static str> {
        if self.state.lifecycle == "ready" {
            self.action("hide-pairing")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inherited_startup_failures_remain_distinct_and_cleanup_is_bounded() {
        use std::io::Write;
        let binary = PathBuf::from(
            std::env::var_os("PEW2_DESKTOP_STARTUP_FIXTURE")
                .expect("compiled startup fixture required"),
        );
        assert_eq!(std::env::var("PEW2_PORT").as_deref(), Ok("0"));
        for (scenario, expected) in [
            ("never-ready", "startup_timeout"),
            ("wrong-version", "protocol_mismatch"),
            ("early-exit", "channel_broken"),
        ] {
            let home = std::env::temp_dir().join(format!(
                "desktop-{scenario}-{}-{}",
                std::process::id(),
                GENERATION.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&home).unwrap();
            let launched = windows_job::launch(&binary, &home, &home).unwrap();
            let (sender, frames) = sync_channel(1);
            let stdout = thread::spawn(move || {
                let mut reader = BufReader::new(launched.stdout);
                let result = control_codec::read_frame(&mut reader)
                    .and_then(|frame| frame.ok_or("channel_broken"));
                let _ = sender.send(result);
            });
            let stderr = thread::spawn(move || {
                let _ = std::io::copy(&mut launched.stderr.take(4096), &mut std::io::sink());
            });
            let mut child = Child {
                owned: launched.owned,
                input: Some(launched.stdin),
                frames,
                readers: vec![stdout, stderr],
                instance: "startup-test".into(),
                request_id: 1,
            };
            let version = if scenario == "wrong-version" {
                control_codec::VERSION - 1
            } else {
                control_codec::VERSION
            };
            let request = serde_json::json!({ "v": version, "id": "1", "instance": child.instance, "command": "hello" });
            // The early-exit fixture deliberately exits before accepting requests.
            if scenario != "early-exit" {
                writeln!(child.input.as_mut().unwrap(), "{request}").unwrap();
            }
            let started = Instant::now();
            let timeout = if scenario == "never-ready" {
                Duration::from_millis(250)
            } else {
                Duration::from_secs(3)
            };
            let result = child.receive("hello", timeout);
            let mut controller = Controller::new(home.join("selection.json"), binary.clone());
            controller.child = Some(child);
            controller.state.lifecycle = "starting";
            assert!(controller.apply_response("hello", result).is_err());
            assert_eq!(
                controller.state.failure.as_deref(),
                Some(expected),
                "{scenario}"
            );
            assert!(controller.child.as_ref().unwrap().input.is_none());
            // Observe actual process exit before dropping its Job: no forced kill
            // or automatic restart may turn this into a false cleanup success.
            let deadline = Instant::now() + Duration::from_secs(3);
            while controller
                .child
                .as_ref()
                .unwrap()
                .owned
                .exited()
                .unwrap()
                .is_none()
                && Instant::now() < deadline
            {
                thread::yield_now();
            }
            assert!(
                controller
                    .child
                    .as_ref()
                    .unwrap()
                    .owned
                    .exited()
                    .unwrap()
                    .is_some(),
                "orphan: {scenario}"
            );
            let state = controller.snapshot();
            assert_eq!(state.failure.as_deref(), Some(expected));
            assert!(!controller.has_child());
            assert!(started.elapsed() < Duration::from_secs(5));
            std::fs::remove_dir(&home).unwrap();
        }
    }
    #[test]
    fn failed_reveal_preserves_running_state_and_confirmation() {
        let mut controller = Controller::new(PathBuf::new(), PathBuf::new());
        controller.state.lifecycle = "ready";
        controller.state.instance = Some("owned-test".into());
        controller.state.confirmation = Some(Busy::PendingApproval);
        let before = serde_json::to_value(&controller.state).unwrap();
        assert!(matches!(
            controller.apply_response(
                "reveal-pairing",
                Ok(Payload::CommandError {
                    code: "pairing_unavailable".into()
                })
            ),
            Err("pairing_unavailable")
        ));
        assert_eq!(serde_json::to_value(&controller.state).unwrap(), before);
        assert!(controller.stopping_since.is_none());
    }
    #[test]
    fn duplicate_start_and_force_upgrade_are_refused_for_real_child() {
        let binary = PathBuf::from(
            std::env::var_os("PEW2_DESKTOP_TEST_BINARY").expect("native fixture binary required"),
        );
        assert_eq!(std::env::var("PEW2_PORT").as_deref(), Ok("0"));
        let home = std::env::temp_dir().join(format!(
            "pew2 controller {} {}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&home).unwrap();
        let pairing = serde_json::json!({ "token": "c".repeat(1024), "key": "d".repeat(64), "createdAt": "1970-01-01T00:00:00.000Z" });
        std::fs::write(home.join("pairing.json"), pairing.to_string()).unwrap();
        let mut controller = Controller::new(home.join("launcher-selection.json"), binary);
        controller.select_home(home).unwrap();
        let initial = controller.start().unwrap();
        assert!(matches!(controller.start(), Err("already_running")));
        let instance = initial.instance.unwrap();
        for _ in 0..2 {
            let pairing = controller.reveal_pairing().unwrap();
            assert!(pairing.modules.len() >= 21);
            controller.hide_pairing().unwrap();
            assert_eq!(controller.status().lifecycle, "ready");
            assert!(controller.has_child());
        }
        assert!(matches!(
            controller.confirm_stop("old-instance", false),
            Err("stale_confirmation")
        ));
        controller.state.force_confirmation = true;
        assert!(matches!(
            controller.confirm_stop(&instance, false),
            Err("confirmation_changed")
        ));
        assert!(controller.has_child());
        controller.state.force_confirmation = false;
        controller.stop().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while controller.has_child() && Instant::now() < deadline {
            std::thread::yield_now();
        }
        assert!(!controller.has_child());
        assert_eq!(controller.snapshot().lifecycle, "stopped");
        let restarted = controller.start().unwrap();
        controller.state.force_confirmation = true;
        let stopping = controller
            .confirm_stop(&restarted.instance.unwrap(), true)
            .unwrap();
        assert!(!stopping.force_confirmation);
        let deadline = Instant::now() + Duration::from_secs(5);
        while controller.has_child() && Instant::now() < deadline {
            std::thread::yield_now();
        }
        let stopped = controller.snapshot();
        assert_eq!(stopped.lifecycle, "stopped");
        assert!(stopped.failure.is_none());
    }
}
