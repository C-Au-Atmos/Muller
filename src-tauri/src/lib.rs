mod diff;
mod explorer;
mod file_operations;
mod mutation;
mod preview;
mod scan;
mod thumbnail;
mod windows_navigation;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

use diff::{
    DiffManager, cancel_diff, close_diff_session, find_diff_position, read_binary_range,
    read_folder_diff_page, read_text_diff_page, start_file_diff, start_folder_diff,
};
use explorer::{
    ExplorerManager, cancel_directory_query, close_directory_session, list_directory_extensions,
    locate_directory_entry, read_directory_page, resolve_directory_entries, search_directory_page,
    start_directory_query, start_directory_search, warm_global_search_index,
};
use file_operations::{
    FileOperationManager, cancel_file_operation, create_entry, create_zip, directory_statistics,
    extract_zip, open_native_path, open_terminal, recycle_entry, rename_entry,
    transfer_directory_entries, transfer_entry,
};
use mutation::{
    MutationManager, close_edit_session, open_edit_session, recycle_duplicates, rollback_edit_side,
    save_edit_side,
};
use preview::{PreviewManager, cancel_file_preview, start_file_preview};
use scan::{ScanManager, cancel_scan, start_scan};
use thumbnail::{
    ShellVisualManager, cancel_image_thumbnail, cancel_shell_visual, start_image_thumbnail,
    start_shell_visual,
};
use windows_navigation::{
    complete_directory_path, get_shell_locations, list_logical_drivers, list_logical_drives,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            let show_item =
                MenuItem::with_id(app, "show", "Show Muller", true, Some("Ctrl+Shift+Space"))?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Muller", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let show_id = show_item.id().clone();
            let quit_id = quit_item.id().clone();
            let mut tray = TrayIconBuilder::with_id("muller-main")
                .tooltip("Muller - Ctrl+Shift+Space to show")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    if event.id() == &show_id {
                        show_main_window(app);
                    } else if event.id() == &quit_id {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, shortcut, event| {
                        if event.state == ShortcutState::Pressed
                            && shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space)
                        {
                            show_main_window(app);
                        }
                    })
                    .build(),
            )?;
            // A shortcut conflict must not prevent the file manager from starting.
            let _ = app.global_shortcut().register("ctrl+shift+space");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(ScanManager::default())
        .manage(ExplorerManager::default())
        .manage(DiffManager::default())
        .manage(MutationManager::default())
        .manage(FileOperationManager::default())
        .manage(PreviewManager::default())
        .manage(ShellVisualManager::default())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            start_directory_query,
            start_directory_search,
            warm_global_search_index,
            cancel_directory_query,
            read_directory_page,
            search_directory_page,
            resolve_directory_entries,
            locate_directory_entry,
            close_directory_session,
            list_directory_extensions,
            transfer_entry,
            transfer_directory_entries,
            cancel_file_operation,
            rename_entry,
            recycle_entry,
            open_native_path,
            create_entry,
            directory_statistics,
            open_terminal,
            create_zip,
            extract_zip,
            start_folder_diff,
            start_file_diff,
            cancel_diff,
            read_folder_diff_page,
            read_text_diff_page,
            read_binary_range,
            find_diff_position,
            close_diff_session,
            open_edit_session,
            save_edit_side,
            rollback_edit_side,
            close_edit_session,
            recycle_duplicates,
            start_file_preview,
            cancel_file_preview,
            start_image_thumbnail,
            cancel_image_thumbnail,
            start_shell_visual,
            cancel_shell_visual,
            get_shell_locations,
            complete_directory_path,
            list_logical_drives,
            list_logical_drivers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Muller");
}
