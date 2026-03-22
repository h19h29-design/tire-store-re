# Tire Store Implementation Plan

## Goal

Build a Windows desktop app that replaces the Excel-based workflow for:

- sales entry
- inventory tracking
- pricing
- customer and vehicle history
- local backup and restore

The first release is single-PC and offline-first.

## Technical Decisions

- Desktop shell: Tauri 2
- Frontend: React + TypeScript + Vite
- Local DB: SQLite
- Search: SQLite FTS5
- Validation/forms: Zod + React Hook Form
- Local app state: Zustand
- Packaging: NSIS setup exe

## Delivery Order

1. Project scaffold and folder structure
2. Database schema and migrations
3. Excel import pipeline
4. Product / stock / pricing screens
5. Sales flow with automatic stock deduction
6. Customer / vehicle / work history
7. Backup / restore
8. Reporting and Excel export

## Migration Strategy

The Excel files are treated as seed data.

- `재고관리.xlsx` seeds product master, price, and opening stock.
- `판매일보.xlsx` seeds historical sales and work logs.
- alias rules are created while importing inconsistent names.

## Product Ideas Worth Keeping

- keyboard-first selling flow
- recent-item shortcuts
- product alias dictionary
- soft delete with audit history
- Excel-style report exports for transition comfort
