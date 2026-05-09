mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::seed_runtime_database(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_backup,
            commands::create_backup_at,
            commands::delete_platform_secret,
            commands::detect_import_files,
            commands::ensure_runtime_ready,
            commands::export_database_backup_payload,
            commands::get_platform_secret,
            commands::get_runtime_info,
            commands::has_platform_secret,
            commands::import_initial_data,
            commands::parse_inventory_workbook,
            commands::parse_sales_workbook,
            commands::parse_vendor_price_workbook,
            commands::restore_database_from_base64,
            commands::save_platform_secret,
            commands::apply_vendor_price_workbook,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
