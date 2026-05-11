use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:tire-store.db";

pub fn migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create_core_tables",
      sql: include_str!("../migrations/0001_initial.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "add_reference_data",
      sql: include_str!("../migrations/0002_reference_data.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "add_sale_line_price_snapshots",
      sql: include_str!("../migrations/0003_sale_line_price_snapshots.sql"),
      kind: MigrationKind::Up,
    },
  ]
}
