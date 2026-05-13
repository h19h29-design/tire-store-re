import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  DATA_CENTER_TABLES,
  DEFAULT_DATA_CENTER_TABLE_KEY,
  getDataCenterTableConfig,
  loadDataCenterTableSnapshot,
  loadDataCenterTableSummaries,
  type DataCenterCellValue,
  type DataCenterTableSnapshot,
  type DataCenterTableSummary,
} from './dataCenterService'

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]

function formatCellValue(value: DataCenterCellValue) {
  if (value === null || value === undefined) {
    return '-'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('ko-KR') : String(value)
  }

  return value
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '데이터를 불러오지 못했습니다.'
}

export function DataCenterPage() {
  const [summaries, setSummaries] = useState<DataCenterTableSummary[]>([])
  const [selectedTableKey, setSelectedTableKey] = useState(DEFAULT_DATA_CENTER_TABLE_KEY)
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(100)
  const [pageIndex, setPageIndex] = useState(0)
  const [snapshot, setSnapshot] = useState<DataCenterTableSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('데이터 센터를 준비하고 있습니다.')
  const deferredQuery = useDeferredValue(query)

  const selectedConfig = useMemo(() => getDataCenterTableConfig(selectedTableKey), [selectedTableKey])
  const selectedSummary = summaries.find((summary) => summary.key === selectedTableKey)
  const totalRows = snapshot?.rowCount ?? selectedSummary?.rowCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const currentPage = Math.min(pageIndex + 1, totalPages)
  const pageStart = totalRows === 0 ? 0 : pageIndex * pageSize + 1
  const pageEnd = Math.min(totalRows, pageIndex * pageSize + (snapshot?.rows.length ?? 0))

  useEffect(() => {
    let active = true

    async function loadSummaries() {
      try {
        const nextSummaries = await loadDataCenterTableSummaries()
        if (!active) {
          return
        }
        setSummaries(nextSummaries)
      } catch (error) {
        console.error(error)
        if (active) {
          setStatus(getErrorMessage(error))
        }
      }
    }

    void loadSummaries()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setPageIndex(0)
  }, [selectedTableKey, deferredQuery, pageSize])

  useEffect(() => {
    let active = true

    async function loadSnapshot() {
      try {
        setLoading(true)
        const nextSnapshot = await loadDataCenterTableSnapshot(selectedTableKey, {
          query: deferredQuery,
          limit: pageSize,
          offset: pageIndex * pageSize,
        })
        if (!active) {
          return
        }
        setSnapshot(nextSnapshot)
        setStatus(
          `${nextSnapshot.label} ${nextSnapshot.rowCount.toLocaleString('ko-KR')}건 중 ${nextSnapshot.rows.length.toLocaleString(
            'ko-KR',
          )}건을 표시 중입니다.`,
        )
      } catch (error) {
        console.error(error)
        if (active) {
          setSnapshot(null)
          setStatus(getErrorMessage(error))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadSnapshot()

    return () => {
      active = false
    }
  }, [deferredQuery, pageIndex, pageSize, selectedTableKey])

  return (
    <section className="page data-center-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">데이터 센터</p>
          <h2>DB 통합 조회</h2>
          <p className="page-copy">
            프로그램 안에 저장된 주요 DB 표를 엑셀처럼 읽기 전용으로 확인합니다. 큰 표는 페이지 단위로 나누어
            불러옵니다.
          </p>
        </div>
        <span className="status-pill">{status}</span>
      </header>

      <section className="panel data-center-control-panel">
        <div className="panel-header-inline">
          <div>
            <h3>표 선택</h3>
            <p className="page-copy">확인할 데이터 묶음을 선택하세요. 실제 DB 값은 여기서 수정하지 않습니다.</p>
          </div>
          <span className="data-center-count-pill">{DATA_CENTER_TABLES.length.toLocaleString('ko-KR')}개 표</span>
        </div>

        <div className="data-center-tab-grid">
          {DATA_CENTER_TABLES.map((table) => {
            const summary = summaries.find((item) => item.key === table.key)
            const isActive = table.key === selectedTableKey

            return (
              <button
                aria-pressed={isActive}
                className={`data-center-tab${isActive ? ' is-active' : ''}`}
                key={table.key}
                onClick={() => {
                  setSelectedTableKey(table.key)
                }}
                type="button"
              >
                <strong>{table.label}</strong>
                <span>{summary ? `${summary.rowCount.toLocaleString('ko-KR')}행` : table.tableName}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="panel data-center-viewer-panel">
        <div className="data-center-viewer-head">
          <div>
            <h3>{snapshot?.label ?? selectedConfig.label}</h3>
            <p className="page-copy">{snapshot?.description ?? selectedConfig.description}</p>
          </div>
          <span className="data-center-table-name">{snapshot?.tableName ?? selectedConfig.tableName}</span>
        </div>

        <div className="data-center-toolbar">
          <label className="field data-center-search-field">
            <span>통합 검색</span>
            <input
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              placeholder="차량번호, 고객명, 품목명, 날짜 등"
              type="search"
              value={query}
            />
          </label>

          <label className="field data-center-page-size-field">
            <span>표시 행</span>
            <select
              className="field-select"
              onChange={(event) => {
                setPageSize(Number(event.target.value))
              }}
              value={pageSize}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}행
                </option>
              ))}
            </select>
          </label>

          <div className="data-center-pagination" aria-label="데이터 페이지 이동">
            <button
              className="secondary-button"
              disabled={loading || pageIndex === 0}
              onClick={() => {
                setPageIndex((current) => Math.max(0, current - 1))
              }}
              type="button"
            >
              이전
            </button>
            <span>
              {currentPage.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')}
            </span>
            <button
              className="secondary-button"
              disabled={loading || pageIndex + 1 >= totalPages}
              onClick={() => {
                setPageIndex((current) => current + 1)
              }}
              type="button"
            >
              다음
            </button>
          </div>
        </div>

        <div className="data-center-range-row">
          <span>
            {pageStart.toLocaleString('ko-KR')} - {pageEnd.toLocaleString('ko-KR')} /{' '}
            {totalRows.toLocaleString('ko-KR')}행
          </span>
          {deferredQuery.trim() ? <span>검색어: {deferredQuery.trim()}</span> : <span>전체 데이터</span>}
        </div>

        <div className="table-wrap data-center-grid-wrap">
          <table className="data-table data-center-table">
            <thead>
              <tr>
                <th className="data-center-row-number">#</th>
                {(snapshot?.columns ?? selectedConfig.columns).map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty-cell" colSpan={(snapshot?.columns ?? selectedConfig.columns).length + 1}>
                    데이터를 불러오는 중입니다.
                  </td>
                </tr>
              ) : snapshot && snapshot.rows.length > 0 ? (
                snapshot.rows.map((row, rowIndex) => (
                  <tr key={`${snapshot.tableKey}-${pageIndex}-${rowIndex}`}>
                    <td className="data-center-row-number">{pageIndex * pageSize + rowIndex + 1}</td>
                    {snapshot.columns.map((column) => {
                      const value = row[column.key]
                      return (
                        <td className={value === null || value === undefined ? 'data-center-cell-null' : undefined} key={column.key}>
                          {formatCellValue(value)}
                        </td>
                      )
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={(snapshot?.columns ?? selectedConfig.columns).length + 1}>
                    표시할 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
