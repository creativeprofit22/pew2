//! Only this module deals with Win32 process creation. No caller-supplied PID.
#![cfg(windows)]

use std::{
    collections::BTreeMap,
    ffi::OsStr,
    fs::File,
    mem::size_of,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{
            SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT, WAIT_OBJECT_0,
        },
        Security::SECURITY_ATTRIBUTES,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Pipes::CreatePipe,
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
                InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
                UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
                CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
                LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
            },
        },
    },
};

type Result<T> = std::result::Result<T, &'static str>;
fn raw(handle: &OwnedHandle) -> HANDLE {
    HANDLE(handle.as_raw_handle())
}
fn wide(value: &OsStr) -> Result<Vec<u16>> {
    let mut value: Vec<u16> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err("invalid_path");
    }
    value.push(0);
    Ok(value)
}

fn pipe(parent_reads: bool) -> Result<(OwnedHandle, OwnedHandle)> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        bInheritHandle: true.into(),
        ..Default::default()
    };
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    // SAFETY: valid output pointers and live SECURITY_ATTRIBUTES; ownership of
    // successful handles transfers immediately to RAII, including failure paths.
    unsafe {
        CreatePipe(&mut read, &mut write, Some(&security), 0).map_err(|_| "pipe_failed")?;
        let read = OwnedHandle::from_raw_handle(read.0);
        let write = OwnedHandle::from_raw_handle(write.0);
        let (parent, child) = if parent_reads {
            (read, write)
        } else {
            (write, read)
        };
        SetHandleInformation(raw(&parent), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0))
            .map_err(|_| "pipe_failed")?;
        Ok((parent, child))
    }
}

struct Attributes {
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
    _storage: Vec<usize>,
}
impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: list was initialized successfully and storage outlives Drop.
        unsafe {
            DeleteProcThreadAttributeList(self.list);
        }
    }
}
impl Attributes {
    fn handles(handles: &[HANDLE]) -> Result<Self> {
        let mut bytes = 0;
        // SAFETY: the initial call reports required storage; usize allocation
        // provides pointer alignment, and handles remain live through CreateProcess.
        unsafe {
            let _ = InitializeProcThreadAttributeList(None, 1, None, &mut bytes);
            if bytes == 0 || bytes > 1024 * 1024 {
                return Err("ownership_failed");
            }
            let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            let list = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr().cast());
            InitializeProcThreadAttributeList(Some(list), 1, None, &mut bytes)
                .map_err(|_| "ownership_failed")?;
            let result = Self {
                list,
                _storage: storage,
            };
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                Some(handles.as_ptr().cast()),
                std::mem::size_of_val(handles),
                None,
                None,
            )
            .map_err(|_| "ownership_failed")?;
            Ok(result)
        }
    }
}

pub struct OwnedProcess {
    job: OwnedHandle,
    process: OwnedHandle,
}
pub struct Launched {
    pub owned: OwnedProcess,
    pub stdin: File,
    pub stdout: File,
    pub stderr: File,
}
impl OwnedProcess {
    pub fn exited(&self) -> Result<Option<u32>> {
        // SAFETY: process handle is live and owned for the entire call.
        unsafe {
            if WaitForSingleObject(raw(&self.process), 0) != WAIT_OBJECT_0 {
                return Ok(None);
            }
            let mut code = 0;
            GetExitCodeProcess(raw(&self.process), &mut code)
                .map_err(|_| "process_status_failed")?;
            Ok(Some(code))
        }
    }
    /// Destructive backstop: controller must have explicit approval while alive.
    pub fn terminate(&self) -> Result<()> {
        // SAFETY: only the job returned by our suspended launch is reachable.
        unsafe { TerminateJobObject(raw(&self.job), 1).map_err(|_| "termination_failed") }
    }
}

