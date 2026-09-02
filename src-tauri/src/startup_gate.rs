#[cfg(windows)]
mod platform {
    use std::{ffi::OsStr, io, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_FAILED, WAIT_OBJECT_0},
        System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
    };

    const STARTUP_GATE_NAME: &str = r"Local\app.muller.desktop-startup-gate-v1";
    const INFINITE: u32 = u32::MAX;

    /// Serializes Tauri plugin initialization so a secondary process cannot
    /// inspect the single-instance endpoint before the primary creates it.
    pub struct StartupGate {
        handle: isize,
    }

    impl StartupGate {
        pub fn acquire() -> io::Result<Self> {
            Self::acquire_named(OsStr::new(STARTUP_GATE_NAME))
        }

        fn acquire_named(name: &OsStr) -> io::Result<Self> {
            let wide_name = name.encode_wide().chain(Some(0)).collect::<Vec<_>>();
            let handle = unsafe { CreateMutexW(ptr::null(), 0, wide_name.as_ptr()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }

            let wait_result = unsafe { WaitForSingleObject(handle, INFINITE) };
            if wait_result == WAIT_OBJECT_0 || wait_result == WAIT_ABANDONED {
                Ok(Self {
                    handle: handle as isize,
                })
            } else {
                let error = if wait_result == WAIT_FAILED {
                    io::Error::last_os_error()
                } else {
                    io::Error::other(format!(
                        "unexpected startup gate wait result: {wait_result}"
                    ))
                };
                unsafe {
                    CloseHandle(handle);
                }
                Err(error)
            }
        }

        pub fn release(mut self) -> io::Result<()> {
            self.release_inner()
        }

        fn release_inner(&mut self) -> io::Result<()> {
            if self.handle == 0 {
                return Ok(());
            }

            let handle = self.handle as HANDLE;
            self.handle = 0;
            let release_error = if unsafe { ReleaseMutex(handle) } == 0 {
                Some(io::Error::last_os_error())
            } else {
                None
            };
            let close_error = if unsafe { CloseHandle(handle) } == 0 {
                Some(io::Error::last_os_error())
            } else {
                None
            };

            if let Some(error) = release_error.or(close_error) {
                Err(error)
            } else {
                Ok(())
            }
        }
    }

    impl Drop for StartupGate {
        fn drop(&mut self) {
            let _ = self.release_inner();
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            ffi::OsString,
            sync::mpsc,
            thread,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };

        #[test]
        fn named_gate_serializes_competing_startups() {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let name = OsString::from(format!(
                r"Local\app.muller.desktop-startup-gate-test-{}-{unique}",
                std::process::id()
            ));
            let first = StartupGate::acquire_named(&name).unwrap();
            let competing_name = name.clone();
            let (sender, receiver) = mpsc::channel();
            let competing = thread::spawn(move || {
                let second = StartupGate::acquire_named(&competing_name).unwrap();
                sender.send(()).unwrap();
                second.release().unwrap();
            });

            assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
            first.release().unwrap();
            receiver.recv_timeout(Duration::from_secs(2)).unwrap();
            competing.join().unwrap();
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::io;

    pub struct StartupGate;

    impl StartupGate {
        pub fn acquire() -> io::Result<Self> {
            Ok(Self)
        }

        pub fn release(self) -> io::Result<()> {
            Ok(())
        }
    }
}

pub use platform::StartupGate;
