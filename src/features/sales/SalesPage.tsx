import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  findFirstInvalidField,
  focusFieldErrorTarget,
  showErrorDialog,
  showValidationDialog,
  type FieldValidationMap,
} from '../../lib/dialogs'
import { formatMoney, getCurrentSeoulDateTimeValue, scaleMoneyInputToWon } from '../../lib/normalize'
import type { InventoryListRow, PlateLookupRow } from '../../lib/types'
import { searchInventoryItems } from '../inventory/inventoryService'
import { getDiscountedPrice } from '../publicQuote/quoteUtils'
import { loadLowStockThreshold } from '../settings/settingsService'
import { loadSaleForEdit, lookupSaleCustomers, saveSale, type SaleDraftLine, updateSale } from './salesService'

type SalesFieldKey =
  | 'sales-search'
  | 'sales-service-amount'
  | 'sales-card-amount'
  | 'sales-naver-amount'
  | 'sales-cash-amount'
  | `sales-line-quantity:${number}`

function getSalesLineQuantityFieldKey(itemId: number): SalesFieldKey {
  return `sales-line-quantity:${itemId}`
}

function sanitizeAmountInput(value: string) {
  const cleaned = value.replace(/,/g, '').replace(/[^\d.]/g, '')
  const [wholePart = '', ...fractionParts] = cleaned.split('.')
  const normalizedWholePart = wholePart.replace(/^0+(?=\d)/, '')
  const normalizedFractionPart = fractionParts.join('').slice(0, 3)

  if (!normalizedFractionPart) {
    return normalizedWholePart
  }

  return `${normalizedWholePart || '0'}.${normalizedFractionPart}`
}

function parseAmount(value: string) {
  return scaleMoneyInputToWon(sanitizeAmountInput(value))
}

function getAmountFieldPreview(value: string) {
  return `${formatMoney(parseAmount(value))}원`
}

function formatWonToInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return ''
  }

  const scaled = (value / 1000).toFixed(3).replace(/\.?0+$/, '')
  return scaled === '0' ? '' : scaled
}

function formatDifferenceLabel(value: number) {
  return `${formatMoney(Math.abs(value))}원`
}

function getCurrentSaleDateValue() {
  return getCurrentSeoulDateTimeValue().slice(0, 10)
}

function getCurrentSaleTimeValue() {
  return getCurrentSeoulDateTimeValue().slice(11)
}

function normalizeSaleDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : getCurrentSaleDateValue()
}

function getSaleDateFromSoldAt(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? getCurrentSaleDateValue()
}

function getSaleTimeFromSoldAt(value: string) {
  const match = value.match(/\d{2}:\d{2}:\d{2}$/)
  return match?.[0] ?? getCurrentSaleTimeValue()
}

function formatSoldAtPayload(dateValue: string, timeValue: string) {
  return `${normalizeSaleDateValue(dateValue)} ${timeValue || getCurrentSaleTimeValue()}`
}

function isLowStock(quantityAvailable: number, threshold: number) {
  return threshold > 0 && quantityAvailable > 0 && quantityAvailable <= threshold
}

