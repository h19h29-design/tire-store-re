use calamine::{open_workbook_auto, Data, Range, Reader};
use chrono::Local;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Row, SqlitePool, Transaction};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileHints {
    pub inventory_path: Option<String>,
    pub sales_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub app_config_dir: String,
    pub db_path: String,
    pub backup_dir: String,
    pub detected_files: ImportFileHints,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadyResult {
    pub sale_line_cost_snapshot_column_ready: bool,
    pub cost_snapshot_backfilled_count: i64,
    pub daily_expense_backfilled_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub backup_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventorySeedItem {
    pub sku_code: String,
    pub brand_name: String,
    pub pattern_name: String,
    pub size_label: String,
    pub product_name: String,
    pub normalized_brand: String,
    pub normalized_pattern: String,
    pub normalized_size: String,
    pub default_cost_price: i64,
    pub default_sale_price: i64,
    pub quantity_on_hand: i64,
    pub aliases: Vec<String>,
    pub size_search_tokens: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedInventoryWorkbook {
    pub source_path: String,
    pub inventory_sheet: String,
    pub price_sheet: String,
    pub customer_sheet: Option<String>,
    pub item_count: usize,
    pub customer_seed_count: usize,
    pub historical_sale_count: usize,
    pub historical_service_count: usize,
    #[serde(skip_serializing)]
    pub customer_seeds: Vec<CustomerSeedRecord>,
    #[serde(skip_serializing)]
    pub historical_sales: Vec<ParsedSaleRow>,
    pub items: Vec<InventorySeedItem>,
}

#[derive(Debug, Clone)]
pub struct CustomerSeedRecord {
    pub row_number: usize,
    pub name: String,
    pub phone: String,
    pub normalized_phone: String,
    pub vehicle_model: String,
    pub plate_number: String,
    pub normalized_plate_number: String,
    pub odometer: i64,
    pub memo: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSaleRow {
    pub sale_number: String,
    pub sold_at: String,
    pub day_label: String,
    pub row_number: usize,
    pub phone: String,
    pub normalized_phone: String,
    pub vehicle_model: String,
    pub plate_number: String,
    pub normalized_plate_number: String,
    pub pattern: String,
    pub normalized_pattern: String,
    pub size_label: String,
    pub normalized_size: String,
    pub quantity: i64,
    pub al_amount: i64,
    pub total_amount: i64,
    pub card_amount: i64,
    pub cash_amount: i64,
    pub memo: String,
    pub line_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSalesDaySummary {
    pub day_label: String,
    pub sold_at: String,
    pub parsed_tire_quantity: i64,
    pub reported_tire_quantity: i64,
    pub quantity_delta: i64,
    pub parsed_total_amount: i64,
    pub reported_total_amount: i64,
    pub amount_delta: i64,
    pub parsed_card_amount: i64,
    pub reported_card_amount: i64,
    pub card_delta: i64,
    pub parsed_cash_amount: i64,
    pub reported_cash_amount: i64,
    pub cash_delta: i64,
    pub expense_amount: i64,
    pub expense_note: String,
    pub removed_summary_row_number: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSalesWorkbook {
    pub source_path: String,
    pub row_count: usize,
    pub tire_line_count: usize,
    pub service_line_count: usize,
    pub day_summaries: Vec<ParsedSalesDaySummary>,
    pub rows: Vec<ParsedSaleRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VendorPricePreviewRow {
    pub row_number: usize,
    pub brand_name: String,
    pub product_name: String,
    pub pattern_code: String,
    pub size_label: String,
    pub price_vat_included: i64,
    pub matched_item_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedVendorPriceWorkbook {
    pub source_path: String,
    pub sheet_name: String,
    pub detected_brand_name: String,
    pub price_column_label: String,
    pub row_count: usize,
    pub matched_row_count: usize,
    pub unmatched_row_count: usize,
    pub zero_price_row_count: usize,
    pub preview_rows: Vec<VendorPricePreviewRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VendorPriceImportResult {
    pub source_path: String,
    pub sheet_name: String,
    pub detected_brand_name: String,
    pub row_count: usize,
    pub matched_row_count: usize,
    pub unmatched_row_count: usize,
    pub updated_item_count: usize,
    pub updated_row_count: usize,
    pub skipped_zero_price_row_count: usize,
}

#[derive(Debug, Clone)]
struct VendorPriceWorkbookData {
    source_path: String,
    sheet_name: String,
    detected_brand_name: String,
    price_column_label: String,
    rows: Vec<VendorPriceRow>,
}

#[derive(Debug, Clone)]
struct VendorPriceRow {
    row_number: usize,
    brand_name: String,
    normalized_brand: String,
    product_name: String,
    pattern_code: String,
    size_label: String,
    normalized_size: String,
    price_vat_included: i64,
}

#[derive(Debug, Clone)]
struct VendorPriceColumnIndexes {
    brand_index: Option<usize>,
    product_index: Option<usize>,
    pattern_index: Option<usize>,
    size_index: usize,
    price_index: usize,
    price_label: String,
}

#[derive(Debug, Clone)]
struct ImportSaleLineSeed {
    line_type: String,
    item_id: Option<i64>,
    item_snapshot_name: String,
    size_snapshot: String,
    cost_price_snapshot: Option<i64>,
    quantity: i64,
    line_total: i64,
    memo: String,
}

#[derive(Debug, Clone)]
struct ImportWorkLogSeed {
    work_type: String,
    amount: i64,
    memo: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialImportResult {
    pub item_count: usize,
    pub customer_seed_count: usize,
    pub historical_sales_count: usize,
    pub customer_count: usize,
    pub vehicle_count: usize,
    pub sales_count: usize,
    pub unmatched_tire_lines: usize,
    pub sales_validation_issue_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct ItemLookupEntry {
    item_id: i64,
    default_cost_price: i64,
}

type ItemLookup = HashMap<String, ItemLookupEntry>;
type CustomerMap = HashMap<String, i64>;
type VehicleMap = HashMap<String, i64>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CustomerSheetLayout {
    Legacy,
    Current,
}

#[derive(Debug, Clone)]
struct SizeNormalization {
    size_label: String,
    normalized_size: String,
    search_tokens: Vec<String>,
}

#[tauri::command]
pub fn get_runtime_info(app: AppHandle) -> Result<RuntimeInfo, String> {
    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let backup_dir = preferred_backup_dir(&app).map_err(|error| error.to_string())?;
    let detected_files = detect_import_files_internal(&app);

    Ok(RuntimeInfo {
        app_config_dir: app_config_dir.display().to_string(),
        db_path: database_path(&app)?.display().to_string(),
        backup_dir: backup_dir.display().to_string(),
        detected_files,
    })
}

#[tauri::command]
pub fn detect_import_files(app: AppHandle) -> ImportFileHints {
    detect_import_files_internal(&app)
}

#[tauri::command]
pub async fn ensure_runtime_ready(app: AppHandle) -> Result<RuntimeReadyResult, String> {
    let pool = ensure_db_pool(&app).await?;
    apply_schema(&pool).await?;
    let cost_snapshot_backfilled_count = backfill_missing_sale_line_cost_snapshots(&pool).await?;
    remove_card_fee_daily_expenses(&pool).await;
    let daily_expense_backfilled_count =
        backfill_missing_daily_expenses_from_detected_sales_workbook(&app, &pool).await;

    Ok(RuntimeReadyResult {
        sale_line_cost_snapshot_column_ready: true,
        cost_snapshot_backfilled_count,
        daily_expense_backfilled_count,
    })
}

#[tauri::command]
pub fn create_backup(app: AppHandle) -> Result<BackupResult, String> {
    let backup_dir = preferred_backup_dir(&app).map_err(|error| error.to_string())?;
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;

    let created_at = Local::now();
    let destination = backup_dir.join(format!(
        "tire-store-backup-{}.db",
        created_at.format("%Y%m%d-%H%M%S")
    ));

    copy_database_file(&app, &destination)?;

    Ok(BackupResult {
        backup_path: destination.display().to_string(),
        created_at: created_at.to_rfc3339(),
    })
}

#[tauri::command]
pub fn create_backup_at(app: AppHandle, destination_path: String) -> Result<BackupResult, String> {
    let destination = PathBuf::from(destination_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    copy_database_file(&app, &destination)?;

    Ok(BackupResult {
        backup_path: destination.display().to_string(),
        created_at: Local::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn parse_inventory_workbook(path: String) -> Result<ParsedInventoryWorkbook, String> {
    parse_inventory_workbook_impl(&path)
}

#[tauri::command]
pub fn parse_sales_workbook(path: String) -> Result<ParsedSalesWorkbook, String> {
    parse_sales_workbook_impl(&path)
}

#[tauri::command]
pub async fn parse_vendor_price_workbook(
    app: AppHandle,
    path: String,
) -> Result<ParsedVendorPriceWorkbook, String> {
    let parsed = parse_vendor_price_workbook_impl(&path)?;
    let pool = ensure_db_pool(&app).await?;
    build_vendor_price_preview(&pool, &parsed).await
}

#[tauri::command]
pub async fn apply_vendor_price_workbook(
    app: AppHandle,
    path: String,
) -> Result<VendorPriceImportResult, String> {
    let parsed = parse_vendor_price_workbook_impl(&path)?;
    let pool = ensure_db_pool(&app).await?;
    apply_vendor_price_workbook_into_pool(&pool, &parsed).await
}

#[tauri::command]
pub async fn import_initial_data(
    app: AppHandle,
    inventory_path: String,
    sales_path: String,
) -> Result<InitialImportResult, String> {
    let inventory = parse_inventory_workbook_impl(&inventory_path)?;
    let sales = parse_sales_workbook_impl(&sales_path)?;
    let pool = ensure_db_pool(&app).await?;

    import_into_pool(&pool, &inventory, &sales).await
}

fn parse_inventory_workbook_impl(path: &str) -> Result<ParsedInventoryWorkbook, String> {
    return with_open_workbook(path, |workbook| {
        let sheet_names = workbook.sheet_names().to_vec();

        let inventory_sheet = sheet_names
            .iter()
            .find(|name| name.contains('년') && name.contains('월'))
            .cloned()
            .ok_or_else(|| "Monthly inventory sheet not found".to_string())?;

        let price_sheet = sheet_names
            .iter()
            .find(|name| name.contains("가격"))
            .cloned()
            .ok_or_else(|| "Price sheet not found".to_string())?;

        let _price_range = workbook
            .worksheet_range(&price_sheet)
            .map_err(|error| error.to_string())?;
        let _inventory_range = workbook
            .worksheet_range(&inventory_sheet)
            .map_err(|error| error.to_string())?;
        let inventory_sheet = sheet_names
            .iter()
            .find(|name| name.contains("\u{B144}") && name.contains("\u{C6D4}"))
            .cloned()
            .ok_or_else(|| "Monthly inventory sheet not found".to_string())?;
        let price_sheet = sheet_names
            .iter()
            .find(|name| name.contains("\u{AC00}\u{ACA9}"))
            .cloned()
            .ok_or_else(|| "Price sheet not found".to_string())?;
        let customer_sheet = sheet_names
            .iter()
            .find(|name| name.contains("\u{ACE0}\u{AC1D}\u{B4F1}\u{B85D}"))
            .cloned();
        let price_range = workbook
            .worksheet_range(&price_sheet)
            .map_err(|error| error.to_string())?;
        let inventory_range = workbook
            .worksheet_range(&inventory_sheet)
            .map_err(|error| error.to_string())?;

        let price_map = build_price_map(&price_range);
        let mut items_by_sku = BTreeMap::<String, InventorySeedItem>::new();

        for row in inventory_range.rows().skip(3) {
            let size = normalize_size_value(&cell_string(row.get(4)));
            let brand_name = cell_string(row.get(7));
            let product_name = cell_string(row.get(8));
            let pattern_name = cell_string(row.get(9));

            if size.size_label.is_empty() || brand_name.is_empty() || pattern_name.is_empty() {
                continue;
            }

            let normalized_brand = normalize_text(&brand_name);
            let normalized_pattern = normalize_text(&pattern_name);
            let normalized_size = size.normalized_size.clone();

            if normalized_brand.is_empty()
                || normalized_pattern.is_empty()
                || normalized_size.is_empty()
            {
                continue;
            }

            let sku_code = format!("{normalized_brand}__{normalized_pattern}__{normalized_size}");
            let default_cost_price = parse_money_thousand_won(&cell_string(row.get(5)));
            let quantity_on_hand = parse_number(&cell_string(row.get(11)));
            let default_sale_price =
                resolve_price(&price_map, &size.size_label, &pattern_name, &product_name);
            let aliases = collect_aliases(&pattern_name)
                .into_iter()
                .chain(collect_aliases(&product_name))
                .collect::<Vec<_>>();

            let entry = items_by_sku
                .entry(sku_code.clone())
                .or_insert_with(|| InventorySeedItem {
                    sku_code: sku_code.clone(),
                    brand_name: brand_name.clone(),
                    pattern_name: pattern_name.clone(),
                    size_label: size.size_label.clone(),
                    product_name: product_name.clone(),
                    normalized_brand: normalized_brand.clone(),
                    normalized_pattern: normalized_pattern.clone(),
                    normalized_size: normalized_size.clone(),
                    default_cost_price,
                    default_sale_price,
                    quantity_on_hand: 0,
                    aliases: Vec::new(),
                    size_search_tokens: size.search_tokens.clone(),
                });

            entry.quantity_on_hand += quantity_on_hand;
            if entry.default_cost_price == 0 && default_cost_price > 0 {
                entry.default_cost_price = default_cost_price;
            }
            if entry.default_sale_price == 0 && default_sale_price > 0 {
                entry.default_sale_price = default_sale_price;
            }

            let mut seen = entry.aliases.iter().cloned().collect::<HashSet<_>>();
            for alias in aliases {
                let normalized_alias = normalize_text(&alias);
                if !normalized_alias.is_empty() && seen.insert(normalized_alias) {
                    entry.aliases.push(alias);
                }
            }
        }

        let items = items_by_sku.into_values().collect::<Vec<_>>();
        let (customer_seeds, historical_sales) = if let Some(sheet_name) = customer_sheet.as_ref() {
            let range = workbook
                .worksheet_range(sheet_name)
                .map_err(|error| error.to_string())?;
            (
                parse_customer_sheet(&range),
                parse_customer_sheet_sales(&range),
            )
        } else {
            (Vec::new(), Vec::new())
        };
        let historical_sale_count = historical_sales
            .iter()
            .filter(|row| row.line_type == "tire")
            .count();
        let historical_service_count = historical_sales.len().saturating_sub(historical_sale_count);

        Ok(ParsedInventoryWorkbook {
            source_path: path.to_string(),
            inventory_sheet,
            price_sheet,
            customer_sheet,
            item_count: items.len(),
            customer_seed_count: customer_seeds.len(),
            historical_sale_count,
            historical_service_count,
            customer_seeds,
            historical_sales,
            items,
        })
    });
}

fn parse_sales_workbook_impl(path: &str) -> Result<ParsedSalesWorkbook, String> {
    return with_open_workbook(path, |workbook| {
        let mut rows = Vec::<ParsedSaleRow>::new();
        let mut tire_line_count = 0usize;
        let mut service_line_count = 0usize;
        let mut day_summaries = Vec::<ParsedSalesDaySummary>::new();

        for sheet_name in workbook.sheet_names().to_vec() {
            if !is_day_sheet_v2(&sheet_name) {
                continue;
            }

            let range = workbook
                .worksheet_range(&sheet_name)
                .map_err(|error| error.to_string())?;

            let day_label = sheet_name.clone();
            let sold_at = extract_date(&cell_string(range.get((0, 1))), &sheet_name);
            let reported_tire_quantity = parse_number(&cell_string(range.get((3, 23))));
            let mut parsed_tire_quantity = 0i64;
            let mut parsed_total_amount = 0i64;
            let mut parsed_card_amount = 0i64;
            let mut parsed_cash_amount = 0i64;
            let mut reported_total_amount = 0i64;
            let mut reported_card_amount = 0i64;
            let mut reported_cash_amount = 0i64;
            let mut expense_amount = 0i64;
            let mut expense_notes = Vec::<String>::new();
            let mut removed_summary_row_number = None;

            for (index, row) in range.rows().enumerate().skip(2) {
                let phone = cell_string(row.get(2));
                let vehicle_model = cell_string(row.get(3));
                let plate_number = cell_string(row.get(4));
                let pattern = cell_string(row.get(5));
                let size = normalize_size_value(&cell_string(row.get(6)));
                let quantity = parse_number(&cell_string(row.get(7)));
                let raw_al_amount = cell_string(row.get(8));
                let raw_total_amount = cell_string(row.get(9));
                let raw_card_amount = cell_string(row.get(10));
                let raw_cash_amount = cell_string(row.get(11));
                let memo = cell_string(row.get(12));
                let al_amount = parse_money_thousand_won(&raw_al_amount);
                let mut total_amount = parse_money_thousand_won(&raw_total_amount);
                let card_amount = parse_money_thousand_won(&raw_card_amount);
                let mut cash_amount = parse_money_thousand_won(&raw_cash_amount);

                if is_day_summary_row(
                    &phone,
                    &vehicle_model,
                    &plate_number,
                    &pattern,
                    &size.size_label,
                    quantity,
                    al_amount,
                    total_amount,
                    card_amount,
                    cash_amount,
                    &memo,
                ) {
                    reported_total_amount = if total_amount > 0 {
                        total_amount
                    } else {
                        card_amount + cash_amount
                    };
                    reported_card_amount = card_amount;
                    reported_cash_amount = cash_amount;
                    removed_summary_row_number = Some(index + 1);
                    continue;
                }

                if is_non_sale_amount_row(
                    &phone,
                    &vehicle_model,
                    &plate_number,
                    &pattern,
                    &size.size_label,
                    quantity,
                    al_amount,
                    total_amount,
                    card_amount,
                    cash_amount,
                    &memo,
                ) {
                    let next_note = extract_non_sale_amount_note(
                        &raw_total_amount,
                        &raw_card_amount,
                        &raw_cash_amount,
                        &memo,
                    );
                    if is_card_fee_note(&next_note) {
                        continue;
                    }

                    let next_expense_amount =
                        al_amount.max(0) + card_amount.max(0) + cash_amount.max(0);
                    if next_expense_amount > 0 {
                        expense_amount += next_expense_amount;
                        if !next_note.is_empty()
                            && !expense_notes.iter().any(|note| note == &next_note)
                        {
                            expense_notes.push(next_note);
                        }
                    }
                    continue;
                }

                if is_non_sale_memo_row(
                    &phone,
                    &vehicle_model,
                    &plate_number,
                    &pattern,
                    &size.size_label,
                    quantity,
                    al_amount,
                    total_amount,
                    card_amount,
                    cash_amount,
                    &memo,
                ) {
                    continue;
                }

                if !has_sale_row_data(
                    &phone,
                    &vehicle_model,
                    &plate_number,
                    &pattern,
                    &size.size_label,
                    quantity,
                    al_amount,
                    total_amount,
                    card_amount,
                    cash_amount,
                    &memo,
                ) {
                    continue;
                }

                if total_amount == 0 {
                    total_amount = card_amount + cash_amount;
                }
                if total_amount == 0 && al_amount > 0 {
                    total_amount = al_amount;
                }
                if card_amount == 0 && cash_amount == 0 && total_amount != 0 {
                    cash_amount = total_amount;
                }

                let line_type =
                    classify_line_type(&pattern, &size.size_label, quantity, al_amount, &memo);
                if counts_toward_reported_quantity(&line_type) {
                    tire_line_count += 1;
                    parsed_tire_quantity += quantity.max(0);
                } else {
                    service_line_count += 1;
                }

                parsed_total_amount += total_amount;
                parsed_card_amount += card_amount;
                parsed_cash_amount += cash_amount;

                rows.push(ParsedSaleRow {
                    sale_number: format!("IMP-{}-{:03}", sold_at.replace('-', ""), rows.len() + 1),
                    sold_at: sold_at.clone(),
                    day_label: day_label.clone(),
                    row_number: index + 1,
                    phone: phone.clone(),
                    normalized_phone: normalize_phone(&phone),
                    vehicle_model,
                    plate_number: plate_number.clone(),
                    normalized_plate_number: normalize_plate(&plate_number),
                    pattern: pattern.clone(),
                    normalized_pattern: normalize_text(&pattern),
                    size_label: size.size_label.clone(),
                    normalized_size: size.normalized_size.clone(),
                    quantity,
                    al_amount,
                    total_amount,
                    card_amount,
                    cash_amount,
                    memo,
                    line_type,
                });
            }

            day_summaries.push(ParsedSalesDaySummary {
                day_label,
                sold_at,
                parsed_tire_quantity,
                reported_tire_quantity,
                quantity_delta: parsed_tire_quantity - reported_tire_quantity,
                parsed_total_amount,
                reported_total_amount,
                amount_delta: parsed_total_amount - reported_total_amount,
                parsed_card_amount,
                reported_card_amount,
                card_delta: parsed_card_amount - reported_card_amount,
                parsed_cash_amount,
                reported_cash_amount,
                cash_delta: parsed_cash_amount - reported_cash_amount,
                expense_amount,
                expense_note: expense_notes.join(", "),
                removed_summary_row_number,
            });
        }

        Ok(ParsedSalesWorkbook {
            source_path: path.to_string(),
            row_count: rows.len(),
            tire_line_count,
            service_line_count,
            day_summaries,
            rows,
        })
    });
}

fn parse_vendor_price_workbook_impl(path: &str) -> Result<VendorPriceWorkbookData, String> {
    with_open_workbook(path, |workbook| {
        let sheet_names = workbook.sheet_names().to_vec();
        let mut selected_sheet: Option<(String, Range<Data>, usize, VendorPriceColumnIndexes)> =
            None;

        for sheet_name in sheet_names {
            let Ok(range) = workbook.worksheet_range(&sheet_name) else {
                continue;
            };
            let Some((header_row_index, columns)) = detect_vendor_price_columns(&range) else {
                continue;
            };
            if selected_sheet
                .as_ref()
                .map(|(_, current_range, _, _)| range.height() > current_range.height())
                .unwrap_or(true)
            {
                selected_sheet = Some((sheet_name, range, header_row_index, columns));
            }
        }

        let (sheet_name, range, header_row_index, columns) = selected_sheet.ok_or_else(|| {
            "가격표 헤더를 찾지 못했습니다. 사이즈와 부가세 포함 가격 열이 필요합니다.".to_string()
        })?;
        let detected_brand_name = detect_vendor_brand_name(path, &range);

        let mut rows = Vec::<VendorPriceRow>::new();
        for (row_index, row) in range.rows().enumerate().skip(header_row_index + 1) {
            let size = normalize_size_value(&cell_string(row.get(columns.size_index)));
            if size.normalized_size.is_empty() {
                continue;
            }

            let product_name = columns
                .product_index
                .map(|index| cell_string(row.get(index)))
                .unwrap_or_default();
            let pattern_code = columns
                .pattern_index
                .map(|index| cell_string(row.get(index)))
                .unwrap_or_default();
            let brand_name = columns
                .brand_index
                .map(|index| cell_string(row.get(index)))
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| detected_brand_name.clone());
            let price_vat_included = parse_money_won(&cell_string(row.get(columns.price_index)));

            if brand_name.trim().is_empty()
                && product_name.trim().is_empty()
                && pattern_code.trim().is_empty()
            {
                continue;
            }

            rows.push(VendorPriceRow {
                row_number: row_index + 1,
                brand_name: brand_name.clone(),
                normalized_brand: normalize_text(&brand_name),
                product_name,
                pattern_code,
                size_label: size.size_label,
                normalized_size: size.normalized_size,
                price_vat_included,
            });
        }

        if rows.is_empty() {
            return Err("가격표에서 반영할 행을 찾지 못했습니다.".to_string());
        }

        Ok(VendorPriceWorkbookData {
            source_path: path.to_string(),
            sheet_name,
            detected_brand_name,
            price_column_label: columns.price_label,
            rows,
        })
    })
}

async fn build_vendor_price_preview(
    pool: &SqlitePool,
    parsed: &VendorPriceWorkbookData,
) -> Result<ParsedVendorPriceWorkbook, String> {
    let mut matched_row_count = 0usize;
    let mut unmatched_row_count = 0usize;
    let mut preview_rows = Vec::<VendorPricePreviewRow>::new();

    for row in parsed.rows.iter().filter(|row| row.price_vat_included > 0) {
        let matched_item_count = load_vendor_row_item_ids(pool, row).await?.len();
        if matched_item_count > 0 {
            matched_row_count += 1;
        } else {
            unmatched_row_count += 1;
        }

        if preview_rows.len() < 20 {
            preview_rows.push(VendorPricePreviewRow {
                row_number: row.row_number,
                brand_name: row.brand_name.clone(),
                product_name: row.product_name.clone(),
                pattern_code: row.pattern_code.clone(),
                size_label: row.size_label.clone(),
                price_vat_included: row.price_vat_included,
                matched_item_count,
            });
        }
    }

    let zero_price_row_count = parsed
        .rows
        .iter()
        .filter(|row| row.price_vat_included <= 0)
        .count();

    Ok(ParsedVendorPriceWorkbook {
        source_path: parsed.source_path.clone(),
        sheet_name: parsed.sheet_name.clone(),
        detected_brand_name: parsed.detected_brand_name.clone(),
        price_column_label: parsed.price_column_label.clone(),
        row_count: parsed.rows.len(),
        matched_row_count,
        unmatched_row_count,
        zero_price_row_count,
        preview_rows,
    })
}

async fn apply_vendor_price_workbook_into_pool(
    pool: &SqlitePool,
    parsed: &VendorPriceWorkbookData,
) -> Result<VendorPriceImportResult, String> {
    let mut matched_row_count = 0usize;
    let mut unmatched_row_count = 0usize;
    let mut updated_row_count = 0usize;
    let mut item_price_updates = BTreeMap::<i64, i64>::new();

    for row in parsed.rows.iter().filter(|row| row.price_vat_included > 0) {
        let item_ids = load_vendor_row_item_ids(pool, row).await?;
        if item_ids.is_empty() {
            unmatched_row_count += 1;
            continue;
        }

        matched_row_count += 1;
        updated_row_count += 1;
        for item_id in item_ids {
            item_price_updates.insert(item_id, row.price_vat_included);
        }
    }

    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let effective_from = Local::now().to_rfc3339();
    let import_note = format!(
        "vendor price update: {} / {}",
        parsed.detected_brand_name, parsed.price_column_label
    );

    for (item_id, cost_price) in &item_price_updates {
        sqlx::query(
            r#"
      UPDATE items
      SET
        default_cost_price = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#,
        )
        .bind(cost_price)
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

        sqlx::query(
            r#"
      INSERT INTO price_history (
        item_id,
        cost_price,
        sale_price,
        effective_from,
        memo
      )
      SELECT
        id,
        ?,
        default_sale_price,
        ?,
        ?
      FROM items
      WHERE id = ?
      "#,
        )
        .bind(cost_price)
        .bind(&effective_from)
        .bind(&import_note)
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    insert_import_log(&mut tx, &parsed.source_path, "success", &import_note).await?;
    tx.commit().await.map_err(|error| error.to_string())?;

    Ok(VendorPriceImportResult {
        source_path: parsed.source_path.clone(),
        sheet_name: parsed.sheet_name.clone(),
        detected_brand_name: parsed.detected_brand_name.clone(),
        row_count: parsed.rows.len(),
        matched_row_count,
        unmatched_row_count,
        updated_item_count: item_price_updates.len(),
        updated_row_count,
        skipped_zero_price_row_count: parsed
            .rows
            .iter()
            .filter(|row| row.price_vat_included <= 0)
            .count(),
    })
}

fn detect_vendor_price_columns(range: &Range<Data>) -> Option<(usize, VendorPriceColumnIndexes)> {
    for (row_index, row) in range.rows().enumerate().take(20) {
        let normalized_cells = row
            .iter()
            .map(|cell| normalize_text(&cell_string(Some(cell))))
            .collect::<Vec<_>>();
        let size_index = normalized_cells
            .iter()
            .position(|cell| matches_vendor_header(cell, &["사이즈", "규격"]));
        let price_index = normalized_cells.iter().position(|cell| {
            matches_vendor_header(
                cell,
                &[
                    "부가세포함",
                    "vat포함",
                    "vatincluded",
                    "판매가",
                    "listprice(원)",
                ],
            )
        });
        let product_index = normalized_cells
            .iter()
            .position(|cell| matches_vendor_header(cell, &["상품명", "품명", "모델명"]));
        let pattern_index = normalized_cells
            .iter()
            .position(|cell| matches_vendor_header(cell, &["패턴코드", "패턴", "patterncode"]));

        if let (Some(size_index), Some(price_index)) = (size_index, price_index) {
            return Some((
                row_index,
                VendorPriceColumnIndexes {
                    brand_index: normalized_cells.iter().position(|cell| {
                        matches_vendor_header(cell, &["브랜드", "메이커", "제조사"])
                    }),
                    product_index,
                    pattern_index,
                    size_index,
                    price_index,
                    price_label: cell_string(row.get(price_index)),
                },
            ));
        }
    }

    None
}

fn matches_vendor_header(value: &str, aliases: &[&str]) -> bool {
    aliases
        .iter()
        .map(|alias| normalize_text(alias))
        .any(|alias| !alias.is_empty() && value.contains(&alias))
}

fn detect_vendor_brand_name(path: &str, range: &Range<Data>) -> String {
    let mut title_fragments = Vec::<String>::new();
    title_fragments.push(path.to_string());
    for row in range.rows().take(5) {
        for cell in row {
            let value = cell_string(Some(cell));
            if !value.trim().is_empty() {
                title_fragments.push(value);
            }
        }
    }

    let joined = normalize_text(&title_fragments.join(" "));
    for (keywords, label) in [
        (["한국타이어", "hankook"], "한국"),
        (["금호타이어", "kumho"], "금호"),
        (["넥센타이어", "nexen"], "넥센"),
        (["미쉐린", "michelin"], "미쉐린"),
        (["피렐리", "pirelli"], "피렐리"),
        (["브리지스톤", "bridgestone"], "브리지스톤"),
        (["콘티넨탈", "continental"], "콘티넨탈"),
        (["굿이어", "goodyear"], "굿이어"),
    ] {
        if keywords
            .iter()
            .map(|keyword| normalize_text(keyword))
            .any(|keyword| !keyword.is_empty() && joined.contains(&keyword))
        {
            return label.to_string();
        }
    }

    String::new()
}

fn build_vendor_match_candidates(row: &VendorPriceRow) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut candidates = Vec::<String>::new();

    for value in [&row.pattern_code, &row.product_name] {
        let normalized = normalize_text(value);
        if !normalized.is_empty() && seen.insert(normalized.clone()) {
            candidates.push(normalized);
        }
    }

    candidates
}

async fn load_vendor_row_item_ids(
    pool: &SqlitePool,
    row: &VendorPriceRow,
) -> Result<Vec<i64>, String> {
    let candidates = build_vendor_match_candidates(row);
    let mut query = String::from(
        "SELECT DISTINCT items.id AS id
    FROM items
    LEFT JOIN item_aliases
      ON item_aliases.item_id = items.id
    WHERE items.is_active = 1
      AND items.normalized_size = ?",
    );

    if !row.normalized_brand.is_empty() {
        query.push_str("\n      AND items.normalized_brand = ?");
    }

    if !candidates.is_empty() {
        let placeholders = std::iter::repeat("?")
            .take(candidates.len())
            .collect::<Vec<_>>()
            .join(", ");
        query.push_str(&format!(
            "\n      AND (
        items.normalized_pattern IN ({placeholders})
        OR item_aliases.normalized_alias IN ({placeholders})
      )"
        ));
    }

    query.push_str("\n    ORDER BY items.id ASC");

    let mut statement = sqlx::query(&query).bind(&row.normalized_size);
    if !row.normalized_brand.is_empty() {
        statement = statement.bind(&row.normalized_brand);
    }
    for candidate in &candidates {
        statement = statement.bind(candidate);
    }
    for candidate in &candidates {
        statement = statement.bind(candidate);
    }

    let rows = statement
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .iter()
        .map(|matched_row| matched_row.get::<i64, _>("id"))
        .collect())
}

async fn ensure_db_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let db_path = database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let options = SqliteConnectOptions::from_str(&db_path.display().to_string())
        .map_err(|error| error.to_string())?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|error| error.to_string())?;
    apply_schema(&pool).await?;
    Ok(pool)
}

async fn apply_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    ensure_items_allow_duplicate_variants(pool).await?;
    ensure_vehicle_brand_columns(pool).await?;
    ensure_item_discount_column(pool).await?;
    ensure_item_public_quote_columns(pool).await?;
    ensure_sale_line_cost_snapshot_column(pool).await?;
    ensure_sales_payment_columns(pool).await?;
    ensure_dashboard_tables(pool).await?;
    sqlx::raw_sql(include_str!("../migrations/reference_seed.sql"))
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn ensure_items_allow_duplicate_variants(pool: &SqlitePool) -> Result<(), String> {
    let index_rows = sqlx::query("PRAGMA index_list(items)")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    for index_row in index_rows {
        let index_name: String = index_row
            .try_get("name")
            .map_err(|error| error.to_string())?;
        let is_unique = index_row
            .try_get::<i64, _>("unique")
            .map_err(|error| error.to_string())?
            > 0;

        if !is_unique || index_name == "sqlite_autoindex_items_1" {
            continue;
        }

        let escaped_index_name = index_name.replace('"', "\"\"");
        let index_info_sql = format!("PRAGMA index_info(\"{escaped_index_name}\")");
        let column_rows = sqlx::query(&index_info_sql)
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?;
        let column_names = column_rows
            .iter()
            .map(|row| {
                row.try_get::<String, _>("name")
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;

        let is_legacy_duplicate_index = column_names
            == ["normalized_brand", "normalized_pattern", "normalized_size"]
            || column_names == ["brand_name", "pattern_name", "size_label"];

        if is_legacy_duplicate_index {
            let drop_index_sql = format!("DROP INDEX IF EXISTS \"{escaped_index_name}\"");
            sqlx::query(&drop_index_sql)
                .execute(pool)
                .await
                .map_err(|error| error.to_string())?;
        }
    }

    let trigger_rows = sqlx::query(
        r#"
    SELECT
      name,
      COALESCE(sql, '') AS sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name = 'items'
    "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    for trigger_row in trigger_rows {
        let trigger_name: String = trigger_row
            .try_get("name")
            .map_err(|error| error.to_string())?;
        let trigger_sql: String = trigger_row
            .try_get("sql")
            .map_err(|error| error.to_string())?;
        let normalized_sql = normalize_text(&trigger_sql);
        let is_legacy_duplicate_trigger = normalized_sql.contains("이미등록된규격")
            || (normalized_sql.contains("raise")
                && normalized_sql.contains("normalizedbrand")
                && normalized_sql.contains("normalizedpattern")
                && normalized_sql.contains("normalizedsize"))
            || (normalized_sql.contains("raise")
                && normalized_sql.contains("brandname")
                && normalized_sql.contains("patternname")
                && normalized_sql.contains("sizelabel"));

        if is_legacy_duplicate_trigger {
            let escaped_trigger_name = trigger_name.replace('"', "\"\"");
            let drop_trigger_sql = format!("DROP TRIGGER IF EXISTS \"{escaped_trigger_name}\"");
            sqlx::query(&drop_trigger_sql)
                .execute(pool)
                .await
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

async fn ensure_dashboard_tables(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        r#"
    CREATE TABLE IF NOT EXISTS daily_expenses (
      expense_date TEXT PRIMARY KEY,
      amount INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    "#,
    )
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn ensure_vehicle_brand_columns(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(vehicles)")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    let mut has_brand_name = false;
    let mut has_normalized_brand = false;

    for row in rows {
        let name: String = row.try_get("name").map_err(|error| error.to_string())?;
        if name == "brand_name" {
            has_brand_name = true;
        }
        if name == "normalized_brand" {
            has_normalized_brand = true;
        }
    }

    if !has_brand_name {
        sqlx::query("ALTER TABLE vehicles ADD COLUMN brand_name TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    if !has_normalized_brand {
        sqlx::query("ALTER TABLE vehicles ADD COLUMN normalized_brand TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn ensure_sale_line_cost_snapshot_column(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(sale_lines)")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    let has_cost_price_snapshot = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "cost_price_snapshot")
            .unwrap_or(false)
    });

    if !has_cost_price_snapshot {
        sqlx::query("ALTER TABLE sale_lines ADD COLUMN cost_price_snapshot INTEGER")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn ensure_item_discount_column(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(items)")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    let has_default_discount_rate = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "default_discount_rate")
            .unwrap_or(false)
    });

    if !has_default_discount_rate {
        sqlx::query("ALTER TABLE items ADD COLUMN default_discount_rate REAL NOT NULL DEFAULT 0")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn ensure_item_public_quote_columns(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(items)")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    let has_public_quote_enabled = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "public_quote_enabled")
            .unwrap_or(false)
    });
    let has_public_quote_url = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "public_quote_url")
            .unwrap_or(false)
    });

    if !has_public_quote_enabled {
        sqlx::query("ALTER TABLE items ADD COLUMN public_quote_enabled INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    if !has_public_quote_url {
        sqlx::query("ALTER TABLE items ADD COLUMN public_quote_url TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn ensure_sales_payment_columns(pool: &SqlitePool) -> Result<(), String> {
    let rows = sqlx::query("PRAGMA table_info(sales)")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    let has_naver_amount = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "naver_amount")
            .unwrap_or(false)
    });
    let has_card_fee_rate = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "card_fee_rate_basis_points")
            .unwrap_or(false)
    });
    let has_is_naver_card = rows.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "is_naver_card")
            .unwrap_or(false)
    });

    if !has_card_fee_rate {
        sqlx::query(
            "ALTER TABLE sales ADD COLUMN card_fee_rate_basis_points INTEGER NOT NULL DEFAULT 300",
        )
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    }

    if !has_naver_amount {
        sqlx::query("ALTER TABLE sales ADD COLUMN naver_amount INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    if !has_is_naver_card {
        sqlx::query("ALTER TABLE sales ADD COLUMN is_naver_card INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }

    sqlx::query(
    r#"
    UPDATE sales
    SET
      naver_amount = CASE
        WHEN COALESCE(naver_amount, 0) = 0 AND COALESCE(is_naver_card, 0) = 1 THEN COALESCE(card_amount, 0)
        ELSE COALESCE(naver_amount, 0)
      END,
      card_amount = CASE
        WHEN COALESCE(naver_amount, 0) = 0 AND COALESCE(is_naver_card, 0) = 1 THEN 0
        ELSE COALESCE(card_amount, 0)
      END
    WHERE COALESCE(is_naver_card, 0) = 1
      AND COALESCE(card_amount, 0) > 0
      AND COALESCE(naver_amount, 0) = 0
    "#,
  )
  .execute(pool)
  .await
  .map_err(|error| error.to_string())?;

    Ok(())
}

async fn backfill_missing_sale_line_cost_snapshots(pool: &SqlitePool) -> Result<i64, String> {
    let result = sqlx::query(
        r#"
    UPDATE sale_lines
    SET cost_price_snapshot = (
      SELECT items.default_cost_price
      FROM items
      WHERE items.id = sale_lines.item_id
    )
    WHERE sale_lines.line_type = 'tire'
      AND sale_lines.item_id IS NOT NULL
      AND sale_lines.cost_price_snapshot IS NULL
      AND EXISTS (
        SELECT 1
        FROM items
        WHERE items.id = sale_lines.item_id
      )
    "#,
    )
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(result.rows_affected() as i64)
}

async fn import_into_pool(
    pool: &SqlitePool,
    inventory: &ParsedInventoryWorkbook,
    sales: &ParsedSalesWorkbook,
) -> Result<InitialImportResult, String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    clear_business_tables(&mut tx).await?;

    let mut item_lookup = ItemLookup::new();
    let mut customer_map = CustomerMap::new();
    let mut vehicle_map = VehicleMap::new();

    for item in &inventory.items {
        let item_id = insert_inventory_item(&mut tx, item).await?;
        register_item_lookup(&mut item_lookup, item, item_id);
    }

    let mut customer_count = 0usize;
    let mut vehicle_count = 0usize;
    let mut sales_count = 0usize;
    let mut unmatched_tire_lines = 0usize;
    let sales_validation_issue_count = sales
        .day_summaries
        .iter()
        .filter(|summary| {
            summary.reported_tire_quantity > 0
                && (summary.quantity_delta != 0
                    || summary.amount_delta != 0
                    || summary.card_delta != 0
                    || summary.cash_delta != 0)
        })
        .count();

    for summary in &sales.day_summaries {
        if !should_import_daily_expense_summary(summary) {
            continue;
        }

        insert_daily_expense(
            &mut tx,
            &summary.sold_at,
            summary.expense_amount,
            &summary.expense_note,
        )
        .await?;
    }

    for seed in &inventory.customer_seeds {
        let (customer_id, customer_created) =
            ensure_customer_seed(&mut tx, seed, &mut customer_map).await?;
        let (vehicle_id, vehicle_created) =
            ensure_vehicle_seed(&mut tx, seed, customer_id, &mut vehicle_map).await?;

        if customer_created {
            customer_count += 1;
        }
        if vehicle_created {
            vehicle_count += 1;
        }

        if customer_id.is_none() && vehicle_id.is_none() {
            continue;
        }
    }

    let mut seen_sale_keys = HashSet::<String>::new();
    let merged_sales_rows = sales
        .rows
        .iter()
        .chain(inventory.historical_sales.iter())
        .filter(|row| {
            let sale_key = format!(
                "{}|{}|{}|{}|{}|{}|{}",
                row.sold_at,
                row.normalized_plate_number,
                row.normalized_pattern,
                row.normalized_size,
                row.quantity,
                row.total_amount,
                normalize_text(&row.memo)
            );

            seen_sale_keys.insert(sale_key)
        })
        .collect::<Vec<_>>();

    for row in merged_sales_rows {
        let (customer_id, customer_created) =
            ensure_customer(&mut tx, row, &mut customer_map).await?;
        let (vehicle_id, vehicle_created) =
            ensure_vehicle(&mut tx, row, customer_id, &mut vehicle_map).await?;

        if customer_created {
            customer_count += 1;
        }
        if vehicle_created {
            vehicle_count += 1;
        }

        let sale_total = imported_sale_total(row);

        let sale_id = insert_sale(&mut tx, row, customer_id, vehicle_id, sale_total).await?;
        sales_count += 1;

        let matched_item = if row.line_type == "tire" {
            item_lookup
                .get(&format!(
                    "{}|{}",
                    row.normalized_size, row.normalized_pattern
                ))
                .copied()
        } else {
            None
        };

        if row.line_type == "tire" && matched_item.is_none() {
            unmatched_tire_lines += 1;
        }

        for line_seed in build_import_sale_line_seeds(row, matched_item, sale_total) {
            insert_sale_line(&mut tx, sale_id, &line_seed).await?;
        }

        for work_log_seed in build_import_work_log_seeds(row, sale_total) {
            insert_work_log(
                &mut tx,
                sale_id,
                customer_id,
                vehicle_id,
                &work_log_seed,
                &row.sold_at,
            )
            .await?;
        }
    }

    insert_import_log(
        &mut tx,
        &inventory.source_path,
        "success",
        &format!(
            "items={}, customer_seeds={}, customer_history_sales={}",
            inventory.items.len(),
            inventory.customer_seeds.len(),
            inventory.historical_sales.len()
        ),
    )
    .await?;
    insert_import_log(
        &mut tx,
        &sales.source_path,
        "success",
        &format!(
            "sales={}, unmatched_tire_lines={}, validation_issues={}",
            sales.rows.len(),
            unmatched_tire_lines,
            sales_validation_issue_count
        ),
    )
    .await?;

    tx.commit().await.map_err(|error| error.to_string())?;

    Ok(InitialImportResult {
        item_count: inventory.items.len(),
        customer_seed_count: inventory.customer_seeds.len(),
        historical_sales_count: inventory.historical_sales.len(),
        customer_count,
        vehicle_count,
        sales_count,
        unmatched_tire_lines,
        sales_validation_issue_count,
    })
}

async fn clear_business_tables(tx: &mut Transaction<'_, sqlx::Sqlite>) -> Result<(), String> {
    let delete_queries = [
        "DELETE FROM daily_expenses",
        "DELETE FROM work_logs",
        "DELETE FROM sale_lines",
        "DELETE FROM sales",
        "DELETE FROM vehicles",
        "DELETE FROM customers",
        "DELETE FROM inventory_movements",
        "DELETE FROM inventory_balance_cache",
        "DELETE FROM price_history",
        "DELETE FROM item_aliases",
        "DELETE FROM items",
        "DELETE FROM imports",
    ];

    for query in delete_queries {
        sqlx::query(query)
            .execute(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn insert_daily_expense(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    expense_date: &str,
    amount: i64,
    note: &str,
) -> Result<(), String> {
    sqlx::query(
        r#"
    INSERT INTO daily_expenses (
      expense_date,
      amount,
      note,
      updated_at
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(expense_date) DO UPDATE SET
      amount = excluded.amount,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
    "#,
    )
    .bind(expense_date)
    .bind(amount.max(0))
    .bind(note.trim())
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn backfill_missing_daily_expenses_from_detected_sales_workbook(
    app: &AppHandle,
    pool: &SqlitePool,
) -> i64 {
    let imported_sale_day_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT SUBSTR(sold_at, 1, 10)) FROM sales WHERE sale_number LIKE 'IMP-%'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if imported_sale_day_count <= 0 {
        return 0;
    }

    let imported_sale_dates = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT SUBSTR(sold_at, 1, 10) FROM sales WHERE sale_number LIKE 'IMP-%'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect::<HashSet<_>>();

    if imported_sale_dates.is_empty() {
        return 0;
    }

    let existing_expense_dates = sqlx::query_scalar::<_, String>("SELECT expense_date FROM daily_expenses")
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect::<HashSet<_>>();

    for sales_path in candidate_sales_workbook_paths(app, pool).await {
        let parsed = match parse_sales_workbook_impl(&sales_path) {
            Ok(parsed) => parsed,
            Err(error) => {
                eprintln!(
                    "failed to auto-backfill daily expenses from sales workbook {}: {}",
                    sales_path, error
                );
                continue;
            }
        };

        let mut backfilled_count = 0i64;

        for summary in parsed.day_summaries {
            if !should_import_daily_expense_summary(&summary)
                || !imported_sale_dates.contains(&summary.sold_at)
                || existing_expense_dates.contains(&summary.sold_at)
            {
                continue;
            }

            let insert_result = sqlx::query(
                r#"
      INSERT INTO daily_expenses (
        expense_date,
        amount,
        note,
        updated_at
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(expense_date) DO NOTHING
      "#,
            )
            .bind(&summary.sold_at)
            .bind(summary.expense_amount.max(0))
            .bind(summary.expense_note.trim())
            .execute(pool)
            .await;

            match insert_result {
                Ok(result) => {
                    backfilled_count += result.rows_affected() as i64;
                }
                Err(error) => {
                    eprintln!(
                        "failed to insert auto-backfilled daily expense for {}: {}",
                        summary.sold_at, error
                    );
                }
            }
        }

        if backfilled_count > 0 {
            return backfilled_count;
        }
    }

    0
}

async fn remove_card_fee_daily_expenses(pool: &SqlitePool) -> i64 {
    sqlx::query(
    r#"
    DELETE FROM daily_expenses
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(note, ''), ' ', ''), ',', ''), '/', ''), '-', '') IN (?, ?)
    "#,
  )
  .bind("카드수수료")
  .bind("cardfee")
  .execute(pool)
  .await
  .map(|result| result.rows_affected() as i64)
  .unwrap_or(0)
}

async fn insert_inventory_item(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    item: &InventorySeedItem,
) -> Result<i64, String> {
    let result = sqlx::query(
        r#"
    INSERT INTO items (
      sku_code,
      brand_name,
      pattern_name,
      size_label,
      normalized_brand,
      normalized_pattern,
      normalized_size,
      product_name,
      default_cost_price,
      default_sale_price,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    "#,
    )
    .bind(&item.sku_code)
    .bind(&item.brand_name)
    .bind(&item.pattern_name)
    .bind(&item.size_label)
    .bind(&item.normalized_brand)
    .bind(&item.normalized_pattern)
    .bind(&item.normalized_size)
    .bind(&item.product_name)
    .bind(item.default_cost_price)
    .bind(item.default_sale_price)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    let item_id = result.last_insert_rowid();

    sqlx::query(
        r#"
    INSERT INTO inventory_balance_cache (
      item_id,
      quantity_on_hand,
      quantity_reserved,
      quantity_available
    ) VALUES (?, ?, 0, ?)
    "#,
    )
    .bind(item_id)
    .bind(item.quantity_on_hand)
    .bind(item.quantity_on_hand)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
    INSERT INTO inventory_movements (
      item_id,
      movement_type,
      quantity,
      unit_cost,
      unit_price,
      occurred_at,
      reference_type,
      memo
    ) VALUES (?, 'opening', ?, ?, ?, DATETIME('now'), 'import', 'initial import')
    "#,
    )
    .bind(item_id)
    .bind(item.quantity_on_hand)
    .bind(item.default_cost_price)
    .bind(item.default_sale_price)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query(
        r#"
    INSERT INTO price_history (
      item_id,
      cost_price,
      sale_price,
      effective_from,
      memo
    ) VALUES (?, ?, ?, DATETIME('now'), 'initial import')
    "#,
    )
    .bind(item_id)
    .bind(item.default_cost_price)
    .bind(item.default_sale_price)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    for alias in &item.aliases {
        let normalized_alias = normalize_text(alias);
        if normalized_alias.is_empty() {
            continue;
        }

        sqlx::query(
            r#"
      INSERT OR IGNORE INTO item_aliases (
        item_id,
        alias_type,
        alias_value,
        normalized_alias
      ) VALUES (?, 'search', ?, ?)
      "#,
        )
        .bind(item_id)
        .bind(alias)
        .bind(normalized_alias)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    for token in &item.size_search_tokens {
        let normalized_alias = normalize_text(token);
        if normalized_alias.is_empty() {
            continue;
        }

        sqlx::query(
            r#"
      INSERT OR IGNORE INTO item_aliases (
        item_id,
        alias_type,
        alias_value,
        normalized_alias
      ) VALUES (?, 'size', ?, ?)
      "#,
        )
        .bind(item_id)
        .bind(token)
        .bind(normalized_alias)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    Ok(item_id)
}

fn register_item_lookup(item_lookup: &mut ItemLookup, item: &InventorySeedItem, item_id: i64) {
    let entry = ItemLookupEntry {
        item_id,
        default_cost_price: item.default_cost_price.max(0),
    };

    item_lookup.insert(
        format!("{}|{}", item.normalized_size, item.normalized_pattern),
        entry,
    );

    for alias in &item.aliases {
        let normalized_alias = normalize_text(alias);
        if !normalized_alias.is_empty() {
            item_lookup.insert(
                format!("{}|{}", item.normalized_size, normalized_alias),
                entry,
            );
        }
    }
}

fn register_customer_keys(
    customer_map: &mut CustomerMap,
    normalized_phone: &str,
    normalized_plate_number: &str,
    name: &str,
    customer_id: i64,
) {
    if !normalized_phone.is_empty() {
        customer_map.insert(normalized_phone.to_string(), customer_id);
    }
    if !normalized_plate_number.is_empty() {
        customer_map.insert(format!("plate:{normalized_plate_number}"), customer_id);
    }

    let normalized_name = normalize_text(name);
    if normalized_phone.is_empty()
        && normalized_plate_number.is_empty()
        && !normalized_name.is_empty()
    {
        customer_map.insert(format!("name:{normalized_name}"), customer_id);
    }
}

fn build_customer_key(normalized_phone: &str, normalized_plate_number: &str, name: &str) -> String {
    if !normalized_phone.is_empty() {
        normalized_phone.to_string()
    } else if !normalized_plate_number.is_empty() {
        format!("plate:{normalized_plate_number}")
    } else {
        let normalized_name = normalize_text(name);
        if normalized_name.is_empty() {
            String::new()
        } else {
            format!("name:{normalized_name}")
        }
    }
}

fn register_vehicle_key(
    vehicle_map: &mut VehicleMap,
    normalized_plate_number: &str,
    vehicle_model: &str,
    customer_id: Option<i64>,
    vehicle_id: i64,
) {
    if !normalized_plate_number.is_empty() {
        vehicle_map.insert(normalized_plate_number.to_string(), vehicle_id);
    } else {
        let fallback = normalize_text(&format!(
            "{}:{}",
            vehicle_model,
            customer_id.unwrap_or_default()
        ));
        if !fallback.is_empty() && fallback != "0" {
            vehicle_map.insert(fallback, vehicle_id);
        }
    }
}

async fn ensure_customer_seed(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    seed: &CustomerSeedRecord,
    customer_map: &mut CustomerMap,
) -> Result<(Option<i64>, bool), String> {
    let customer_key = build_customer_key(
        &seed.normalized_phone,
        &seed.normalized_plate_number,
        &seed.name,
    );
    if customer_key.is_empty() {
        return Ok((None, false));
    }

    if let Some(existing_id) = customer_map.get(&customer_key).copied() {
        sqlx::query(
      r#"
      UPDATE customers
      SET
        name = CASE WHEN TRIM(name) = '' AND ? <> '' THEN ? ELSE name END,
        phone = CASE WHEN TRIM(phone) = '' AND ? <> '' THEN ? ELSE phone END,
        normalized_phone = CASE WHEN TRIM(normalized_phone) = '' AND ? <> '' THEN ? ELSE normalized_phone END,
        memo = CASE WHEN TRIM(COALESCE(memo, '')) = '' AND ? <> '' THEN ? ELSE memo END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#,
    )
    .bind(&seed.name)
    .bind(&seed.name)
    .bind(&seed.phone)
    .bind(&seed.phone)
    .bind(&seed.normalized_phone)
    .bind(&seed.normalized_phone)
    .bind(&seed.memo)
    .bind(&seed.memo)
    .bind(existing_id)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

        register_customer_keys(
            customer_map,
            &seed.normalized_phone,
            &seed.normalized_plate_number,
            &seed.name,
            existing_id,
        );
        return Ok((Some(existing_id), false));
    }

    let result = sqlx::query(
        r#"
    INSERT INTO customers (
      name,
      phone,
      normalized_phone,
      memo
    ) VALUES (?, ?, ?, ?)
    "#,
    )
    .bind(&seed.name)
    .bind(&seed.phone)
    .bind(&seed.normalized_phone)
    .bind(seed.memo.clone())
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    let customer_id = result.last_insert_rowid();
    register_customer_keys(
        customer_map,
        &seed.normalized_phone,
        &seed.normalized_plate_number,
        &seed.name,
        customer_id,
    );
    Ok((Some(customer_id), true))
}

async fn ensure_vehicle_seed(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    seed: &CustomerSeedRecord,
    customer_id: Option<i64>,
    vehicle_map: &mut VehicleMap,
) -> Result<(Option<i64>, bool), String> {
    let vehicle_key = if !seed.normalized_plate_number.is_empty() {
        seed.normalized_plate_number.clone()
    } else {
        normalize_text(&format!(
            "{}:{}",
            seed.vehicle_model,
            customer_id.unwrap_or_default()
        ))
    };

    if vehicle_key.is_empty() || vehicle_key == "0" {
        return Ok((None, false));
    }

    if let Some(existing_id) = vehicle_map.get(&vehicle_key).copied() {
        sqlx::query(
            r#"
      UPDATE vehicles
      SET
        customer_id = COALESCE(customer_id, ?),
        plate_number = CASE WHEN TRIM(plate_number) = '' AND ? <> '' THEN ? ELSE plate_number END,
        normalized_plate_number = CASE
          WHEN TRIM(normalized_plate_number) = '' AND ? <> '' THEN ?
          ELSE normalized_plate_number
        END,
        model_name = CASE WHEN TRIM(model_name) = '' AND ? <> '' THEN ? ELSE model_name END,
        odometer = CASE WHEN ? > odometer THEN ? ELSE odometer END,
        memo = CASE WHEN TRIM(COALESCE(memo, '')) = '' AND ? <> '' THEN ? ELSE memo END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      "#,
        )
        .bind(customer_id)
        .bind(&seed.plate_number)
        .bind(&seed.plate_number)
        .bind(&seed.normalized_plate_number)
        .bind(&seed.normalized_plate_number)
        .bind(&seed.vehicle_model)
        .bind(&seed.vehicle_model)
        .bind(seed.odometer)
        .bind(seed.odometer)
        .bind(&seed.memo)
        .bind(&seed.memo)
        .bind(existing_id)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;

        register_vehicle_key(
            vehicle_map,
            &seed.normalized_plate_number,
            &seed.vehicle_model,
            customer_id,
            existing_id,
        );
        return Ok((Some(existing_id), false));
    }

    let result = sqlx::query(
        r#"
    INSERT INTO vehicles (
      customer_id,
      plate_number,
      normalized_plate_number,
      model_name,
      odometer,
      memo
    ) VALUES (?, ?, ?, ?, ?, ?)
    "#,
    )
    .bind(customer_id)
    .bind(&seed.plate_number)
    .bind(&seed.normalized_plate_number)
    .bind(&seed.vehicle_model)
    .bind(seed.odometer)
    .bind(seed.memo.clone())
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    let vehicle_id = result.last_insert_rowid();
    register_vehicle_key(
        vehicle_map,
        &seed.normalized_plate_number,
        &seed.vehicle_model,
        customer_id,
        vehicle_id,
    );
    Ok((Some(vehicle_id), true))
}

async fn ensure_customer(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    row: &ParsedSaleRow,
    customer_map: &mut CustomerMap,
) -> Result<(Option<i64>, bool), String> {
    let customer_key = build_customer_key(&row.normalized_phone, &row.normalized_plate_number, "");

    if customer_key.is_empty() {
        return Ok((None, false));
    }

    if let Some(existing_id) = customer_map.get(&customer_key).copied() {
        register_customer_keys(
            customer_map,
            &row.normalized_phone,
            &row.normalized_plate_number,
            "",
            existing_id,
        );
        return Ok((Some(existing_id), false));
    }

    let result = sqlx::query(
        r#"
    INSERT INTO customers (
      name,
      phone,
      normalized_phone,
      memo
    ) VALUES (?, ?, ?, 'imported from sales workbook')
    "#,
    )
    .bind("")
    .bind(&row.phone)
    .bind(&row.normalized_phone)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    let customer_id = result.last_insert_rowid();
    register_customer_keys(
        customer_map,
        &row.normalized_phone,
        &row.normalized_plate_number,
        "",
        customer_id,
    );
    Ok((Some(customer_id), true))
}

async fn ensure_vehicle(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    row: &ParsedSaleRow,
    customer_id: Option<i64>,
    vehicle_map: &mut VehicleMap,
) -> Result<(Option<i64>, bool), String> {
    let vehicle_key = if !row.normalized_plate_number.is_empty() {
        row.normalized_plate_number.clone()
    } else {
        normalize_text(&format!(
            "{}:{}",
            row.vehicle_model,
            customer_id.unwrap_or_default()
        ))
    };

    if vehicle_key.is_empty() || vehicle_key == "0" {
        return Ok((None, false));
    }

    if let Some(existing_id) = vehicle_map.get(&vehicle_key).copied() {
        register_vehicle_key(
            vehicle_map,
            &row.normalized_plate_number,
            &row.vehicle_model,
            customer_id,
            existing_id,
        );
        return Ok((Some(existing_id), false));
    }

    let result = sqlx::query(
        r#"
    INSERT INTO vehicles (
      customer_id,
      plate_number,
      normalized_plate_number,
      model_name,
      odometer,
      memo
    ) VALUES (?, ?, ?, ?, 0, 'imported from sales workbook')
    "#,
    )
    .bind(customer_id)
    .bind(&row.plate_number)
    .bind(&row.normalized_plate_number)
    .bind(&row.vehicle_model)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    let vehicle_id = result.last_insert_rowid();
    register_vehicle_key(
        vehicle_map,
        &row.normalized_plate_number,
        &row.vehicle_model,
        customer_id,
        vehicle_id,
    );
    Ok((Some(vehicle_id), true))
}

async fn insert_sale(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    row: &ParsedSaleRow,
    customer_id: Option<i64>,
    vehicle_id: Option<i64>,
    total_amount: i64,
) -> Result<i64, String> {
    let card_amount = imported_card_amount(row);
    let naver_amount = imported_naver_amount(row);
    let card_fee_rate_basis_points = imported_card_fee_rate_basis_points(row);
    let is_naver_card = if naver_amount > 0 { 1 } else { 0 };
    let result = sqlx::query(
        r#"
    INSERT INTO sales (
      sale_number,
      sold_at,
      customer_id,
      vehicle_id,
      total_amount,
      card_amount,
      naver_amount,
      cash_amount,
      card_fee_rate_basis_points,
      is_naver_card,
      memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#,
    )
    .bind(&row.sale_number)
    .bind(&row.sold_at)
    .bind(customer_id)
    .bind(vehicle_id)
    .bind(total_amount)
    .bind(card_amount)
    .bind(naver_amount)
    .bind(row.cash_amount)
    .bind(card_fee_rate_basis_points)
    .bind(is_naver_card)
    .bind(row.memo.clone())
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    Ok(result.last_insert_rowid())
}

async fn insert_sale_line(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    sale_id: i64,
    seed: &ImportSaleLineSeed,
) -> Result<(), String> {
    let quantity = if seed.quantity > 0 { seed.quantity } else { 1 };
    let unit_price = if quantity > 0 {
        (seed.line_total as f64 / quantity as f64).round() as i64
    } else {
        seed.line_total
    };

    sqlx::query(
        r#"
    INSERT INTO sale_lines (
      sale_id,
      line_type,
      item_id,
      item_snapshot_name,
      size_snapshot,
      cost_price_snapshot,
      quantity,
      unit_price,
      line_total,
      memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#,
    )
    .bind(sale_id)
    .bind(&seed.line_type)
    .bind(seed.item_id)
    .bind(&seed.item_snapshot_name)
    .bind(&seed.size_snapshot)
    .bind(seed.cost_price_snapshot)
    .bind(seed.quantity)
    .bind(unit_price)
    .bind(seed.line_total)
    .bind(&seed.memo)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn insert_work_log(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    sale_id: i64,
    customer_id: Option<i64>,
    vehicle_id: Option<i64>,
    seed: &ImportWorkLogSeed,
    worked_at: &str,
) -> Result<(), String> {
    sqlx::query(
        r#"
    INSERT INTO work_logs (
      sale_id,
      customer_id,
      vehicle_id,
      work_type,
      amount,
      memo,
      worked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    "#,
    )
    .bind(sale_id)
    .bind(customer_id)
    .bind(vehicle_id)
    .bind(&seed.work_type)
    .bind(seed.amount)
    .bind(&seed.memo)
    .bind(worked_at)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

async fn insert_import_log(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    source_file: &str,
    status: &str,
    note: &str,
) -> Result<(), String> {
    sqlx::query("INSERT INTO imports (source_file, status, note) VALUES (?, ?, ?)")
        .bind(source_file)
        .bind(status)
        .bind(note)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_database_file(app: &AppHandle, destination: &Path) -> Result<(), String> {
    let db_path = database_path(app)?;
    if !db_path.exists() {
        return Err("Database file does not exist yet".to_string());
    }

    fs::copy(&db_path, destination).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn seed_runtime_database(app: &AppHandle) -> Result<(), String> {
    let db_path = database_path(app)?;
    if db_path.exists() {
        return Ok(());
    }

    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let resource_dir = match app.path().resource_dir() {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };

    let candidate_paths = [
        resource_dir.join("resources").join("tire-store.db"),
        resource_dir.join("tire-store.db"),
    ];

    if let Some(seed_path) = candidate_paths.iter().find(|path| path.exists()) {
        fs::copy(seed_path, &db_path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    path.push("tire-store.db");
    Ok(path)
}

fn preferred_backup_dir(app: &AppHandle) -> Result<PathBuf, std::io::Error> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().download_dir())
        .or_else(|_| std::env::current_dir())?;
    Ok(base.join("Tire Store Backups"))
}

fn detect_import_files_internal(app: &AppHandle) -> ImportFileHints {
    let downloads_dir = match app.path().download_dir() {
        Ok(path) => path,
        Err(_) => {
            return ImportFileHints {
                inventory_path: None,
                sales_path: None,
            }
        }
    };

    ImportFileHints {
        inventory_path: latest_matching_xlsx(&downloads_dir, &["재고관리"])
            .map(|path| path.display().to_string()),
        sales_path: latest_matching_xlsx(&downloads_dir, &["판매일보"])
            .map(|path| path.display().to_string()),
    }
}

async fn candidate_sales_workbook_paths(app: &AppHandle, pool: &SqlitePool) -> Vec<String> {
    let mut candidates = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    let detected_files = detect_import_files_internal(app);
    if let Some(sales_path) = detected_files.sales_path {
        if Path::new(&sales_path).exists() && seen.insert(sales_path.clone()) {
            candidates.push(sales_path);
        }
    }

    let imported_paths = sqlx::query_scalar::<_, String>(
        r#"
        SELECT source_file
        FROM imports
        WHERE LOWER(COALESCE(note, '')) LIKE '%sales=%'
          AND LOWER(COALESCE(source_file, '')) LIKE '%.xlsx'
        ORDER BY id DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for source_file in imported_paths {
        if Path::new(&source_file).exists() && seen.insert(source_file.clone()) {
            candidates.push(source_file);
        }
    }

    candidates
}

fn latest_matching_xlsx(directory: &Path, keywords: &[&str]) -> Option<PathBuf> {
    let mut matches = fs::read_dir(directory)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_string_lossy().to_lowercase();
            if extension != "xlsx" {
                return None;
            }

            let file_name = path.file_name()?.to_string_lossy().to_lowercase();
            if file_name.starts_with("~$") {
                return None;
            }
            if keywords
                .iter()
                .all(|keyword| file_name.contains(&keyword.to_lowercase()))
            {
                let modified = entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                Some((path, modified))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    matches.sort_by_key(|(_, modified)| *modified);
    matches.pop().map(|(path, _)| path)
}

fn parse_customer_sheet(range: &Range<Data>) -> Vec<CustomerSeedRecord> {
    let mut layout = CustomerSheetLayout::Legacy;
    let mut seeds = Vec::<CustomerSeedRecord>::new();

    for (index, row) in range.rows().enumerate() {
        let values = (0..13)
            .map(|column| cell_string(row.get(column)))
            .collect::<Vec<_>>();

        if let Some(next_layout) = detect_customer_sheet_layout(&values) {
            layout = next_layout;
            continue;
        }

        let seed = match layout {
            CustomerSheetLayout::Legacy => parse_legacy_customer_row(index + 1, &values),
            CustomerSheetLayout::Current => parse_current_customer_row(index + 1, &values),
        };

        if let Some(seed) = seed {
            seeds.push(seed);
        }
    }

    seeds
}

fn parse_customer_sheet_sales(range: &Range<Data>) -> Vec<ParsedSaleRow> {
    let mut rows = Vec::<ParsedSaleRow>::new();
    let mut current_sold_at = String::new();
    let mut sequence = 1usize;

    for (index, row) in range.rows().enumerate() {
        let values = (0..13)
            .map(|column| cell_string(row.get(column)))
            .collect::<Vec<_>>();

        if is_customer_sheet_sales_header(&values) {
            continue;
        }

        if let Some(next_sold_at) = extract_customer_sheet_date(&values[0], &current_sold_at) {
            current_sold_at = next_sold_at;
        }

        if current_sold_at.is_empty() {
            continue;
        }

        let first_aux = sanitize_text_cell(&values[1]);
        let phone = sanitize_phone(&values[2]);
        let vehicle_model = sanitize_text_cell(&values[3]);
        let plate_number = sanitize_plate_cell(&values[4]);
        let pattern = sanitize_text_cell(&values[5]);
        let size = normalize_size_value(&cell_string(row.get(6)));
        let quantity = parse_number(&cell_string(row.get(7)));
        let al_amount = parse_money_thousand_won(&cell_string(row.get(8)));
        let mut total_amount = parse_money_thousand_won(&cell_string(row.get(10)));
        let trailing_note = combine_text_cells(&[values[11].as_str(), values[12].as_str()]);
        let memo = if !looks_like_odometer_text(&first_aux)
            && !first_aux.is_empty()
            && normalize_phone(&first_aux).len() < 8
        {
            combine_text_cells(&[first_aux.as_str(), trailing_note.as_str()])
        } else {
            trailing_note
        };

        if !customer_sheet_sale_row_has_data(
            &phone,
            &vehicle_model,
            &plate_number,
            &pattern,
            &size.size_label,
            quantity,
            al_amount,
            total_amount,
            &memo,
        ) {
            continue;
        }

        if total_amount == 0 && al_amount > 0 {
            total_amount = al_amount;
        }

        let line_type = classify_line_type(&pattern, &size.size_label, quantity, al_amount, &memo);
        let normalized_memo = normalize_text(&memo);
        let card_amount = if total_amount > 0
            && (memo.contains("\u{CE74}\u{B4DC}")
                || normalized_memo.contains("card")
                || normalized_memo.contains("naver"))
        {
            total_amount
        } else {
            0
        };
        let cash_amount = if total_amount > 0 && card_amount == 0 {
            total_amount
        } else {
            0
        };

        rows.push(ParsedSaleRow {
            sale_number: format!("CUST-{}-{:04}", current_sold_at.replace('-', ""), sequence),
            sold_at: current_sold_at.clone(),
            day_label: "customer-history".to_string(),
            row_number: index + 1,
            phone: phone.clone(),
            normalized_phone: normalize_phone(&phone),
            vehicle_model,
            plate_number: plate_number.clone(),
            normalized_plate_number: normalize_plate(&plate_number),
            pattern: pattern.clone(),
            normalized_pattern: normalize_text(&pattern),
            size_label: size.size_label.clone(),
            normalized_size: size.normalized_size.clone(),
            quantity,
            al_amount,
            total_amount,
            card_amount,
            cash_amount,
            memo,
            line_type,
        });
        sequence += 1;
    }

    rows
}

fn is_customer_sheet_sales_header(values: &[String]) -> bool {
    let normalized = values
        .iter()
        .map(|value| normalize_text(value))
        .collect::<Vec<_>>();
    normalized.iter().any(|value| value == "\u{B0A0}\u{C790}")
        || (normalized
            .iter()
            .any(|value| value == "\u{C5F0}\u{B77D}\u{CC98}")
            && normalized
                .iter()
                .any(|value| value == "\u{CC28}\u{B7C9}\u{BC88}\u{D638}")
            && normalized.iter().any(|value| value == "\u{C218}\u{B7C9}"))
}

fn extract_customer_sheet_date(raw: &str, fallback: &str) -> Option<String> {
    let digits = raw
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.len() < 8 {
        return None;
    }

    let year = digits[0..4].parse::<i32>().ok()?;
    let mut month = digits[4..6].parse::<i32>().unwrap_or(0);
    let mut day = digits[6..8].parse::<i32>().unwrap_or(0);

    if !(1..=12).contains(&month) {
        month = fallback
            .split('-')
            .nth(1)
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(1);
    }

    if !(1..=31).contains(&day) {
        day = fallback
            .split('-')
            .nth(2)
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(1);
    }

    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn looks_like_odometer_text(value: &str) -> bool {
    let digits = value
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    digits.len() >= 4 && normalize_text(value) == digits
}

fn customer_sheet_sale_row_has_data(
    phone: &str,
    vehicle_model: &str,
    plate_number: &str,
    pattern: &str,
    size_label: &str,
    quantity: i64,
    al_amount: i64,
    total_amount: i64,
    memo: &str,
) -> bool {
    !phone.trim().is_empty()
        || !vehicle_model.trim().is_empty()
        || !plate_number.trim().is_empty()
        || !pattern.trim().is_empty()
        || !size_label.trim().is_empty()
        || quantity != 0
        || al_amount != 0
        || total_amount != 0
        || !memo.trim().is_empty()
}

fn detect_customer_sheet_layout(values: &[String]) -> Option<CustomerSheetLayout> {
    let normalized = values
        .iter()
        .map(|value| normalize_text(value))
        .collect::<Vec<_>>();
    let has_phone = normalized
        .iter()
        .any(|value| value == "\u{C5F0}\u{B77D}\u{CC98}");
    let has_plate = normalized
        .iter()
        .any(|value| value == "\u{CC28}\u{B7C9}\u{BC88}\u{D638}");
    if !has_phone || !has_plate {
        return None;
    }

    if normalized
        .iter()
        .any(|value| value == "\u{C774}\u{B984}" || value == "\u{B0A0}\u{C790}")
    {
        Some(CustomerSheetLayout::Current)
    } else {
        Some(CustomerSheetLayout::Legacy)
    }
}

fn parse_legacy_customer_row(row_number: usize, values: &[String]) -> Option<CustomerSeedRecord> {
    let phone = sanitize_phone(&values[1]);
    let vehicle_model = sanitize_text_cell(&values[2]);
    let plate_number = sanitize_plate_cell(&values[3]);
    let memo = combine_text_cells(&[values[11].as_str(), values[12].as_str()]);

    build_customer_seed(
        row_number,
        "",
        &phone,
        &vehicle_model,
        &plate_number,
        0,
        &memo,
    )
}

fn parse_current_customer_row(row_number: usize, values: &[String]) -> Option<CustomerSeedRecord> {
    let primary_phone = sanitize_phone(&values[2]);
    let secondary_phone = sanitize_phone(&values[1]);
    let phone = if !primary_phone.is_empty() {
        primary_phone
    } else {
        secondary_phone
    };
    let name = if phone.is_empty() {
        let primary_name = sanitize_name_cell(&values[1]);
        if !primary_name.is_empty() {
            primary_name
        } else {
            sanitize_name_cell(&values[2])
        }
    } else {
        sanitize_name_cell(&values[1])
    };
    let vehicle_model = sanitize_text_cell(&values[3]);
    let plate_number = sanitize_plate_cell(&values[4]);
    let odometer = parse_odometer(&values[1]);
    let memo = combine_text_cells(&[
        values[10].as_str(),
        values[11].as_str(),
        values[12].as_str(),
    ]);

    build_customer_seed(
        row_number,
        &name,
        &phone,
        &vehicle_model,
        &plate_number,
        odometer,
        &memo,
    )
}

fn build_customer_seed(
    row_number: usize,
    name: &str,
    phone: &str,
    vehicle_model: &str,
    plate_number: &str,
    odometer: i64,
    memo: &str,
) -> Option<CustomerSeedRecord> {
    let normalized_phone = normalize_phone(phone);
    let normalized_plate_number = normalize_plate(plate_number);
    let name = sanitize_name_cell(name);
    let vehicle_model = sanitize_text_cell(vehicle_model);
    let memo = sanitize_text_cell(memo);

    if normalized_phone.is_empty()
        && normalized_plate_number.is_empty()
        && name.is_empty()
        && vehicle_model.is_empty()
    {
        return None;
    }

    Some(CustomerSeedRecord {
        row_number,
        name,
        phone: phone.trim().to_string(),
        normalized_phone,
        vehicle_model,
        plate_number: plate_number.trim().to_string(),
        normalized_plate_number,
        odometer,
        memo,
    })
}

fn sanitize_phone(raw: &str) -> String {
    let normalized = normalize_phone(raw);
    if normalized.len() >= 8 {
        raw.trim().to_string()
    } else {
        String::new()
    }
}

fn sanitize_plate_cell(raw: &str) -> String {
    let trimmed = raw.trim();
    let normalized = normalize_plate(trimmed);
    let digit_count = normalized.chars().filter(|ch| ch.is_ascii_digit()).count();
    if digit_count >= 4 && normalized.len() >= 6 {
        trimmed.to_string()
    } else {
        String::new()
    }
}

fn sanitize_name_cell(raw: &str) -> String {
    let trimmed = raw.trim();
    if is_placeholder_cell(trimmed) || looks_like_date_label(trimmed) {
        return String::new();
    }

    let normalized_phone = normalize_phone(trimmed);
    if normalized_phone.len() >= 8 {
        return String::new();
    }

    let normalized = normalize_text(trimmed);
    if normalized.is_empty() || normalized.chars().all(|ch| ch.is_ascii_digit()) {
        return String::new();
    }

    trimmed.to_string()
}

fn sanitize_text_cell(raw: &str) -> String {
    let trimmed = raw.trim();
    if is_placeholder_cell(trimmed) || looks_like_date_label(trimmed) {
        String::new()
    } else {
        trimmed.to_string()
    }
}

fn combine_text_cells(parts: &[&str]) -> String {
    parts
        .iter()
        .map(|part| sanitize_text_cell(part))
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" / ")
}

fn extract_non_sale_amount_note(
    raw_total_amount: &str,
    raw_card_amount: &str,
    raw_cash_amount: &str,
    memo: &str,
) -> String {
    let candidates = [raw_total_amount, memo, raw_card_amount, raw_cash_amount];

    for candidate in candidates {
        let trimmed = sanitize_text_cell(candidate);
        if trimmed.is_empty() {
            continue;
        }

        if parse_decimal(&trimmed) > 0.0 {
            continue;
        }

        let cleaned = trimmed.trim_end_matches(':').trim();
        if !cleaned.is_empty() {
            return cleaned.to_string();
        }
    }

    "일일 지출".to_string()
}

fn is_card_fee_note(note: &str) -> bool {
    let normalized = normalize_text(note);
    !normalized.is_empty()
        && (normalized.contains(&normalize_text("카드수수료")) || normalized.contains("cardfee"))
}

fn is_card_fee_only_note(note: &str) -> bool {
    let normalized = normalize_text(note);
    !normalized.is_empty()
        && (normalized == normalize_text("카드수수료") || normalized == "cardfee")
}

fn should_import_daily_expense_summary(summary: &ParsedSalesDaySummary) -> bool {
    summary.expense_amount > 0
        && !summary.expense_note.trim().is_empty()
        && !is_card_fee_only_note(&summary.expense_note)
}

fn parse_odometer(raw: &str) -> i64 {
    let value = parse_number(raw);
    if value >= 1000 {
        value
    } else {
        0
    }
}

fn is_placeholder_cell(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.is_empty()
        || trimmed == "0"
        || trimmed == "-"
        || trimmed.eq_ignore_ascii_case("#REF!")
        || trimmed.eq_ignore_ascii_case("#N/A")
}

fn looks_like_date_label(raw: &str) -> bool {
    let digits = raw
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    digits.len() >= 3 && normalize_text(raw).contains("\u{C77C}")
}

fn normalize_size_value(raw: &str) -> SizeNormalization {
    let compact_raw = normalize_text(raw);
    if compact_raw.is_empty() {
        return SizeNormalization {
            size_label: String::new(),
            normalized_size: String::new(),
            search_tokens: Vec::new(),
        };
    }

    let alnum_tokens = split_ascii_alnum_tokens(raw);
    let digit_tokens = alnum_tokens
        .iter()
        .filter(|token| token.chars().all(|ch| ch.is_ascii_digit()))
        .cloned()
        .collect::<Vec<_>>();
    let core_numbers = extract_core_size_numbers(&digit_tokens);
    let size_label = if !core_numbers.is_empty() {
        core_numbers.join(" ")
    } else {
        raw.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    let normalized_size = if !core_numbers.is_empty() {
        core_numbers.join("")
    } else {
        compact_raw.clone()
    };

    let mut search_tokens = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    for token in [
        compact_raw.clone(),
        normalized_size.clone(),
        normalize_text(&size_label),
        build_r_size_token(&core_numbers),
    ] {
        let normalized = normalize_text(&token);
        if !normalized.is_empty() && seen.insert(normalized) {
            search_tokens.push(token);
        }
    }

    SizeNormalization {
        size_label,
        normalized_size,
        search_tokens,
    }
}

fn split_ascii_alnum_tokens(raw: &str) -> Vec<String> {
    let mut tokens = Vec::<String>::new();
    let mut current = String::new();
    let mut current_is_digit = None;

    for ch in raw.chars() {
        if ch.is_ascii_digit() || ch.is_ascii_alphabetic() {
            let is_digit = ch.is_ascii_digit();
            if current_is_digit == Some(is_digit) || current.is_empty() {
                current.push(ch.to_ascii_lowercase());
            } else {
                tokens.push(current.clone());
                current.clear();
                current.push(ch.to_ascii_lowercase());
            }
            current_is_digit = Some(is_digit);
        } else if !current.is_empty() {
            tokens.push(current.clone());
            current.clear();
            current_is_digit = None;
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn extract_core_size_numbers(tokens: &[String]) -> Vec<String> {
    if let Some(token) = tokens.iter().find(|token| token.len() >= 7) {
        let digits = token.chars().take(7).collect::<String>();
        return vec![
            digits[0..3].to_string(),
            digits[3..5].to_string(),
            digits[5..7].to_string(),
        ];
    }

    if tokens.len() >= 3 && tokens[0].len() == 3 {
        return tokens.iter().take(3).cloned().collect::<Vec<_>>();
    }

    if tokens.len() >= 2 && tokens[0].len() == 3 {
        return tokens.iter().take(2).cloned().collect::<Vec<_>>();
    }

    Vec::new()
}

fn build_r_size_token(core_numbers: &[String]) -> String {
    match core_numbers {
        [width, aspect, rim] => format!("{width}{aspect}r{rim}"),
        [width, rim] => format!("{width}r{rim}"),
        _ => String::new(),
    }
}

fn build_price_map(range: &Range<Data>) -> HashMap<String, i64> {
    let rows = range.rows().collect::<Vec<_>>();
    if rows.len() < 3 {
        return HashMap::new();
    }

    let header_row = rows[1];
    let mut column_aliases = Vec::<Vec<String>>::new();
    for column in 1..header_row.len() {
        column_aliases.push(collect_aliases(&cell_string(header_row.get(column))));
    }

    let mut price_map = HashMap::<String, i64>::new();
    for row in rows.iter().skip(2) {
        let size = normalize_size_value(&cell_string(row.get(0)));
        let normalized_size = size.normalized_size.clone();
        if normalized_size.is_empty() {
            continue;
        }

        for column in 1..row.len() {
            let price = parse_money_won(&cell_string(row.get(column)));
            if price <= 0 {
                continue;
            }

            if let Some(aliases) = column_aliases.get(column - 1) {
                for alias in aliases {
                    let normalized_alias = normalize_text(alias);
                    if normalized_alias.is_empty() {
                        continue;
                    }
                    price_map
                        .entry(format!("{normalized_size}|{normalized_alias}"))
                        .or_insert(price);
                }
            }
        }
    }

    price_map
}

fn resolve_price(
    price_map: &HashMap<String, i64>,
    size_label: &str,
    pattern_name: &str,
    product_name: &str,
) -> i64 {
    let normalized_size = normalize_size_value(size_label).normalized_size;
    let candidates = collect_aliases(pattern_name)
        .into_iter()
        .chain(collect_aliases(product_name))
        .collect::<Vec<_>>();

    for candidate in candidates {
        let key = format!("{}|{}", normalized_size, normalize_text(&candidate));
        if let Some(price) = price_map.get(&key) {
            return *price;
        }
    }

    0
}

fn has_sale_row_data(
    phone: &str,
    vehicle_model: &str,
    plate_number: &str,
    pattern: &str,
    size_label: &str,
    quantity: i64,
    al_amount: i64,
    total_amount: i64,
    card_amount: i64,
    cash_amount: i64,
    memo: &str,
) -> bool {
    !(phone.is_empty()
        && vehicle_model.is_empty()
        && plate_number.is_empty()
        && pattern.is_empty()
        && size_label.is_empty()
        && quantity == 0
        && al_amount == 0
        && total_amount == 0
        && card_amount == 0
        && cash_amount == 0
        && memo.is_empty())
}

fn is_day_summary_row(
    phone: &str,
    vehicle_model: &str,
    plate_number: &str,
    pattern: &str,
    size_label: &str,
    quantity: i64,
    al_amount: i64,
    total_amount: i64,
    card_amount: i64,
    cash_amount: i64,
    memo: &str,
) -> bool {
    phone.is_empty()
        && vehicle_model.is_empty()
        && plate_number.is_empty()
        && pattern.is_empty()
        && size_label.is_empty()
        && quantity == 0
        && memo.is_empty()
        && (al_amount > 0 || total_amount > 0 || card_amount > 0 || cash_amount > 0)
        && total_amount > 0
}

fn is_non_sale_amount_row(
    phone: &str,
    vehicle_model: &str,
    plate_number: &str,
    pattern: &str,
    size_label: &str,
    quantity: i64,
    al_amount: i64,
    total_amount: i64,
    card_amount: i64,
    cash_amount: i64,
    memo: &str,
) -> bool {
    phone.is_empty()
        && vehicle_model.is_empty()
        && plate_number.is_empty()
        && pattern.is_empty()
        && size_label.is_empty()
        && quantity == 0
        && memo.is_empty()
        && total_amount == 0
        && (al_amount > 0 || card_amount > 0 || cash_amount > 0)
}

fn is_non_sale_memo_row(
    phone: &str,
    vehicle_model: &str,
    plate_number: &str,
    pattern: &str,
    size_label: &str,
    quantity: i64,
    al_amount: i64,
    total_amount: i64,
    card_amount: i64,
    cash_amount: i64,
    memo: &str,
) -> bool {
    phone.is_empty()
        && vehicle_model.is_empty()
        && plate_number.is_empty()
        && pattern.is_empty()
        && size_label.is_empty()
        && quantity == 0
        && al_amount == 0
        && total_amount == 0
        && card_amount == 0
        && cash_amount == 0
        && !memo.is_empty()
}

fn classify_line_type(
    pattern: &str,
    size_label: &str,
    quantity: i64,
    al_amount: i64,
    memo: &str,
) -> String {
    let combined = format!(
        "{} {} {}",
        normalize_text(pattern),
        normalize_text(size_label),
        normalize_text(memo)
    );

    if combined.contains(&normalize_text("\u{C911}\u{ACE0}")) {
        return "used".to_string();
    }
    if combined.contains(&normalize_text("\u{D720}")) {
        return "wheel".to_string();
    }

    if quantity > 0 && (looks_like_tire_size_v2(size_label) || !pattern.trim().is_empty()) {
        return "tire".to_string();
    }

    if quantity <= 0 && al_amount > 0 {
        return "service".to_string();
    }

    if is_service_related_text(&combined) {
        return "service".to_string();
    }

    if looks_like_tire_size_v2(size_label)
        || (!pattern.trim().is_empty() && !size_label.trim().is_empty())
    {
        return "tire".to_string();
    }

    "other".to_string()
}

fn counts_toward_reported_quantity(line_type: &str) -> bool {
    line_type != "service"
}

fn is_service_related_text(normalized_text_value: &str) -> bool {
    let service_keywords = [
        "alignment",
        "\u{C5BC}\u{B77C}\u{C778}",
        "\u{C7A5}\u{CC29}",
        "\u{C624}\u{C77C}",
        "\u{D544}\u{D130}",
        "\u{AD50}\u{D658}",
        "\u{C815}\u{BE44}",
        "\u{BCF4}\u{AD00}",
        "\u{C218}\u{B9AC}",
    ];

    service_keywords
        .iter()
        .any(|keyword| normalized_text_value.contains(&normalize_text(keyword)))
}

fn is_alignment_related_row(row: &ParsedSaleRow) -> bool {
    let combined = format!(
        "{} {} {}",
        normalize_text(&row.pattern),
        normalize_text(&row.size_label),
        normalize_text(&row.memo)
    );
    combined.contains("alignment") || combined.contains(&normalize_text("\u{C5BC}\u{B77C}\u{C778}"))
}

fn imported_sale_total(row: &ParsedSaleRow) -> i64 {
    if row.total_amount > 0 {
        row.total_amount
    } else if row.card_amount != 0 || row.cash_amount != 0 {
        row.card_amount + row.cash_amount
    } else {
        row.al_amount.max(0)
    }
}

fn imported_card_amount(row: &ParsedSaleRow) -> i64 {
    if imported_is_naver_payment(row) {
        0
    } else {
        row.card_amount.max(0)
    }
}

fn imported_naver_amount(row: &ParsedSaleRow) -> i64 {
    if imported_is_naver_payment(row) {
        row.card_amount.max(0)
    } else {
        0
    }
}

fn imported_is_naver_payment(row: &ParsedSaleRow) -> bool {
    let normalized_memo = normalize_text(&row.memo);
    let normalized_pattern = normalize_text(&row.pattern);
    let combined = format!("{} {}", normalized_pattern, normalized_memo);

    combined.contains(&normalize_text("네이버")) || combined.contains("naver")
}

fn imported_card_fee_rate_basis_points(row: &ParsedSaleRow) -> i64 {
    if imported_is_naver_payment(row) {
        500
    } else if row.card_amount > 0 {
        300
    } else {
        0
    }
}

fn restored_alignment_amount(row: &ParsedSaleRow, sale_total: i64) -> i64 {
    row.al_amount.max(0).min(sale_total.max(0))
}

fn alignment_service_label() -> String {
    "alignment".to_string()
}

fn generic_service_label() -> String {
    "service".to_string()
}

fn imported_item_snapshot_name(row: &ParsedSaleRow) -> String {
    if row.pattern.is_empty() {
        if row.memo.is_empty() {
            row.line_type.clone()
        } else {
            row.memo.clone()
        }
    } else {
        row.pattern.clone()
    }
}

fn imported_work_type(row: &ParsedSaleRow) -> String {
    if row.size_label.is_empty() {
        if row.pattern.is_empty() {
            row.line_type.clone()
        } else {
            row.pattern.clone()
        }
    } else {
        row.size_label.clone()
    }
}

fn build_import_sale_line_seeds(
    row: &ParsedSaleRow,
    matched_item: Option<ItemLookupEntry>,
    sale_total: i64,
) -> Vec<ImportSaleLineSeed> {
    let alignment_amount = restored_alignment_amount(row, sale_total);
    let primary_line_total = sale_total.saturating_sub(alignment_amount);
    let mut lines = Vec::new();
    let should_skip_primary_service_line =
        row.line_type == "service" && alignment_amount > 0 && primary_line_total == 0;

    if !should_skip_primary_service_line {
        let primary_line_name = if row.line_type == "service"
            && alignment_amount > 0
            && is_alignment_related_row(row)
            && primary_line_total > 0
        {
            generic_service_label()
        } else {
            imported_item_snapshot_name(row)
        };

        let primary_work_size = if row.line_type == "service"
            && alignment_amount > 0
            && is_alignment_related_row(row)
            && primary_line_total > 0
        {
            String::new()
        } else {
            row.size_label.clone()
        };

        lines.push(ImportSaleLineSeed {
            line_type: row.line_type.clone(),
            item_id: if row.line_type == "tire" {
                matched_item.map(|entry| entry.item_id)
            } else {
                None
            },
            item_snapshot_name: primary_line_name,
            size_snapshot: primary_work_size,
            cost_price_snapshot: if row.line_type == "tire" {
                matched_item.map(|entry| entry.default_cost_price)
            } else {
                None
            },
            quantity: row.quantity,
            line_total: primary_line_total,
            memo: row.memo.clone(),
        });
    }

    if alignment_amount > 0 {
        lines.push(ImportSaleLineSeed {
            line_type: "service".to_string(),
            item_id: None,
            item_snapshot_name: alignment_service_label(),
            size_snapshot: String::new(),
            cost_price_snapshot: None,
            quantity: 1,
            line_total: alignment_amount,
            memo: row.memo.clone(),
        });
    }

    lines
}

fn build_import_work_log_seeds(row: &ParsedSaleRow, sale_total: i64) -> Vec<ImportWorkLogSeed> {
    let alignment_amount = restored_alignment_amount(row, sale_total);
    let primary_line_total = sale_total.saturating_sub(alignment_amount);
    let mut logs = Vec::new();

    if row.line_type != "tire" && primary_line_total > 0 {
        let work_type = if row.line_type == "service"
            && alignment_amount > 0
            && is_alignment_related_row(row)
        {
            generic_service_label()
        } else {
            imported_work_type(row)
        };
        logs.push(ImportWorkLogSeed {
            work_type,
            amount: primary_line_total,
            memo: row.memo.clone(),
        });
    }

    if alignment_amount > 0 {
        logs.push(ImportWorkLogSeed {
            work_type: alignment_service_label(),
            amount: alignment_amount,
            memo: row.memo.clone(),
        });
    }

    logs
}

#[allow(dead_code)]
fn detect_line_type(pattern: &str, size_label: &str, memo: &str) -> String {
    let combined = format!(
        "{} {} {}",
        normalize_text(pattern),
        normalize_text(size_label),
        normalize_text(memo)
    );

    if combined.contains("중고") {
        return "used".to_string();
    }
    if combined.contains("휠") {
        return "wheel".to_string();
    }

    let service_keywords = [
        "장착",
        "얼라이",
        "alignment",
        "오일",
        "필터",
        "패드",
        "교체",
        "정비",
        "위치교환",
        "보관",
        "수리",
    ];

    if service_keywords
        .iter()
        .any(|keyword| combined.contains(keyword))
    {
        return "service".to_string();
    }

    if looks_like_tire_size(size_label)
        || (!pattern.trim().is_empty() && !size_label.trim().is_empty())
    {
        return "tire".to_string();
    }

    "other".to_string()
}

fn looks_like_tire_size_v2(raw: &str) -> bool {
    !normalize_size_value(raw).normalized_size.is_empty()
}

#[allow(dead_code)]
fn looks_like_tire_size(raw: &str) -> bool {
    raw.chars().filter(|ch| ch.is_ascii_digit()).count() >= 5
}

fn extract_date(date_label: &str, fallback_sheet_name: &str) -> String {
    let digits = date_label
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if digits.len() >= 3 {
        return format!(
            "{:04}-{:02}-{:02}",
            parse_year(digits[0]),
            digits[1].parse::<u32>().unwrap_or(1),
            digits[2].parse::<u32>().unwrap_or(1)
        );
    }

    let fallback_day = fallback_sheet_name
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>()
        .parse::<u32>()
        .unwrap_or(1);
    format!("2026-03-{fallback_day:02}")
}

fn parse_year(raw: &str) -> i32 {
    let parsed = raw.parse::<i32>().unwrap_or(2026);
    if parsed < 100 {
        2000 + parsed
    } else {
        parsed
    }
}

fn is_day_sheet_v2(sheet_name: &str) -> bool {
    sheet_name.ends_with("\u{C77C}")
        && sheet_name
            .chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false)
}

#[allow(dead_code)]
fn is_day_sheet(sheet_name: &str) -> bool {
    sheet_name.ends_with('일')
        && sheet_name
            .chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false)
}

fn collect_aliases(raw: &str) -> Vec<String> {
    let cleaned = raw.replace(['\r', '\n'], " ").trim().to_string();
    if cleaned.is_empty() {
        return Vec::new();
    }

    let mut aliases = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    push_alias(&mut aliases, &mut seen, cleaned.clone());

    let mut current = String::new();
    let mut inside_parentheses = false;
    for ch in cleaned.chars() {
        match ch {
            '(' => {
                inside_parentheses = true;
                current.clear();
            }
            ')' => {
                if inside_parentheses {
                    push_alias(&mut aliases, &mut seen, current.clone());
                }
                inside_parentheses = false;
                current.clear();
            }
            _ => {
                if inside_parentheses {
                    current.push(ch);
                }
            }
        }
    }

    for token in cleaned
        .split(|ch: char| ch == ',' || ch == '/' || ch == ' ')
        .map(str::trim)
        .filter(|token| token.len() >= 2)
    {
        push_alias(&mut aliases, &mut seen, token.to_string());
    }

    aliases
}

fn push_alias(aliases: &mut Vec<String>, seen: &mut HashSet<String>, alias: String) {
    let trimmed = alias.trim();
    if trimmed.is_empty() {
        return;
    }

    let normalized = normalize_text(trimmed);
    if normalized.is_empty() || !seen.insert(normalized) {
        return;
    }

    aliases.push(trimmed.to_string());
}

fn normalize_text(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || ('가'..='힣').contains(ch))
        .collect()
}

fn normalize_phone(raw: &str) -> String {
    raw.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

fn normalize_plate(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_ascii_digit() || ('가'..='힣').contains(ch))
        .collect()
}

fn copy_workbook_to_temp_path(path: &str) -> Result<PathBuf, String> {
    let source_path = Path::new(path);
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("xlsx");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temp_path = std::env::temp_dir().join(format!(
        "tire-store-import-{}-{timestamp}.{extension}",
        std::process::id()
    ));
    fs::copy(source_path, &temp_path).map_err(|error| error.to_string())?;
    Ok(temp_path)
}

fn with_open_workbook<T, F>(path: &str, action: F) -> Result<T, String>
where
    F: FnOnce(&mut calamine::Sheets<std::io::BufReader<std::fs::File>>) -> Result<T, String>,
{
    match open_workbook_auto(path) {
        Ok(mut workbook) => action(&mut workbook),
        Err(primary_error) => {
            let temp_path = copy_workbook_to_temp_path(path)
                .map_err(|copy_error| format!("{primary_error}; temp copy failed: {copy_error}"))?;
            let mut workbook = open_workbook_auto(&temp_path)
                .map_err(|error| format!("{primary_error}; temp copy retry failed: {error}"))?;
            let result = action(&mut workbook);
            drop(workbook);
            let _ = fs::remove_file(&temp_path);
            result
        }
    }
}

fn parse_money_won(raw: &str) -> i64 {
    parse_decimal(raw).round() as i64
}

fn parse_money_thousand_won(raw: &str) -> i64 {
    (parse_decimal(raw) * 1000.0).round() as i64
}

fn parse_number(raw: &str) -> i64 {
    let cleaned = raw
        .trim()
        .replace(',', "")
        .replace(".00", "")
        .replace(' ', "");

    if cleaned.is_empty() || cleaned == "-" {
        return 0;
    }

    if let Ok(number) = cleaned.parse::<i64>() {
        return number;
    }

    cleaned.parse::<f64>().unwrap_or(0.0).round() as i64
}

fn parse_decimal(raw: &str) -> f64 {
    let cleaned = raw
        .trim()
        .replace(',', "")
        .replace(' ', "")
        .replace("\u{C6D0}", "");

    if cleaned.is_empty() || cleaned == "-" {
        return 0.0;
    }

    cleaned.parse::<f64>().unwrap_or(0.0)
}

fn cell_string(cell: Option<&Data>) -> String {
    match cell {
        Some(Data::String(value)) => value.trim().to_string(),
        Some(Data::Float(value)) => {
            if value.fract() == 0.0 {
                format!("{}", *value as i64)
            } else {
                value.to_string()
            }
        }
        Some(Data::Int(value)) => value.to_string(),
        Some(Data::Bool(value)) => {
            if *value {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        Some(Data::DateTime(value)) => value.to_string(),
        Some(Data::DateTimeIso(value)) => value.to_string(),
        Some(Data::DurationIso(value)) => value.to_string(),
        Some(Data::Error(_)) | Some(Data::Empty) | None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_schema, apply_vendor_price_workbook_into_pool,
        backfill_missing_sale_line_cost_snapshots, classify_line_type, import_into_pool,
        imported_sale_total, is_card_fee_note, is_non_sale_memo_row, normalize_plate,
        normalize_size_value, normalize_text, parse_inventory_workbook_impl,
        parse_money_thousand_won, parse_sales_workbook_impl, should_import_daily_expense_summary,
        InventorySeedItem, ParsedInventoryWorkbook, ParsedSaleRow, ParsedSalesWorkbook,
        VendorPriceRow, VendorPriceWorkbookData,
    };
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::{Row, SqlitePool};
    use std::fs;
    use std::path::PathBuf;
    use std::str::FromStr;
    use tauri::async_runtime::block_on;

    fn downloads_dir() -> PathBuf {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Users\h19h2"))
            .join("Downloads")
    }

    fn find_download_sample_path(keyword: &str) -> Option<PathBuf> {
        let mut matches = fs::read_dir(downloads_dir())
            .ok()?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let path = entry.path();
                let file_name = path.file_name()?.to_string_lossy().to_string();
                let is_match = path
                    .extension()
                    .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("xlsx"))
                    .unwrap_or(false)
                    && !file_name.starts_with("~$")
                    && file_name.contains(keyword)
                    && file_name.contains("\u{C5F0}\u{B3D9}");
                if !is_match {
                    return None;
                }

                let modified = entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .unwrap_or(std::time::UNIX_EPOCH);
                Some((path, modified))
            })
            .collect::<Vec<_>>();
        matches.sort_by_key(|(_, modified)| *modified);
        matches.pop().map(|(path, _)| path)
    }

    fn sample_inventory_path() -> Option<PathBuf> {
        find_download_sample_path("\u{C7AC}\u{ACE0}\u{AD00}\u{B9AC}")
    }

    fn sample_sales_path() -> Option<PathBuf> {
        find_download_sample_path("\u{D310}\u{B9E4}\u{C77C}\u{BCF4}")
    }

    fn empty_inventory_workbook() -> ParsedInventoryWorkbook {
        ParsedInventoryWorkbook {
            source_path: "inventory-test.xlsx".to_string(),
            inventory_sheet: "inventory".to_string(),
            price_sheet: "price".to_string(),
            customer_sheet: None,
            item_count: 0,
            customer_seed_count: 0,
            historical_sale_count: 0,
            historical_service_count: 0,
            customer_seeds: Vec::new(),
            historical_sales: Vec::new(),
            items: Vec::new(),
        }
    }

    fn inventory_workbook_with_matching_item(default_cost_price: i64) -> ParsedInventoryWorkbook {
        let row = sample_tire_row_with_alignment();
        ParsedInventoryWorkbook {
            source_path: "inventory-test.xlsx".to_string(),
            inventory_sheet: "inventory".to_string(),
            price_sheet: "price".to_string(),
            customer_sheet: None,
            item_count: 1,
            customer_seed_count: 0,
            historical_sale_count: 0,
            historical_service_count: 0,
            customer_seeds: Vec::new(),
            historical_sales: Vec::new(),
            items: vec![InventorySeedItem {
                sku_code: format!("brand__pattern__{}", row.normalized_size),
                brand_name: "브랜드".to_string(),
                pattern_name: row.pattern.clone(),
                size_label: row.size_label.clone(),
                product_name: "테스트".to_string(),
                normalized_brand: normalize_text("브랜드"),
                normalized_pattern: row.normalized_pattern,
                normalized_size: row.normalized_size,
                default_cost_price,
                default_sale_price: 300_000,
                quantity_on_hand: 10,
                aliases: Vec::new(),
                size_search_tokens: Vec::new(),
            }],
        }
    }

    fn temp_db_path(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!("{prefix}-{}.db", std::process::id()))
    }

    fn sample_tire_row_with_alignment() -> ParsedSaleRow {
        let size = normalize_size_value("2454019");
        ParsedSaleRow {
            sale_number: "IMP-20260302-001".to_string(),
            sold_at: "2026-03-02".to_string(),
            day_label: "2일".to_string(),
            row_number: 3,
            phone: String::new(),
            normalized_phone: String::new(),
            vehicle_model: "IG".to_string(),
            plate_number: "152러3651".to_string(),
            normalized_plate_number: normalize_plate("152러3651"),
            pattern: "투어AS".to_string(),
            normalized_pattern: normalize_text("투어AS"),
            size_label: size.size_label,
            normalized_size: size.normalized_size,
            quantity: 4,
            al_amount: 40_000,
            total_amount: 1_040_000,
            card_amount: 0,
            cash_amount: 1_040_000,
            memo: "패드70".to_string(),
            line_type: "tire".to_string(),
        }
    }

    fn sample_day_summary_with_expense() -> super::ParsedSalesDaySummary {
        super::ParsedSalesDaySummary {
            day_label: "2일".to_string(),
            sold_at: "2026-03-02".to_string(),
            parsed_tire_quantity: 4,
            reported_tire_quantity: 4,
            quantity_delta: 0,
            parsed_total_amount: 1_040_000,
            reported_total_amount: 1_040_000,
            amount_delta: 0,
            parsed_card_amount: 0,
            reported_card_amount: 0,
            card_delta: 0,
            parsed_cash_amount: 1_040_000,
            reported_cash_amount: 1_040_000,
            cash_delta: 0,
            expense_amount: 56_100,
            expense_note: "카드수수료".to_string(),
            removed_summary_row_number: Some(27),
        }
    }

    fn sample_day_summary_with_shop_expense() -> super::ParsedSalesDaySummary {
        super::ParsedSalesDaySummary {
            expense_amount: 22_000,
            expense_note: "외주 작업".to_string(),
            ..sample_day_summary_with_expense()
        }
    }

    #[test]
    fn parses_inventory_workbook_from_downloads_when_present() {
        let Some(path) = sample_inventory_path() else {
            return;
        };
        let parsed = parse_inventory_workbook_impl(&path.display().to_string())
            .expect("inventory workbook should parse");
        assert!(parsed.item_count > 100);
    }

    #[test]
    fn parses_sales_workbook_from_downloads_when_present() {
        let Some(path) = sample_sales_path() else {
            return;
        };
        let parsed = parse_sales_workbook_impl(&path.display().to_string())
            .expect("sales workbook should parse");
        assert!(parsed.row_count > 10);
    }

    #[test]
    fn parses_daily_expense_rows_from_sales_workbook_when_present() {
        let Some(path) = sample_sales_path() else {
            return;
        };

        let parsed = parse_sales_workbook_impl(&path.display().to_string())
            .expect("sales workbook should parse");

        assert!(parsed
            .day_summaries
            .iter()
            .all(|summary| summary.expense_note.trim().is_empty()
                || !is_card_fee_note(&summary.expense_note)));
    }

    #[test]
    fn skips_card_fee_daily_expense_summaries_during_import() {
        assert!(is_card_fee_note("카드수수료"));
        assert!(!should_import_daily_expense_summary(
            &sample_day_summary_with_expense()
        ));
        assert!(should_import_daily_expense_summary(
            &sample_day_summary_with_shop_expense()
        ));
    }

    #[test]
    fn normalizes_money_and_size_for_import() {
        assert_eq!(parse_money_thousand_won("300"), 300_000);
        assert_eq!(parse_money_thousand_won("56.1"), 56_100);

        let normalized = normalize_size_value("255/45R19");
        assert_eq!(normalized.size_label, "255 45 19");
        assert_eq!(normalized.normalized_size, "2554519");
        assert!(normalized
            .search_tokens
            .iter()
            .any(|token| token == "25545r19"));
    }

    #[test]
    fn classifies_alignment_only_rows_as_service_and_skips_memo_only_rows() {
        assert_eq!(classify_line_type("", "", 0, 40_000, ""), "service");
        assert!(is_non_sale_memo_row(
            "",
            "",
            "",
            "",
            "",
            0,
            0,
            0,
            0,
            0,
            "메모만 있는 행"
        ));

        let alignment_only_row = ParsedSaleRow {
            sale_number: "IMP-20260306-001".to_string(),
            sold_at: "2026-03-06".to_string(),
            day_label: "6일".to_string(),
            row_number: 3,
            phone: String::new(),
            normalized_phone: String::new(),
            vehicle_model: "루비콘".to_string(),
            plate_number: "389무6003".to_string(),
            normalized_plate_number: normalize_plate("389무6003"),
            pattern: String::new(),
            normalized_pattern: String::new(),
            size_label: "얼라이".to_string(),
            normalized_size: String::new(),
            quantity: 0,
            al_amount: 40_000,
            total_amount: 0,
            card_amount: 0,
            cash_amount: 0,
            memo: String::new(),
            line_type: "service".to_string(),
        };
        assert_eq!(imported_sale_total(&alignment_only_row), 40_000);
    }

    #[test]
    fn imports_alignment_amount_as_separate_service_records() {
        block_on(async {
            let sales = ParsedSalesWorkbook {
                source_path: "sales-test.xlsx".to_string(),
                row_count: 1,
                tire_line_count: 1,
                service_line_count: 0,
                day_summaries: vec![sample_day_summary_with_expense()],
                rows: vec![sample_tire_row_with_alignment()],
            };

            let temp_db_path = temp_db_path("tire-store-alignment-split-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            let result = import_into_pool(&pool, &empty_inventory_workbook(), &sales)
                .await
                .expect("import");
            assert_eq!(result.sales_count, 1);
            assert_eq!(result.unmatched_tire_lines, 1);

            let sale_row = sqlx::query(
                "SELECT total_amount, card_amount, cash_amount FROM sales ORDER BY id LIMIT 1",
            )
            .fetch_one(&pool)
            .await
            .expect("sale row");
            assert_eq!(sale_row.get::<i64, _>("total_amount"), 1_040_000);
            assert_eq!(sale_row.get::<i64, _>("card_amount"), 0);
            assert_eq!(sale_row.get::<i64, _>("cash_amount"), 1_040_000);

            let sale_lines = sqlx::query(
        "SELECT line_type, quantity, line_total, item_snapshot_name, size_snapshot FROM sale_lines ORDER BY id",
      )
      .fetch_all(&pool)
      .await
      .expect("sale lines");
            assert_eq!(sale_lines.len(), 2);
            assert_eq!(sale_lines[0].get::<String, _>("line_type"), "tire");
            assert_eq!(sale_lines[0].get::<i64, _>("quantity"), 4);
            assert_eq!(sale_lines[0].get::<i64, _>("line_total"), 1_000_000);
            assert_eq!(sale_lines[1].get::<String, _>("line_type"), "service");
            assert_eq!(sale_lines[1].get::<i64, _>("quantity"), 1);
            assert_eq!(sale_lines[1].get::<i64, _>("line_total"), 40_000);
            assert_eq!(
                sale_lines[1].get::<String, _>("item_snapshot_name"),
                "alignment"
            );

            let work_logs = sqlx::query("SELECT work_type, amount FROM work_logs ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("work logs");
            assert_eq!(work_logs.len(), 1);
            assert_eq!(work_logs[0].get::<String, _>("work_type"), "alignment");
            assert_eq!(work_logs[0].get::<i64, _>("amount"), 40_000);

            let daily_expenses = sqlx::query(
                "SELECT expense_date, amount, note FROM daily_expenses ORDER BY expense_date",
            )
            .fetch_all(&pool)
            .await
            .expect("daily expenses");
            assert_eq!(daily_expenses.len(), 0);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn imports_non_card_fee_daily_expense_rows() {
        block_on(async {
            let sales = ParsedSalesWorkbook {
                source_path: "sales-test.xlsx".to_string(),
                row_count: 1,
                tire_line_count: 1,
                service_line_count: 0,
                day_summaries: vec![sample_day_summary_with_shop_expense()],
                rows: vec![sample_tire_row_with_alignment()],
            };

            let temp_db_path = temp_db_path("tire-store-daily-expense-import-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            import_into_pool(&pool, &empty_inventory_workbook(), &sales)
                .await
                .expect("import");

            let daily_expenses = sqlx::query(
                "SELECT expense_date, amount, note FROM daily_expenses ORDER BY expense_date",
            )
            .fetch_all(&pool)
            .await
            .expect("daily expenses");
            assert_eq!(daily_expenses.len(), 1);
            assert_eq!(
                daily_expenses[0].get::<String, _>("expense_date"),
                "2026-03-02"
            );
            assert_eq!(daily_expenses[0].get::<i64, _>("amount"), 22_000);
            assert_eq!(daily_expenses[0].get::<String, _>("note"), "외주 작업");

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn imports_cost_snapshot_for_matched_tire_lines() {
        block_on(async {
            let inventory = inventory_workbook_with_matching_item(180_000);
            let sales = ParsedSalesWorkbook {
                source_path: "sales-test.xlsx".to_string(),
                row_count: 1,
                tire_line_count: 1,
                service_line_count: 0,
                day_summaries: Vec::new(),
                rows: vec![sample_tire_row_with_alignment()],
            };

            let temp_db_path = temp_db_path("tire-store-cost-snapshot-import-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            let result = import_into_pool(&pool, &inventory, &sales)
                .await
                .expect("import");
            assert_eq!(result.unmatched_tire_lines, 0);

            let sale_lines = sqlx::query(
        "SELECT line_type, cost_price_snapshot FROM sale_lines WHERE line_type = 'tire' ORDER BY id LIMIT 1",
      )
      .fetch_one(&pool)
      .await
      .expect("tire sale line");
            assert_eq!(sale_lines.get::<String, _>("line_type"), "tire");
            assert_eq!(sale_lines.get::<i64, _>("cost_price_snapshot"), 180_000);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn applies_vendor_price_updates_to_matching_inventory_items() {
        block_on(async {
            let temp_db_path = temp_db_path("tire-store-vendor-price-apply-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            sqlx::query(
        "INSERT INTO items (sku_code, brand_name, pattern_name, size_label, normalized_brand, normalized_pattern, normalized_size, product_name, default_cost_price, default_sale_price, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      )
      .bind("hankook__ta91__2654020")
      .bind("한국")
      .bind("TA91")
      .bind("265 40 20")
      .bind(normalize_text("한국"))
      .bind(normalize_text("TA91"))
      .bind("2654020")
      .bind("테스트")
      .bind(180_000i64)
      .bind(320_000i64)
      .execute(&pool)
      .await
      .expect("insert item");

            let item_row = sqlx::query("SELECT id FROM items ORDER BY id DESC LIMIT 1")
                .fetch_one(&pool)
                .await
                .expect("item id");
            let item_id = item_row.get::<i64, _>("id");

            let parsed = VendorPriceWorkbookData {
                source_path: "vendor-price-test.xlsx".to_string(),
                sheet_name: "Sheet1".to_string(),
                detected_brand_name: "한국".to_string(),
                price_column_label: "부가세 포함".to_string(),
                rows: vec![VendorPriceRow {
                    row_number: 2,
                    brand_name: "한국".to_string(),
                    normalized_brand: normalize_text("한국"),
                    product_name: "TA91".to_string(),
                    pattern_code: "TA91".to_string(),
                    size_label: "265 40 20".to_string(),
                    normalized_size: "2654020".to_string(),
                    price_vat_included: 245_000,
                }],
            };

            let result = apply_vendor_price_workbook_into_pool(&pool, &parsed)
                .await
                .expect("vendor price apply");
            assert_eq!(result.updated_item_count, 1);
            assert_eq!(result.updated_row_count, 1);

            let updated_item = sqlx::query("SELECT default_cost_price FROM items WHERE id = ?")
                .bind(item_id)
                .fetch_one(&pool)
                .await
                .expect("updated item");
            assert_eq!(updated_item.get::<i64, _>("default_cost_price"), 245_000);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn apply_schema_removes_legacy_duplicate_item_rules() {
        block_on(async {
            let temp_db_path = temp_db_path("tire-store-legacy-duplicate-rule-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");

            apply_schema(&pool).await.expect("initial schema");

            sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_items_legacy_duplicate_rule ON items(normalized_brand, normalized_pattern, normalized_size)",
      )
      .execute(&pool)
      .await
      .expect("legacy unique index");

            sqlx::query(
                r#"
        CREATE TRIGGER IF NOT EXISTS trg_items_legacy_duplicate_rule
        BEFORE INSERT ON items
        WHEN EXISTS (
          SELECT 1
          FROM items
          WHERE normalized_brand = NEW.normalized_brand
            AND normalized_pattern = NEW.normalized_pattern
            AND normalized_size = NEW.normalized_size
        )
        BEGIN
          SELECT RAISE(ABORT, '이미 등록된 규격은 있습니다.');
        END
        "#,
            )
            .execute(&pool)
            .await
            .expect("legacy trigger");

            apply_schema(&pool).await.expect("schema cleanup");

            let index_rows = sqlx::query("PRAGMA index_list(items)")
                .fetch_all(&pool)
                .await
                .expect("index list");
            let legacy_index_exists = index_rows.iter().any(|row| {
                row.try_get::<String, _>("name")
                    .map(|name| name == "idx_items_legacy_duplicate_rule")
                    .unwrap_or(false)
            });
            assert!(!legacy_index_exists);

            let trigger_rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_items_legacy_duplicate_rule'",
      )
      .fetch_all(&pool)
      .await
      .expect("trigger rows");
            assert!(trigger_rows.is_empty());

            sqlx::query(
        "INSERT INTO items (sku_code, brand_name, pattern_name, size_label, normalized_brand, normalized_pattern, normalized_size, product_name, default_cost_price, default_sale_price, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      )
      .bind("금호__ta91__2654020")
      .bind("금호")
      .bind("TA91")
      .bind("265 40 20")
      .bind(normalize_text("금호"))
      .bind(normalize_text("TA91"))
      .bind("2654020")
      .bind("기존품목")
      .bind(180_000i64)
      .bind(320_000i64)
      .execute(&pool)
      .await
      .expect("insert base item");

            sqlx::query(
        "INSERT INTO items (sku_code, brand_name, pattern_name, size_label, normalized_brand, normalized_pattern, normalized_size, product_name, default_cost_price, default_sale_price, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      )
      .bind("금호__ta91__2654020__dup2")
      .bind("금호")
      .bind("TA91")
      .bind("265 40 20")
      .bind(normalize_text("금호"))
      .bind(normalize_text("TA91"))
      .bind("2654020")
      .bind("변형품목")
      .bind(245_000i64)
      .bind(360_000i64)
      .execute(&pool)
      .await
      .expect("insert duplicate-sized variant");

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn backfills_missing_cost_snapshots_from_items() {
        block_on(async {
            let temp_db_path = temp_db_path("tire-store-cost-snapshot-backfill-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            sqlx::query(
        "INSERT INTO items (sku_code, brand_name, pattern_name, size_label, normalized_brand, normalized_pattern, normalized_size, product_name, default_cost_price, default_sale_price, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      )
      .bind("brand__pattern__2454019")
      .bind("브랜드")
      .bind("타이어AS")
      .bind("245 40 19")
      .bind(normalize_text("브랜드"))
      .bind(normalize_text("타이어AS"))
      .bind("2454019")
      .bind("테스트")
      .bind(190_000i64)
      .bind(320_000i64)
      .execute(&pool)
      .await
      .expect("insert item");

            let item_row = sqlx::query("SELECT id FROM items ORDER BY id DESC LIMIT 1")
                .fetch_one(&pool)
                .await
                .expect("item id");
            let item_id = item_row.get::<i64, _>("id");

            sqlx::query(
        "INSERT INTO sales (sale_number, sold_at, total_amount, card_amount, cash_amount, memo) VALUES (?, ?, ?, ?, ?, '')",
      )
      .bind("SAL-BACKFILL-1")
      .bind("2026-03-12 09:00:00")
      .bind(320_000i64)
      .bind(320_000i64)
      .bind(0i64)
      .execute(&pool)
      .await
      .expect("insert sale");

            let sale_row = sqlx::query("SELECT id FROM sales ORDER BY id DESC LIMIT 1")
                .fetch_one(&pool)
                .await
                .expect("sale id");
            let sale_id = sale_row.get::<i64, _>("id");

            sqlx::query(
        "INSERT INTO sale_lines (sale_id, line_type, item_id, item_snapshot_name, size_snapshot, cost_price_snapshot, quantity, unit_price, line_total, memo) VALUES (?, 'tire', ?, '타이어AS', '245 40 19', NULL, 1, 320000, 320000, '')",
      )
      .bind(sale_id)
      .bind(item_id)
      .execute(&pool)
      .await
      .expect("insert sale line");

            let updated = backfill_missing_sale_line_cost_snapshots(&pool)
                .await
                .expect("backfill");
            assert_eq!(updated, 1);

            let sale_line_row =
                sqlx::query("SELECT cost_price_snapshot FROM sale_lines ORDER BY id DESC LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .expect("sale line");
            assert_eq!(sale_line_row.get::<i64, _>("cost_price_snapshot"), 190_000);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn sales_day_summaries_match_reported_totals_when_sample_exists() {
        let Some(path) = sample_sales_path() else {
            return;
        };
        let parsed = parse_sales_workbook_impl(&path.display().to_string())
            .expect("sales workbook should parse");
        let reported_days = parsed
            .day_summaries
            .iter()
            .filter(|summary| {
                summary.reported_total_amount > 0 || summary.reported_tire_quantity > 0
            })
            .collect::<Vec<_>>();

        assert!(!reported_days.is_empty());
        assert!(reported_days
            .iter()
            .all(|summary| summary.removed_summary_row_number.is_some()));
        let mismatches = reported_days
            .iter()
            .filter(|summary| {
                summary.quantity_delta != 0
                    || summary.amount_delta != 0
                    || summary.card_delta != 0
                    || summary.cash_delta != 0
            })
            .map(|summary| {
                format!(
                    "{} q={} a={} c={} h={}",
                    summary.day_label,
                    summary.quantity_delta,
                    summary.amount_delta,
                    summary.card_delta,
                    summary.cash_delta
                )
            })
            .collect::<Vec<_>>();
        assert!(mismatches.is_empty(), "{}", mismatches.join(", "));
    }

    #[test]
    fn imports_alignment_totals_into_service_lines_when_sample_files_exist() {
        let (Some(inventory_path), Some(sales_path)) =
            (sample_inventory_path(), sample_sales_path())
        else {
            return;
        };

        block_on(async {
            let inventory = parse_inventory_workbook_impl(&inventory_path.display().to_string())
                .expect("inventory");
            let sales =
                parse_sales_workbook_impl(&sales_path.display().to_string()).expect("sales");
            let expected_alignment_total = sales
                .rows
                .iter()
                .chain(inventory.historical_sales.iter())
                .map(|row| row.al_amount.max(0).min(imported_sale_total(row).max(0)))
                .sum::<i64>();

            let temp_db_path = temp_db_path("tire-store-alignment-sample-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            import_into_pool(&pool, &inventory, &sales)
                .await
                .expect("import");

            let work_log_row = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM work_logs WHERE LOWER(work_type) LIKE '%alignment%'",
      )
      .fetch_one(&pool)
      .await
      .expect("alignment work logs");
            let sale_line_row = sqlx::query(
        "SELECT COALESCE(SUM(line_total), 0) AS total FROM sale_lines WHERE line_type = 'service' AND LOWER(item_snapshot_name) LIKE '%alignment%'",
      )
      .fetch_one(&pool)
      .await
      .expect("alignment sale lines");

            let work_log_total = work_log_row.get::<i64, _>("total");
            let sale_line_total = sale_line_row.get::<i64, _>("total");

            assert!(expected_alignment_total > 0);
            assert!(work_log_total > 0);
            assert_eq!(sale_line_total, work_log_total);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn imports_into_temp_db_when_sample_files_exist() {
        let (Some(inventory_path), Some(sales_path)) =
            (sample_inventory_path(), sample_sales_path())
        else {
            return;
        };

        block_on(async {
            let inventory = parse_inventory_workbook_impl(&inventory_path.display().to_string())
                .expect("inventory");
            let sales =
                parse_sales_workbook_impl(&sales_path.display().to_string()).expect("sales");

            let temp_db_path = temp_db_path("tire-store-import-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");
            apply_schema(&pool).await.expect("schema");

            let result = import_into_pool(&pool, &inventory, &sales)
                .await
                .expect("import");
            assert!(result.item_count > 100);
            assert!(result.customer_seed_count > 0);
            assert!(result.sales_count > 10);
            assert_eq!(result.sales_validation_issue_count, 0);

            let row = sqlx::query("SELECT COUNT(*) AS count FROM items")
                .fetch_one(&pool)
                .await
                .expect("count");
            let count: i64 = row.get("count");
            assert!(count > 100);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }

    #[test]
    fn apply_schema_is_idempotent() {
        block_on(async {
            let temp_db_path = temp_db_path("tire-store-schema-test");
            if temp_db_path.exists() {
                let _ = std::fs::remove_file(&temp_db_path);
            }

            let options = SqliteConnectOptions::from_str(&temp_db_path.display().to_string())
                .expect("options")
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.expect("pool");

            apply_schema(&pool).await.expect("first schema apply");
            apply_schema(&pool).await.expect("second schema apply");

            let row = sqlx::query("PRAGMA table_info(vehicles)")
                .fetch_all(&pool)
                .await
                .expect("table info");
            assert!(row.len() >= 8);

            let dashboard_row = sqlx::query("PRAGMA table_info(daily_expenses)")
                .fetch_all(&pool)
                .await
                .expect("daily expenses info");
            assert!(dashboard_row.len() >= 4);

            pool.close().await;
            let _ = std::fs::remove_file(&temp_db_path);
        });
    }
}
