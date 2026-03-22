# Database Draft

## Core Tables

### items

- id
- sku_code
- brand_name
- pattern_name
- size_label
- search_text
- default_cost_price
- default_sale_price
- is_active
- created_at
- updated_at

### item_aliases

- id
- item_id
- alias_type
- alias_value
- normalized_alias

### inventory_movements

- id
- item_id
- movement_type
- quantity
- unit_cost
- unit_price
- occurred_at
- reference_type
- reference_id
- memo

### inventory_balance_cache

- item_id
- quantity_on_hand
- quantity_reserved
- quantity_available
- updated_at

### price_history

- id
- item_id
- cost_price
- sale_price
- effective_from
- memo

### customers

- id
- name
- phone
- memo
- created_at
- updated_at

### vehicles

- id
- customer_id
- plate_number
- model_name
- odometer
- memo

### sales

- id
- sale_number
- sold_at
- customer_id
- vehicle_id
- total_amount
- card_amount
- cash_amount
- memo

### sale_lines

- id
- sale_id
- line_type
- item_id
- item_snapshot_name
- size_snapshot
- quantity
- unit_price
- line_total
- memo

### work_logs

- id
- sale_id
- customer_id
- vehicle_id
- work_type
- amount
- memo
- worked_at

### imports

- id
- source_file
- imported_at
- status
- note

### backups

- id
- backup_path
- backup_type
- created_at
- note

### app_settings

- key
- value

## Excel Mapping

- `재고관리.xlsx / 가격` -> items, price_history
- `재고관리.xlsx / 26년03월` -> opening inventory movements, balance cache
- `재고관리.xlsx / 고객등록` -> customers, vehicles, historical notes
- `판매일보.xlsx / 1일~31일` -> sales, sale_lines, work_logs
