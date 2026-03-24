import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { showErrorDialog, showMessageDialog } from '../../lib/dialogs'
import { formatMoney } from '../../lib/normalize'
import type { CustomerListRow, CustomerSearchFilters } from '../../lib/types'
import { searchCustomers, updateCustomerVehicleRecord } from './customersService'

const defaultFilters: CustomerSearchFilters = {
  query: '',
  vehicleBrand: '',
  vehicleModel: '',
  purchasedBrand: '',
  saleStatus: 'all',
}

const defaultEditForm = {
  customerName: '',
  phone: '',
  plateNumber: '',
  vehicleBrand: '',
  vehicleModel: '',
  odometer: '',
  memo: '',
}

const secondaryTextStyle = {
  color: 'var(--muted)',
  fontSize: '0.88rem',
}

function formatOdometer(odometer: number) {
  return odometer > 0 ? `${odometer.toLocaleString('ko-KR')} km` : '-'
}

function formatReplacementDate(value: string | null) {
  return value ? value.slice(0, 10) : '-'
}

function createEditForm(row: CustomerListRow) {
  return {
    customerName: row.customerName,
    phone: row.phone,
    plateNumber: row.plateNumber,
    vehicleBrand: row.vehicleBrand,
    vehicleModel: row.vehicleModel,
    odometer: row.odometer > 0 ? String(row.odometer) : '',
    memo: row.memo,
  }
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function CustomersPage() {
  const [filters, setFilters] = useState(defaultFilters)
  const [rows, setRows] = useState<CustomerListRow[]>([])
  const [selectedRow, setSelectedRow] = useState<CustomerListRow | null>(null)
  const [editForm, setEditForm] = useState(defaultEditForm)
  const [status, setStatus] = useState('고객 / 차량 목록을 불러오는 중입니다.')
  const [saving, setSaving] = useState(false)
  const deferredQuery = useDeferredValue(filters.query)
  const refreshSequenceRef = useRef(0)
  const selectedRowId = selectedRow?.id ?? null

  const refreshCustomers = useCallback(async (
    searchFilters = { ...filters, query: deferredQuery },
    nextSelectedRowId: number | null = selectedRowId,
    fallbackSelectedRow: CustomerListRow | null = null,
  ) => {
    const refreshSequence = refreshSequenceRef.current + 1
    refreshSequenceRef.current = refreshSequence

    const customers = await searchCustomers(searchFilters)
    if (refreshSequence !== refreshSequenceRef.current) {
      return null
    }

    const nextSelectedRow =
      nextSelectedRowId
        ? customers.find((row) => row.id === nextSelectedRowId) ??
          (fallbackSelectedRow?.id === nextSelectedRowId ? fallbackSelectedRow : null)
        : null
    const visibleRows =
      nextSelectedRow && !customers.some((row) => row.id === nextSelectedRow.id)
        ? [nextSelectedRow, ...customers]
        : customers

    setRows(visibleRows)
    setStatus(
      visibleRows.length > 0
        ? `${visibleRows.length.toLocaleString('ko-KR')}대 차량을 표시 중입니다.`
        : '조건에 맞는 차량이 없습니다.',
    )

    if (nextSelectedRowId) {
      setSelectedRow(nextSelectedRow)
      setEditForm(nextSelectedRow ? createEditForm(nextSelectedRow) : defaultEditForm)
    }

    return visibleRows
  }, [deferredQuery, filters, selectedRowId])

  useEffect(() => {
    let active = true
    const searchFilters = {
      ...filters,
      query: deferredQuery,
    }

    async function loadCustomers() {
      try {
        const customers = await refreshCustomers(searchFilters)
        if (!active || !customers) {
          return
        }
      } catch (error) {
        console.error(error)
        if (active) {
          setStatus('고객 / 차량 정보를 불러오지 못했습니다.')
        }
      }
    }

    void loadCustomers()
    return () => {
      active = false
    }
  }, [deferredQuery, filters, refreshCustomers])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !isEditableElement(event.target) || !selectedRow) {
        return
      }

      event.preventDefault()
      setSelectedRow(null)
      setEditForm(defaultEditForm)
      setStatus('고객 / 차량 수정을 취소했습니다.')
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [selectedRow])

  function updateFilter<Key extends keyof CustomerSearchFilters>(key: Key, value: CustomerSearchFilters[Key]) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function resetFilters() {
    setFilters(defaultFilters)
  }

  function beginEdit(row: CustomerListRow) {
    setSelectedRow(row)
    setEditForm(createEditForm(row))
    setStatus(`${row.plateNumber || '차량'} 정보를 수정 중입니다.`)
  }

  async function handleSaveCustomer() {
    if (!selectedRow) {
      return
    }

    try {
      setSaving(true)
      const updatedRow = await updateCustomerVehicleRecord({
        vehicleId: selectedRow.id,
        customerId: selectedRow.customerId,
        customerName: editForm.customerName,
        phone: editForm.phone,
        plateNumber: editForm.plateNumber,
        vehicleBrand: editForm.vehicleBrand,
        vehicleModel: editForm.vehicleModel,
        odometer: Number(editForm.odometer || 0),
        memo: editForm.memo,
      })

      setRows((current) => current.map((row) => (row.id === updatedRow.id ? updatedRow : row)))
      setSelectedRow(updatedRow)
      setEditForm(createEditForm(updatedRow))
      await refreshCustomers(undefined, updatedRow.id, updatedRow)
      setStatus('고객 / 차량 정보를 저장했습니다.')
      await showMessageDialog('고객 / 차량 정보를 저장했습니다.', {
        title: '고객 정보 저장',
      })
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '고객 / 차량 정보 저장에 실패했습니다.')
      await showErrorDialog(error, '고객 정보 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">고객</p>
          <h2>고객 / 차량 조회</h2>
          <p className="page-copy">
            차량번호를 중심으로 고객 이력을 조회하고, 최근 교체일과 최근 판매 내역까지 함께 보면서 바로 수정할 수 있게
            정리했습니다.
          </p>
        </div>
        <div className="status-pill">{status}</div>
      </header>

      <section className="panel">
        <div className="filter-grid customer-filter-grid">
          <label className="field field-wide">
            <span>차량번호 / 연락처 / 고객명 검색</span>
            <input
              onChange={(event) => updateFilter('query', event.target.value)}
              placeholder="예: 12가3456 / 01012341234 / 김철수"
              value={filters.query}
            />
          </label>
        </div>

        <div className="button-row">
          <button className="secondary-button" onClick={resetFilters} type="button">
            검색 초기화
          </button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>차량번호 / 고객명</th>
                <th>연락처</th>
                <th>교체 날짜</th>
                <th>키로수</th>
                <th>최근 판매 내역</th>
                <th>판매수량</th>
                <th>매출금액</th>
                <th>결제구분</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.plateNumber || '차량번호 미입력'}</strong>
                    <div style={secondaryTextStyle}>{row.customerName || '고객명 미입력'}</div>
                  </td>
                  <td>{row.phone || '-'}</td>
                  <td>{formatReplacementDate(row.latestSaleAt)}</td>
                  <td>{formatOdometer(row.odometer)}</td>
                  <td>
                    <strong>{row.latestTireSummary || '-'}</strong>
                    <div style={secondaryTextStyle}>방문 {row.visitCount.toLocaleString('ko-KR')}회</div>
                  </td>
                  <td>{row.saleQuantity.toLocaleString('ko-KR')}</td>
                  <td>{formatMoney(row.totalSaleAmount)}원</td>
                  <td>
                    <div>카드 {formatMoney(row.cardAmount)}원</div>
                    <div style={secondaryTextStyle}>네이버 {formatMoney(row.naverAmount)}원</div>
                    <div style={secondaryTextStyle}>현금 {formatMoney(row.cashAmount)}원</div>
                  </td>
                  <td>
                    <button className="table-action" onClick={() => beginEdit(row)} type="button">
                      수정
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan={9}>
                    표시할 차량이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>고객 / 차량 수정</h3>
        {selectedRow ? (
          <>
            <div className="selected-item-card">
              <strong>{selectedRow.plateNumber || '차량번호 미입력'}</strong>
              <p>{selectedRow.latestTireSummary || '최근 판매 내역 없음'}</p>
              <div className="selected-item-meta">
                <span>최근 교체 {formatReplacementDate(selectedRow.latestSaleAt)}</span>
                <span>키로수 {formatOdometer(selectedRow.odometer)}</span>
                <span>얼라이먼트 {formatMoney(selectedRow.alignmentAmount)}원</span>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>고객명</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      customerName: event.target.value,
                    }))
                  }
                  value={editForm.customerName}
                />
              </label>

              <label className="field">
                <span>연락처</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  value={editForm.phone}
                />
              </label>

              <label className="field">
                <span>차량번호</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      plateNumber: event.target.value,
                    }))
                  }
                  value={editForm.plateNumber}
                />
              </label>

              <label className="field">
                <span>차량 브랜드</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      vehicleBrand: event.target.value,
                    }))
                  }
                  value={editForm.vehicleBrand}
                />
              </label>

              <label className="field">
                <span>차종</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      vehicleModel: event.target.value,
                    }))
                  }
                  value={editForm.vehicleModel}
                />
              </label>

              <label className="field">
                <span>키로수</span>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      odometer: event.target.value.replace(/[^\d]/g, ''),
                    }))
                  }
                  placeholder="예: 82500"
                  value={editForm.odometer}
                />
              </label>

              <label className="field field-wide">
                <span>메모</span>
                <input
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      memo: event.target.value,
                    }))
                  }
                  value={editForm.memo}
                />
              </label>
            </div>

            <div className="button-row">
              <button
                className="secondary-button"
                onClick={() => {
                  setSelectedRow(null)
                  setEditForm(defaultEditForm)
                  setStatus('고객 / 차량 수정을 취소했습니다.')
                }}
                type="button"
              >
                수정 취소
              </button>
              <button className="primary-button" disabled={saving} onClick={handleSaveCustomer} type="button">
                {saving ? '저장 중..' : '고객 / 차량 저장'}
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state-box">
            <strong>목록에서 차량을 선택해 주세요.</strong>
            <p>고객명, 연락처, 차량번호, 브랜드, 차종, 키로수, 메모를 바로 수정할 수 있습니다.</p>
          </div>
        )}
      </section>
    </section>
  )
}