/// No generic command/argument API: the installed sibling is the only executable.
/// PATH and provider environment are inherited deliberately; identity overrides
/// are removed, and the already-validated home/workspace are supplied explicitly.
pub fn launch(executable: &Path, home: &Path, workspace: &Path) -> Result<Launched> {
    if !executable.is_absolute() || !executable.is_file() {
        return Err("missing_binary");
    }
    let app = wide(executable.as_os_str())?;
    let cwd = wide(workspace.as_os_str())?;
    let exe = executable.to_str().ok_or("invalid_path")?;
    if exe.contains('"') {
        return Err("invalid_path");
    }
    let mut command = wide(OsStr::new(&format!("\"{exe}\" serve --desktop-control")))?;
    let mut env = BTreeMap::new();
    for (key, value) in std::env::vars_os() {
        let key = key.to_str().ok_or("invalid_environment")?.to_uppercase();
        if key.contains('=') || key.contains('\0') {
            continue;
        }
        env.insert(key, value);
    }
    env.remove("PEW2_TOKEN");
    // Keep PEW2_RELAY so a conflicting remote configuration is refused, not hidden.
    env.insert("PEW2_HOME".into(), home.as_os_str().to_owned());
    env.insert("PEW2_WORKSPACE".into(), workspace.as_os_str().to_owned());
    let mut environment = Vec::new();
    for (key, value) in env {
        environment.extend(key.encode_utf16());
        environment.push('=' as u16);
        environment.extend(wide(&value)?);
    }
    environment.push(0);
    let (stdin, child_in) = pipe(false)?;
    let (stdout, child_out) = pipe(true)?;
    let (stderr, child_err) = pipe(true)?;
    let inherited = [raw(&child_in), raw(&child_out), raw(&child_err)];
    let attributes = Attributes::handles(&inherited)?;
    // SAFETY: every pointer references a live allocation until CreateProcess
    // returns; the attribute list limits inheritance to exactly three pipe ends.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|_| "ownership_failed")?;
        let job = OwnedHandle::from_raw_handle(job.0);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            raw(&job),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|_| "ownership_failed")?;
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = raw(&child_in);
        startup.StartupInfo.hStdOutput = raw(&child_out);
        startup.StartupInfo.hStdError = raw(&child_err);
        startup.lpAttributeList = attributes.list;
        let mut info = PROCESS_INFORMATION::default();
        CreateProcessW(
            PCWSTR(app.as_ptr()),
            Some(PWSTR(command.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_SUSPENDED
                | CREATE_NO_WINDOW
                | CREATE_UNICODE_ENVIRONMENT
                | EXTENDED_STARTUPINFO_PRESENT,
            Some(environment.as_ptr().cast()),
            PCWSTR(cwd.as_ptr()),
            &startup.StartupInfo,
            &mut info,
        )
        .map_err(|_| "launch_failed")?;
        let process = OwnedHandle::from_raw_handle(info.hProcess.0);
        let thread = OwnedHandle::from_raw_handle(info.hThread.0);
        if AssignProcessToJobObject(raw(&job), raw(&process)).is_err() {
            // Still suspended: it has executed no daemon or agent code.
            let _ = TerminateProcess(raw(&process), 1);
            let _ = WaitForSingleObject(raw(&process), 5000);
            return Err("ownership_failed");
        }
        if ResumeThread(raw(&thread)) == u32::MAX {
            return Err("launch_failed");
        }
        Ok(Launched {
            owned: OwnedProcess { job, process },
            stdin: File::from(stdin),
            stdout: File::from(stdout),
            stderr: File::from(stderr),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_codec::{decode, read_frame, write_request, Payload};
    use std::{
        io::{BufReader, Read, Write},
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn native_owned_daemon_handshake_stop_and_job_backstop() {
        let binary = std::env::var_os("PEW2_DESKTOP_TEST_BINARY").expect(
            "set PEW2_DESKTOP_TEST_BINARY to a compiled checkout daemon before native tests",
        );
        assert_eq!(
            std::env::var("PEW2_PORT").as_deref(),
            Ok("0"),
            "native tests require an isolated ephemeral port"
        );
        let home = std::env::temp_dir().join(format!(
            "pew2 native test {} {}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let pairing = serde_json::json!({ "token": "a".repeat(64), "key": "b".repeat(64), "createdAt": "1970-01-01T00:00:00.000Z" });
        let profile = home.join("pairing.json");
        // Exclusive creation makes reruns unable to overwrite existing test data.
        std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&profile)
            .unwrap()
            .write_all(pairing.to_string().as_bytes())
            .unwrap();
        for graceful in [true, false] {
            let Launched {
                owned,
                mut stdin,
                stdout,
                mut stderr,
            } = launch(Path::new(&binary), &home, &home).unwrap();
            let drain = std::thread::spawn(move || {
                let mut discard = [0u8; 1024];
                while let Ok(n) = stderr.read(&mut discard) {
                    if n == 0 {
                        break;
                    }
                }
            });
            let mut output = BufReader::new(stdout);
            write_request(&mut stdin, 1, "native-test", "hello").unwrap();
            let frame = read_frame(&mut output).unwrap().unwrap();
            assert!(matches!(
                decode(&frame, 1, "native-test").unwrap().payload,
                Payload::Status { .. }
            ));
            if graceful {
                write_request(&mut stdin, 2, "native-test", "stop-request").unwrap();
                let frame = read_frame(&mut output).unwrap().unwrap();
                assert!(matches!(
                    decode(&frame, 2, "native-test").unwrap().payload,
                    Payload::Status { .. }
                ));
                let deadline = Instant::now() + Duration::from_secs(5);
                while owned.exited().unwrap().is_none() && Instant::now() < deadline {
                    std::thread::yield_now();
                }
                assert_eq!(owned.exited().unwrap(), Some(0));
            }
            // In the second cycle no IPC stop/EOF is sent: dropping the Job
            // must close the daemon's stdout despite its still-open input pipe.
            drop(owned);
            assert!(read_frame(&mut output).unwrap().is_none());
            drop(stdin);
            drain.join().unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(profile).unwrap(),
            pairing.to_string()
        );
    }
}