function getSaleBasePrice(item: Pick<InventoryListRow, 'defaultCostPrice' | 'defaultSalePrice'>) {
  return item.defaultSalePrice > 0 ? item.defaultSalePrice : item.defaultCostPrice
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function getEditableMaxQuantity(line: SaleDraftLine) {
  return Math.max(line.maxEditableQuantity ?? line.quantityAvailable, 1)
}

function resolveCartPricing(
  cart: SaleDraftLine[],
  options: {
    preserveExistingPricing?: boolean
  } = {},
) {
  if (cart.length === 0) {
    return []
  }

  const preserveExistingPricing = options.preserveExistingPricing === true

  if (preserveExistingPricing) {
    return cart.map((line) => {
      const quantity = Math.max(0, line.quantity)
      const lineTotal = line.lineTotalOverride ?? Math.max(0, line.unitPrice) * quantity
      const unitPrice =
        quantity > 0 ? Math.max(0, Math.round(lineTotal / quantity)) : Math.max(0, Math.round(line.unitPrice))
      return {
        ...line,
        unitPrice,
        lineTotalOverride: lineTotal,
      }
    })
  }

  return cart.map((line) => {
    const unitPrice = getDiscountedPrice(getSaleBasePrice(line), line.defaultDiscountRate)
    return {
      ...line,
      unitPrice,
      lineTotalOverride: unitPrice * Math.max(0, line.quantity),
    }
  })
}

export function SalesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<InventoryListRow[]>([])
  const [cart, setCart] = useState<SaleDraftLine[]>([])
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [saleDate, setSaleDate] = useState(() => getCurrentSaleDateValue())
  const [saleTime, setSaleTime] = useState(() => getCurrentSaleTimeValue())
  const [odometer, setOdometer] = useState('')
  const [memo, setMemo] = useState('')
  const [cardAmount, setCardAmount] = useState('')
  const [naverAmount, setNaverAmount] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [alignmentAmount, setAlignmentAmount] = useState('')
  const [serviceDescription, setServiceDescription] = useState('')
  const [serviceAmount, setServiceAmount] = useState('')
  const [lookupMatches, setLookupMatches] = useState<PlateLookupRow[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lowStockThreshold, setLowStockThreshold] = useState(4)
  const [status, setStatus] = useState('상품을 검색해 선택하면 판매표에 바로 추가됩니다.')
  const [refreshKey, setRefreshKey] = useState(0)
  const [fieldErrors, setFieldErrors] = useState<FieldValidationMap<SalesFieldKey>>({})
  const editSaleId = Number(searchParams.get('saleId') || 0)
  const isEditMode = Number.isInteger(editSaleId) && editSaleId > 0

  const deferredQuery = useDeferredValue(query)
  const deferredCustomerName = useDeferredValue(customerName)
  const deferredPhone = useDeferredValue(phone)
  const deferredPlateNumber = useDeferredValue(plateNumber)

  const resetSaleForm = useCallback(() => {
    setCart([])
    setCustomerName('')
    setPhone('')
    setPlateNumber('')
    setVehicleModel('')
    setSaleDate(getCurrentSaleDateValue())
    setSaleTime(getCurrentSaleTimeValue())
    setOdometer('')
    setMemo('')
    setCardAmount('')
    setNaverAmount('')
    setCashAmount('')
    setAlignmentAmount('')
    setServiceDescription('')
    setServiceAmount('')
    setLookupMatches([])
    setFieldErrors({})
  }, [])

  const exitEditMode = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('saleId')
      return next
    })
  }, [setSearchParams])

  useEffect(() => {
    let active = true

    async function loadThreshold() {
      try {
        const threshold = await loadLowStockThreshold()
        if (!active) {
          return
        }

        setLowStockThreshold(threshold)
      } catch (error) {
        console.error(error)
      }
    }

    void loadThreshold()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadSaleDraft() {
      if (!isEditMode) {
        return
      }

      try {
        setStatus('판매 수정 정보를 불러오는 중입니다.')
        const draft = await loadSaleForEdit(editSaleId)
        if (!active) {
          return
        }

        setCart(draft.lines)
        setCustomerName(draft.customerName)
        setPhone(draft.phone)
        setPlateNumber(draft.plateNumber)
        setVehicleModel(draft.vehicleModel)
        setSaleDate(getSaleDateFromSoldAt(draft.soldAt))
        setSaleTime(getSaleTimeFromSoldAt(draft.soldAt))
        setOdometer(draft.odometer > 0 ? String(draft.odometer) : '')
        setMemo(draft.memo)
        setCardAmount(formatWonToInputAmount(draft.cardAmount))
        setNaverAmount(formatWonToInputAmount(draft.naverAmount))
        setCashAmount(formatWonToInputAmount(draft.cashAmount))
        setAlignmentAmount(formatWonToInputAmount(draft.alignmentAmount))
        setServiceDescription(draft.serviceDescription)
        setServiceAmount(formatWonToInputAmount(draft.serviceAmount))
        setLookupMatches([])
        setFieldErrors({})
        setStatus(`${draft.soldAt} 판매 내역을 수정 중입니다.`)
      } catch (error) {
        console.error(error)
        if (!active) {
          return
        }
        await showErrorDialog(error, '판매 불러오기 실패')
        setSearchParams((current) => {
          const next = new URLSearchParams(current)
          next.delete('saleId')
          return next
        })
        setCart([])
        setCustomerName('')
        setPhone('')
        setPlateNumber('')
        setVehicleModel('')
        setSaleDate(getCurrentSaleDateValue())
        setSaleTime(getCurrentSaleTimeValue())
        setOdometer('')
        setMemo('')
        setCardAmount('')
        setNaverAmount('')
        setCashAmount('')
        setAlignmentAmount('')
        setServiceDescription('')
        setServiceAmount('')
        setLookupMatches([])
        setFieldErrors({})
        setStatus(error instanceof Error ? error.message : '판매 내역을 불러오지 못했습니다.')
      }
    }

    void loadSaleDraft()
    return () => {
      active = false
    }
  }, [editSaleId, isEditMode, setSearchParams])

  useEffect(() => {
    let active = true

    async function loadItems() {
      try {
        const rows = await searchInventoryItems(deferredQuery)
        if (!active) {
          return
        }

        setResults(rows)
      } catch (error) {
        console.error(error)
        if (active) {
          setStatus('상품 검색 중 오류가 발생했습니다.')
        }
      }
    }

    void loadItems()
    return () => {
      active = false
    }
  }, [deferredQuery, refreshKey])

  useEffect(() => {
    let active = true
    const hasLookupQuery =
      deferredPlateNumber.trim().length >= 1 ||
      deferredPhone.replace(/\D/g, '').length >= 1 ||
      deferredCustomerName.trim().length >= 1

    if (!hasLookupQuery) {
      setLookupMatches([])
      setLookupLoading(false)
      return
    }

    async function loadLookupMatches() {
      try {
        setLookupLoading(true)
        const rows = await lookupSaleCustomers({
          customerName: deferredCustomerName,
          phone: deferredPhone,
          plateNumber: deferredPlateNumber,
        })

        if (!active) {
          return
        }

        setLookupMatches(rows)
      } catch (error) {
        console.error(error)
        if (active) {
          setLookupMatches([])
        }
      } finally {
        if (active) {
          setLookupLoading(false)
        }
      }
    }

    void loadLookupMatches()
    return () => {
      active = false
    }
  }, [deferredCustomerName, deferredPhone, deferredPlateNumber])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !isEditableElement(event.target)) {
        return
      }

      const hasPendingInput =
        query.trim() !== '' ||
        cart.length > 0 ||
        customerName.trim() !== '' ||
        phone.trim() !== '' ||
        plateNumber.trim() !== '' ||
        vehicleModel.trim() !== '' ||
        saleDate !== getCurrentSaleDateValue() ||
        odometer.trim() !== '' ||
        memo.trim() !== '' ||
        cardAmount.trim() !== '' ||
        naverAmount.trim() !== '' ||
        cashAmount.trim() !== '' ||
        alignmentAmount.trim() !== '' ||
        serviceDescription.trim() !== '' ||
        serviceAmount.trim() !== '' ||
        lookupMatches.length > 0 ||
        Object.keys(fieldErrors).length > 0

      if (!isEditMode && !hasPendingInput) {
        return
      }

      event.preventDefault()
      if (isEditMode) {
        exitEditMode()
        setStatus('판매 수정을 취소했습니다.')
      } else {
        setStatus('판매 입력을 취소했습니다.')
      }

      setQuery('')
      resetSaleForm()
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [
    alignmentAmount,
    cardAmount,
    cart.length,
    cashAmount,
    customerName,
    exitEditMode,
    fieldErrors,
    isEditMode,
    lookupMatches.length,
    memo,
    naverAmount,
    odometer,
    phone,
    plateNumber,
    query,
    resetSaleForm,
    saleDate,
    serviceAmount,
    serviceDescription,
    vehicleModel,
  ])

  function addItem(item: InventoryListRow) {
    setCart((currentCart) => {
      const existing = currentCart.find((line) => line.id === item.id)
      if (existing) {
        return currentCart.map((line) =>
          line.id === item.id
            ? {
                ...line,
                quantity: Math.min(line.quantity + 1, getEditableMaxQuantity(line)),
              }
            : line,
        )
      }

      return [
        ...currentCart,
        {
          ...item,
          quantity: item.quantityAvailable > 0 ? 1 : 0,
          unitPrice: getDiscountedPrice(getSaleBasePrice(item), item.defaultDiscountRate),
          lineTotalOverride: null,
        },
      ]
    })
  }

  function updateLineQuantity(itemId: number, quantity: number) {
    setCart((currentCart) =>
      currentCart.map((line) =>
        line.id === itemId
          ? {
              ...line,
              quantity: Math.max(1, Math.min(quantity, getEditableMaxQuantity(line))),
            }
          : line,
      ),
    )
  }

  function removeLine(itemId: number) {
    setCart((currentCart) => currentCart.filter((line) => line.id !== itemId))
  }

  function applyLookupMatch(match: PlateLookupRow) {
    setCustomerName(match.customerName === '미등록 고객' ? '' : match.customerName)
    setPhone(match.phone ?? '')
    setPlateNumber(match.plateNumber ?? '')
    setVehicleModel(match.vehicleModel ?? '')
    setOdometer(match.odometer > 0 ? String(match.odometer) : '')
    setLookupMatches([])
    setStatus(
      match.latestSaleAt
        ? `${match.plateNumber || '기존 고객'} 이력을 불러왔습니다. 최근 방문일은 ${match.latestSaleAt}입니다.`
        : `${match.plateNumber || '기존 고객'} 정보를 불러왔습니다.`,
    )
  }

  const rawCardAmount = parseAmount(cardAmount)
  const rawNaverAmount = parseAmount(naverAmount)
  const rawCashAmount = parseAmount(cashAmount)
  const rawPaymentTotal = rawCardAmount + rawNaverAmount + rawCashAmount
  const alignmentServiceAmount = parseAmount(alignmentAmount)
  const rawExtraServiceAmount = parseAmount(serviceAmount)
  const explicitServiceTotal = alignmentServiceAmount + rawExtraServiceAmount
  const hasSelectedItems = cart.length > 0
  const isPaymentOnlySale = !hasSelectedItems && explicitServiceTotal === 0 && rawPaymentTotal > 0
  const hasManualCashAmount = cashAmount.trim() !== ''
  const resolvedCart = resolveCartPricing(cart, {
    preserveExistingPricing: isEditMode,
  })
  const tireTotal = resolvedCart.reduce((sum, line) => sum + (line.lineTotalOverride ?? line.unitPrice * line.quantity), 0)
  const effectiveExtraServiceAmount = isPaymentOnlySale ? rawPaymentTotal : rawExtraServiceAmount
  const totalAmount = tireTotal + alignmentServiceAmount + effectiveExtraServiceAmount
  const effectiveCardAmount = rawCardAmount
  const effectiveNaverAmount = rawNaverAmount
  const effectiveCashAmount = rawCashAmount
  const paymentTotal = effectiveCardAmount + effectiveNaverAmount + effectiveCashAmount
  const paymentDiff = paymentTotal - totalAmount
  const cardFeeAmount = Math.round(effectiveCardAmount * 0.03) + Math.round(effectiveNaverAmount * 0.05)
  const lowStockLabel = lowStockThreshold > 0 ? `${lowStockThreshold.toLocaleString('ko-KR')}개 이하` : '사용 안 함'
  const requiresPaymentCheck = totalAmount > 0 && paymentDiff !== 0

  const activeFieldErrors: FieldValidationMap<SalesFieldKey> = { ...fieldErrors }
  const invalidQuantityKeys = new Set(
    cart
      .filter((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)
      .map((line) => getSalesLineQuantityFieldKey(line.id)),
  )

  if (totalAmount > 0) {
    delete activeFieldErrors['sales-search']
  }

  delete activeFieldErrors['sales-service-amount']

  if (!requiresPaymentCheck) {
    delete activeFieldErrors['sales-card-amount']
    delete activeFieldErrors['sales-naver-amount']
    delete activeFieldErrors['sales-cash-amount']
  }

  for (const key of Object.keys(activeFieldErrors) as SalesFieldKey[]) {
    if (key.startsWith('sales-line-quantity:') && !invalidQuantityKeys.has(key)) {
      delete activeFieldErrors[key]
    }
  }

  const searchError = activeFieldErrors['sales-search']
  const serviceAmountError = activeFieldErrors['sales-service-amount']
  const paymentError =
    activeFieldErrors['sales-card-amount'] ??
    activeFieldErrors['sales-naver-amount'] ??
    activeFieldErrors['sales-cash-amount']

  async function handleSaveSale() {
    const issues: string[] = []
    const nextFieldErrors: FieldValidationMap<SalesFieldKey> = {}
    const fieldOrder: SalesFieldKey[] = []

    if (totalAmount <= 0) {
      const message = '판매 합계가 0원입니다. 타이어를 선택하거나 작업비를 입력해 주세요.'
      issues.push(message)
      nextFieldErrors['sales-search'] = message
      fieldOrder.push('sales-search')
    }

    const invalidQuantityLines = cart.filter((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)
    if (invalidQuantityLines.length > 0) {
      const message = '판매표에 수량이 0개이거나 비어 있는 항목이 있습니다.'
      issues.push(message)
      for (const line of invalidQuantityLines) {
        const key = getSalesLineQuantityFieldKey(line.id)
        nextFieldErrors[key] = '수량은 1개 이상이어야 합니다.'
        fieldOrder.push(key)
      }
    }

    if (requiresPaymentCheck) {
      const direction = paymentDiff > 0 ? '초과' : '부족'
      const message = `결제 합계가 판매 합계와 다릅니다. 현재 ${formatDifferenceLabel(paymentDiff)} ${direction} 상태입니다.`
      issues.push(message)
      nextFieldErrors['sales-card-amount'] = message
      nextFieldErrors['sales-naver-amount'] = message
      nextFieldErrors['sales-cash-amount'] = message
      fieldOrder.push('sales-card-amount', 'sales-naver-amount', 'sales-cash-amount')
    }

    if (issues.length > 0) {
      const firstField = findFirstInvalidField(fieldOrder, nextFieldErrors)
      setFieldErrors(nextFieldErrors)
      setStatus(issues[0] ?? '판매 입력값을 확인해 주세요.')
      await showValidationDialog(issues, '판매 입력 확인')
      if (firstField) {
        focusFieldErrorTarget(firstField)
      }
      return
    }

    try {
      setStatus(isEditMode ? '판매 수정 중입니다.' : '판매 저장 중입니다.')

      const payload = {
        soldAt: formatSoldAtPayload(saleDate, saleTime),
        customerName,
        phone,
        plateNumber,
        vehicleModel,
        odometer: Number(odometer || 0),
        memo,
        cardAmount: effectiveCardAmount,
        naverAmount: effectiveNaverAmount,
        cashAmount: effectiveCashAmount,
        alignmentAmount: alignmentServiceAmount,
        serviceDescription,
        serviceAmount: effectiveExtraServiceAmount,
        lines: resolvedCart.filter((line) => line.quantity > 0),
      }

      if (isEditMode) {
        await updateSale(editSaleId, payload)
        exitEditMode()
      } else {
        await saveSale(payload)
      }

      resetSaleForm()
      setRefreshKey((current) => current + 1)
      setStatus(
        isEditMode
          ? '판매 수정이 완료되었습니다. 재고와 매출이 즉시 다시 반영되었습니다.'
          : '판매 저장이 완료되었습니다. 재고가 즉시 반영되었습니다.',
      )
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : isEditMode ? '판매 수정에 실패했습니다.' : '판매 저장에 실패했습니다.')
      await showErrorDialog(error, isEditMode ? '판매 수정 실패' : '판매 저장 실패')
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">판매</p>
          <h2>{isEditMode ? '판매 내역 수정' : '빠른 판매 입력'}</h2>
        </div>
        <div className="status-pill">{status}</div>
      </header>

      <section className="sales-layout">
        <article className="panel sales-search-panel">
          <div className={`search-preview${searchError ? ' has-error' : ''}`}>
            <input
              aria-invalid={Boolean(searchError)}
              data-field-error-target="sales-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="규격 / 패턴 / 브랜드 / 별칭 검색"
              value={query}
            />
            <p style={{ margin: 0, color: 'var(--muted)' }}>저재고 기준: {lowStockLabel}</p>
            {searchError ? <small className="field-error-text">{searchError}</small> : null}
          </div>

          <div className="result-list compact-result-list">
            {results.map((item) => {
              const suggestedPrice = getDiscountedPrice(getSaleBasePrice(item), item.defaultDiscountRate)

              return (
                <button
                  className="result-card"
                  disabled={item.quantityAvailable <= 0}
                  key={item.id}
                  onClick={() => addItem(item)}
                  type="button"
                >
                  <div>
                    <strong>
                      {item.brandName} {item.patternName}
                    </strong>
                    <p>{item.sizeLabel}</p>
                    <p style={{ marginTop: '0.2rem' }}>{item.productName || '상품명 미입력'}</p>
                  </div>
                  <div className="result-meta">
                    <span>{suggestedPrice > 0 ? `${formatMoney(suggestedPrice)}원` : '기준가 미입력'}</span>
                    {item.defaultDiscountRate > 0 ? (
                      <span className="ok-text">할인 {item.defaultDiscountRate}% 적용</span>
                    ) : null}
                    {isLowStock(item.quantityAvailable, lowStockThreshold) ? (
                      <span className="warn-text">저재고</span>
                    ) : null}
                    <span
                      className={`stock-badge${
                        item.quantityAvailable > 0 ? ' stock-badge-ok' : ' stock-badge-empty'
                      }`}
                    >
                      재고 {item.quantityAvailable}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </article>

        <article className="panel sales-workbench">
          <div className="sales-workbench-top">
            <div>
              <h3>판매표</h3>
            </div>
            <div className="sales-mini-stats">
              <div>
                <strong>{cart.length.toLocaleString('ko-KR')}</strong>
                <span>품목</span>
              </div>
              <div>
                <strong>{cart.reduce((sum, line) => sum + line.quantity, 0).toLocaleString('ko-KR')}</strong>
                <span>총 수량</span>
              </div>
              <div>
                <strong>{formatMoney(totalAmount)}원</strong>
                <span>총 결제</span>
              </div>
            </div>
          </div>

          <div className="table-wrap sales-table-wrap">
            <table className="data-table compact-table">
              <thead>
                <tr>
                  <th>품목</th>
                  <th>규격</th>
                  <th>재고</th>
                  <th>수량</th>
                  <th>예상금액</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resolvedCart.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.brandName} {line.patternName}
                    </td>
                    <td>{line.sizeLabel}</td>
                    <td>{line.quantityAvailable}</td>
                    <td>
                      <div className="table-input-wrap">
                        <input
                          aria-invalid={Boolean(activeFieldErrors[getSalesLineQuantityFieldKey(line.id)])}
                          className="table-input"
                          data-field-error-target={getSalesLineQuantityFieldKey(line.id)}
                          min={1}
                          onChange={(event) => updateLineQuantity(line.id, Number(event.target.value))}
                          type="number"
                          value={line.quantity}
                        />
                        {activeFieldErrors[getSalesLineQuantityFieldKey(line.id)] ? (
                          <small className="field-error-text">
                            {activeFieldErrors[getSalesLineQuantityFieldKey(line.id)]}
                          </small>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatMoney(line.lineTotalOverride ?? line.unitPrice * line.quantity)}원</td>
                    <td>
                      <button className="table-action" onClick={() => removeLine(line.id)} type="button">
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {resolvedCart.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={6}>
                      왼쪽 목록에서 품목을 눌러 판매표를 만들어 주세요.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="sales-form-section">
            <div className="form-grid sales-form-grid">
              <label className="field">
                <span>판매일</span>
                <input
                  onChange={(event) => setSaleDate(normalizeSaleDateValue(event.target.value))}
                  type="date"
                  value={saleDate}
                />
                <small className="field-hint">기본은 오늘이며 이전 날짜도 선택할 수 있습니다.</small>
              </label>
              <label className="field">
                <span>고객명</span>
                <input onChange={(event) => setCustomerName(event.target.value)} value={customerName} />
              </label>
              <label className="field">
                <span>연락처</span>
                <input onChange={(event) => setPhone(event.target.value)} value={phone} />
              </label>
              <label className="field">
                <span>차량번호</span>
                <input onChange={(event) => setPlateNumber(event.target.value)} value={plateNumber} />
              </label>
              <label className="field">
                <span>차종</span>
                <input onChange={(event) => setVehicleModel(event.target.value)} value={vehicleModel} />
              </label>

              {lookupMatches.length > 0 || lookupLoading ? (
                <div className="field field-wide sales-lookup-panel">
                  <span>기존 고객 선택</span>
                  {lookupLoading ? (
                    <div className="note-box compact-note">기존 고객 정보를 찾는 중입니다.</div>
                  ) : (
                    <div className="sales-lookup-list">
                      {lookupMatches.map((match) => (
                        <button
                          className="sales-lookup-button"
                          key={`${match.vehicleId}-${match.latestSaleAt ?? 'none'}`}
                          onClick={() => applyLookupMatch(match)}
                          type="button"
                        >
                          <strong>{match.plateNumber || '차량번호 미입력'}</strong>
                          <span>
                            {match.customerName || '미등록 고객'} / {match.phone || '연락처 없음'}
                          </span>
                          <span className="sales-lookup-meta">
                            {match.vehicleModel || '차종 미입력'}
                            {match.latestSaleAt ? ` / 최근 방문 ${match.latestSaleAt}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <label className="field">
                <span>키로수</span>
                <input
                  min={0}
                  onChange={(event) => setOdometer(event.target.value)}
                  placeholder="예: 82500"
                  type="number"
                  value={odometer}
                />
              </label>
              <label className="field">
                <span>얼라이먼트 금액(천원)</span>
                <input
                  inputMode="decimal"
                  onChange={(event) => setAlignmentAmount(sanitizeAmountInput(event.target.value))}
                  placeholder="0"
                  type="text"
                  value={alignmentAmount}
                />
                <small className="field-hint">{getAmountFieldPreview(alignmentAmount)}</small>
              </label>
              <label className="field">
                <span>추가 작업명</span>
                <input
                  onChange={(event) => setServiceDescription(event.target.value)}
                  placeholder="예: 위치교환, 엔진오일"
                  value={serviceDescription}
                />
                <small className="field-hint">타이어 없이 작업명 + 추가 작업비만으로도 저장할 수 있습니다.</small>
              </label>
              <label className={`field${serviceAmountError ? ' has-error' : ''}`}>
                <span>추가 작업비(천원)</span>
                <input
                  aria-invalid={Boolean(serviceAmountError)}
                  data-field-error-target="sales-service-amount"
                  inputMode="decimal"
                  onChange={(event) => setServiceAmount(sanitizeAmountInput(event.target.value))}
                  placeholder="0"
                  type="text"
                  value={serviceAmount}
                />
                {serviceAmountError ? (
                  <small className="field-error-text">{serviceAmountError}</small>
                ) : (
                  <small className="field-hint">
                    {isPaymentOnlySale ? `${formatMoney(effectiveExtraServiceAmount)}원 자동 반영` : getAmountFieldPreview(serviceAmount)}
                  </small>
                )}
              </label>

              <label className={`field${paymentError ? ' has-error' : ''}`}>
                <span>카드(천원)</span>
                <input
                  aria-invalid={Boolean(paymentError)}
                  data-field-error-target="sales-card-amount"
                  inputMode="decimal"
                  onChange={(event) => setCardAmount(sanitizeAmountInput(event.target.value))}
                  placeholder="0"
                  type="text"
                  value={cardAmount}
                />
                <small className="field-hint">
                  {getAmountFieldPreview(cardAmount)} / 수수료 {formatMoney(Math.round(rawCardAmount * 0.03))}원
                </small>
              </label>
              <label className={`field${paymentError ? ' has-error' : ''}`}>
                <span>네이버(천원)</span>
                <input
                  aria-invalid={Boolean(paymentError)}
                  data-field-error-target="sales-naver-amount"
                  inputMode="decimal"
                  onChange={(event) => setNaverAmount(sanitizeAmountInput(event.target.value))}
                  placeholder="0"
                  type="text"
                  value={naverAmount}
                />
                <small className="field-hint">
                  {getAmountFieldPreview(naverAmount)} / 수수료 {formatMoney(Math.round(rawNaverAmount * 0.05))}원
                </small>
              </label>
              <label className={`field${paymentError ? ' has-error' : ''}`}>
                <span>현금(천원)</span>
                <input
                  aria-invalid={Boolean(paymentError)}
                  data-field-error-target="sales-cash-amount"
                  inputMode="decimal"
                  onChange={(event) => setCashAmount(sanitizeAmountInput(event.target.value))}
                  placeholder="0"
                  type="text"
                  value={cashAmount}
                />
                <small className="field-hint">
                  {hasManualCashAmount ? getAmountFieldPreview(cashAmount) : '현금 결제액을 입력한 경우에만 반영됩니다.'}
                </small>
              </label>
            </div>

            <div className="content-grid">
              <div className="summary-panel summary-panel-tight">
                <div>
                  <strong>타이어 합계</strong>
                  <span>{formatMoney(tireTotal)}원</span>
                </div>
                <div>
                  <strong>얼라이먼트</strong>
                  <span>{formatMoney(alignmentServiceAmount)}원</span>
                </div>
                <div>
                  <strong>추가 작업비</strong>
                  <span>{formatMoney(effectiveExtraServiceAmount)}원</span>
                </div>
                <div>
                  <strong>총합계</strong>
                  <span>{formatMoney(totalAmount)}원</span>
                </div>
                <div>
                  <strong>결제 수수료 예상</strong>
                  <span>{formatMoney(cardFeeAmount)}원</span>
                </div>
              </div>

              <div>
                <div className={`payment-check${paymentError ? ' has-error' : ''}`}>
                  <span>결제 합계 차이</span>
                  <strong className={paymentDiff === 0 ? 'ok-text' : 'warn-text'}>{formatMoney(paymentDiff)}원</strong>
                  {paymentError ? <small className="field-error-text">{paymentError}</small> : null}
                </div>

                <div className="button-row">
                  {isEditMode ? (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        exitEditMode()
                        resetSaleForm()
                        setStatus('새 판매 입력으로 돌아왔습니다.')
                      }}
                      type="button"
                    >
                      수정 취소
                    </button>
                  ) : null}
                  <button
                    className="primary-button"
                    onClick={handleSaveSale}
                    type="button"
                  >
                    {isEditMode ? '판매 수정' : '판매 저장'}
                  </button>
                </div>
              </div>
            </div>

            <label className="field field-wide">
              <span>비고</span>
              <input onChange={(event) => setMemo(event.target.value)} value={memo} />
            </label>
          </div>
        </article>
      </section>
    </section>
  )
}
