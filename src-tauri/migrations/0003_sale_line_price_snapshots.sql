ALTER TABLE sale_lines ADD COLUMN sale_base_price_snapshot INTEGER;
ALTER TABLE sale_lines ADD COLUMN sale_discount_rate_snapshot REAL;
ALTER TABLE sale_lines ADD COLUMN discounted_unit_price_snapshot INTEGER;
