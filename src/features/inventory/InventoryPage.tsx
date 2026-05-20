import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import {
  findFirstInvalidField,
  focusFieldErrorTarget,
  showConfirmDialog,
  showErrorDialog,
  showMessageDialog,
  showValidationDialog,
  type FieldValidationMap,
} from '../../lib/dialogs'
import { formatMoney, getCurrentSeoulDateTimeValue } from '../../lib/normalize'
import type {
  InventoryCreateItemInput,
  InventoryFilterOptions,
  InventoryListRow,
  InventoryOverview,
  InventorySearchFilters,
} from '../../lib/types'
import {
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItemById,
  getInventoryFilterOptions,
  getInventoryOverview,
  getLowStockThreshold,
  saveItemCatalogSettings,
  saveStockEntry,
  searchInventoryItems,
} from './inventoryService'

type InventoryFieldKey =
  | 'inventory-query'
  | 'inventory-quantity'
  | 'inventory-unit-cost'
  | 'inventory-create-brand'
  | 'inventory-create-pattern'
  | 'inventory-create-size'

const defaultFilters: InventorySearchFilters = {
  query: '',
  brandName: '',
  patternName: '',
  sizeLabel: '',
  receivedDate: '',
  stockMode: 'all',
}

function getTodayDateValue() {
  return getCurrentSeoulDateTimeValue().slice(0, 10)
}

const defaultEntryForm = {
  quantity: '0',
  unitCost: '',
  occurredAt: getTodayDateValue(),
  memo: '',
  brandName: '',
  patternName: '',
  sizeLabel: '',
  discountRate: '0',
  publicQuoteEnabled: false,
  publicQuoteUrl: '',
}

const defaultCreateForm: InventoryCreateItemInput = {
  brandName: '',
  patternName: '',
  sizeLabel: '',
  defaultCostPrice: 0,
  defaultSalePrice: 0,
  defaultDiscountRate: 0,
  initialQuantity: 0,
  memo: '',
  publicQuoteEnabled: false,
  publicQuoteUrl: '',
}

function parseAmount(value: string) {
  const cleaned = sanitizeAmountInput(value)
  if (!cleaned) {
    return 0
  }

  return Math.round(Number(cleaned))
}

function sanitizeAmountInput(value: string) {
  return value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '')
}

function getAmountFieldPreview(value: string) {
  return `${formatMoney(parseAmount(value))}원`
}

function getStockBadgeClass(quantityAvailable: number, lowStockThreshold: number) {
  if (quantityAvailable <= 0) {
    return 'stock-badge-empty'
  }

  if (lowStockThreshold > 0 && quantityAvailable <= lowStockThreshold) {
    return 'stock-badge-low'
  }

  return 'stock-badge-ok'
}

function getStockBadgeLabel(quantityAvailable: number, lowStockThreshold: number) {
  if (quantityAvailable <= 0) {
    return '품절'
  }

  if (lowStockThreshold > 0 && quantityAvailable <= lowStockThreshold) {
    return `저재고 ${quantityAvailable}`
  }

  return `재고 ${quantityAvailable}`
}

function normalizeDiscountInput(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, '') || 0)
  if (!Number.isFinite(numeric)) {
    return '0'
  }
  return String(Math.max(0, Math.min(100, numeric)))
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function createEntryFormFromItem(item: InventoryListRow) {
  const currentQuantity = Math.max(0, item.quantityOnHand)
  return {
    ...defaultEntryForm,
    quantity: String(currentQuantity),
    occurredAt: getTodayDateValue(),
    brandName: item.brandName,
    patternName: item.patternName,
    sizeLabel: item.sizeLabel,
    unitCost: item.defaultCostPrice > 0 ? String(item.defaultCostPrice) : '',
    discountRate: String(item.defaultDiscountRate || 0),
    publicQuoteEnabled: item.publicQuoteEnabled,
    publicQuoteUrl: item.publicQuoteUrl || '',
  }
}

function formatReceivedDate(value: string | null) {
  if (!value) {
    return '-'
  }

  return value.slice(0, 10)
}

function createUpdatedInventoryItem(item: InventoryListRow, form: typeof defaultEntryForm) {
  return {
    ...item,
    brandName: form.brandName.trim() || item.brandName,
    patternName: form.patternName.trim() || item.patternName,
    sizeLabel: form.sizeLabel.trim() || item.sizeLabel,
    defaultCostPrice: form.unitCost.trim() === '' ? item.defaultCostPrice : parseAmount(form.unitCost),
    defaultDiscountRate: Math.max(0, Number(form.discountRate || item.defaultDiscountRate || 0)),
    publicQuoteEnabled: form.publicQuoteEnabled,
    publicQuoteUrl: form.publicQuoteUrl.trim(),
  }
}

function prioritizeInventoryItems(rows: InventoryListRow[], priorityItemId: number | null) {
  if (!priorityItemId) {
    return rows
  }

  return [...rows].sort((left, right) => {
    if (left.id === priorityItemId) {
      return -1
    }
    if (right.id === priorityItemId) {
      return 1
    }
    return 0
  })
}

function adjustFiltersForCatalogChange(
  filters: InventorySearchFilters,
  previousItem: InventoryListRow,
  nextCatalog: Pick<InventoryCreateItemInput, 'brandName' | 'patternName' | 'sizeLabel'>,
) {
  const nextFilters = { ...filters }
  let changed = false

  if (nextFilters.brandName === previousItem.brandName && nextCatalog.brandName.trim()) {
    nextFilters.brandName = nextCatalog.brandName.trim()
    changed = true
  }

  if (nextFilters.patternName === previousItem.patternName && nextCatalog.patternName.trim()) {
    nextFilters.patternName = nextCatalog.patternName.trim()
    changed = true
  }

  if (nextFilters.sizeLabel === previousItem.sizeLabel && nextCatalog.sizeLabel.trim()) {
    nextFilters.sizeLabel = nextCatalog.sizeLabel.trim()
    changed = true
  }

  return {
    changed,
    filters: nextFilters,
  }
}

export function InventoryPage() {
  const [filters, setFilters] = useState(defaultFilters)
  const [options, setOptions] = useState<InventoryFilterOptions>({
    brands: [],
    patterns: [],
    sizes: [],
  })
  const [items, setItems] = useState<InventoryListRow[]>([])
  const [selectedItem, setSelectedItem] = useState<InventoryListRow | null>(null)
  const [overview, setOverview] = useState<InventoryOverview>({
    totalQuantity: 0,
    itemCount: 0,
    lowStockItemCount: 0,
  })
  const [entryForm, setEntryForm] = useState(defaultEntryForm)
  const [createForm, setCreateForm] = useState(defaultCreateForm)
  const [status, setStatus] = useState('재고 목록을 불러오는 중입니다.')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [lowStockThreshold, setLowStockThreshold] = useState(0)
  const [fieldErrors, setFieldErrors] = useState<FieldValidationMap<InventoryFieldKey>>({})
  const [priorityItemId, setPriorityItemId] = useState<number | null>(null)
  const deferredQuery = useDeferredValue(filters.query)
  const refreshSequenceRef = useRef(0)
  const sidePanelRef = useRef<HTMLElement | null>(null)
  const receivedDateInputRef = useRef<HTMLInputElement | null>(null)
  const selectedItemId = selectedItem?.id ?? null

  const refreshInventory = useCallback(async (
    searchFilters = { ...filters, query: deferredQuery },
    nextPriorityItemId: number | null = priorityItemId,
    nextSelectedItemId: number | null = selectedItemId ?? nextPriorityItemId ?? null,
    fallbackSelectedItem: InventoryListRow | null = null,
  ) => {
    const refreshSequence = refreshSequenceRef.current + 1
    refreshSequenceRef.current = refreshSequence

    const [rows, threshold, nextOverview] = await Promise.all([
      searchInventoryItems(searchFilters),
      getLowStockThreshold(),
      getInventoryOverview(),
    ])
    if (refreshSequence !== refreshSequenceRef.current) {
      return null
    }
    const orderedRows = prioritizeInventoryItems(rows, nextPriorityItemId)
    const nextSelectedItem =
      orderedRows.find((row) => row.id === nextSelectedItemId) ??
      (fallbackSelectedItem?.id === nextSelectedItemId ? fallbackSelectedItem : null)
    const visibleRows =
      nextSelectedItem && !orderedRows.some((row) => row.id === nextSelectedItem.id)
        ? prioritizeInventoryItems([nextSelectedItem, ...orderedRows], nextPriorityItemId ?? nextSelectedItem.id)
        : orderedRows

    setItems(visibleRows)
    setLowStockThreshold(threshold)
    setOverview(nextOverview)
    setSelectedItem(nextSelectedItem)
    if (nextSelectedItem) {
      setEntryForm((current) => ({
        ...createEntryFormFromItem(nextSelectedItem),
        memo: current.memo,
        occurredAt: current.occurredAt || getTodayDateValue(),
      }))
    } else {
      setEntryForm(defaultEntryForm)
    }
    setStatus(
      visibleRows.length > 0
        ? `${visibleRows.length.toLocaleString('ko-KR')}개 품목을 표시 중입니다.`
        : '조건에 맞는 재고가 없습니다.',
    )
  }, [deferredQuery, filters, priorityItemId, selectedItemId])

  useEffect(() => {
    let active = true

    async function loadOptions() {
      try {
        const nextOptions = await getInventoryFilterOptions()
        if (!active) {
          return
        }
        setOptions(nextOptions)
      } catch (error) {
        console.error(error)
      }
    }

    void loadOptions()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    const searchFilters = {
      ...filters,
      query: deferredQuery,
    }

    async function loadItems() {
      try {
        await refreshInventory(searchFilters)
      } catch (error) {
        console.error(error)
        if (active) {
          setStatus('재고 목록을 불러오지 못했습니다.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadItems()
    return () => {
      active = false
    }
  }, [filters, deferredQuery, refreshInventory])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !isEditableElement(event.target)) {
        return
      }

      const hasCreateDraft =
        createForm.brandName.trim() !== '' ||
        createForm.patternName.trim() !== '' ||
        createForm.sizeLabel.trim() !== '' ||
        createForm.defaultCostPrice > 0 ||
        createForm.defaultSalePrice > 0 ||
        createForm.defaultDiscountRate > 0 ||
        createForm.initialQuantity > 0 ||
        createForm.memo.trim() !== '' ||
        createForm.publicQuoteEnabled ||
        createForm.publicQuoteUrl.trim() !== ''

      if (!selectedItem && !hasCreateDraft) {
        return
      }

      event.preventDefault()
      if (selectedItem) {
        refreshSequenceRef.current += 1
        setSelectedItem(null)
        setPriorityItemId(null)
        setEntryForm(defaultEntryForm)
        setFieldErrors({})
        setStatus('재고 입력을 취소했습니다.')
        return
      }

      setCreateForm(defaultCreateForm)
      setFieldErrors({})
      setStatus('신규 품목 입력을 취소했습니다.')
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [createForm, selectedItem])

  function updateFilter<Key extends keyof InventorySearchFilters>(key: Key, value: InventorySearchFilters[Key]) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function resetFilters() {
    setFilters(defaultFilters)
  }

  const activeFieldErrors: FieldValidationMap<InventoryFieldKey> = { ...fieldErrors }
  const currentQuantity = Number(entryForm.quantity)
  const currentUnitCostAmount = parseAmount(entryForm.unitCost)

  if (selectedItem) {
    delete activeFieldErrors['inventory-query']
  }

  if (Number.isFinite(currentQuantity) && currentQuantity >= 0) {
    delete activeFieldErrors['inventory-quantity']
  }

  if (entryForm.unitCost.trim() === '' || currentUnitCostAmount >= 0) {
    delete activeFieldErrors['inventory-unit-cost']
  }

  if (createForm.brandName.trim()) {
    delete activeFieldErrors['inventory-create-brand']
  }

  if (createForm.patternName.trim()) {
    delete activeFieldErrors['inventory-create-pattern']
  }

  if (createForm.sizeLabel.trim()) {
    delete activeFieldErrors['inventory-create-size']
  }

  async function handleSaveStockEntry() {
    const nextFieldErrors: FieldValidationMap<InventoryFieldKey> = {}
    const fieldOrder: InventoryFieldKey[] = []

    if (!selectedItem) {
      const message = '먼저 재고 입력할 상품을 선택해 주세요.'
      nextFieldErrors['inventory-query'] = message
      fieldOrder.push('inventory-query')
      setFieldErrors(nextFieldErrors)
      setStatus(message)
      await showValidationDialog([message], '재고 입력 확인')
      focusFieldErrorTarget(findFirstInvalidField(fieldOrder, nextFieldErrors) ?? 'inventory-query')
      return
    }

    const quantity = Number(entryForm.quantity)
    const issues: string[] = []

    if (!Number.isFinite(quantity) || quantity < 0) {
      const message = '재고 수량은 0개 이상으로 입력해 주세요.'
      issues.push(message)
      nextFieldErrors['inventory-quantity'] = message
      fieldOrder.push('inventory-quantity')
    }

    if (entryForm.unitCost.trim() !== '' && parseAmount(entryForm.unitCost) < 0) {
      const message = '노출가격은 0 이상이어야 합니다.'
      issues.push(message)
      nextFieldErrors['inventory-unit-cost'] = message
      fieldOrder.push('inventory-unit-cost')
    }

    if (issues.length > 0) {
      const firstField = findFirstInvalidField(fieldOrder, nextFieldErrors)
      setFieldErrors(nextFieldErrors)
      setStatus(issues[0] ?? '재고 입력값을 확인해 주세요.')
      await showValidationDialog(issues, '재고 입력 확인')
      if (firstField) {
        focusFieldErrorTarget(firstField)
      }
      return
    }

    try {
      setSaving(true)
      const predictedSelectedItem = {
        ...createUpdatedInventoryItem(selectedItem, entryForm),
        quantityOnHand: Math.max(0, Math.floor(quantity || 0)),
        quantityAvailable: Math.max(0, Math.floor(quantity || 0)),
        latestReceivedAt: `${entryForm.occurredAt || getTodayDateValue()} 00:00:00`,
      }
      const nextDefaultCostPrice =
        entryForm.unitCost.trim() === '' ? selectedItem.defaultCostPrice : parseAmount(entryForm.unitCost)
      const nextFiltersAfterCatalogChange = adjustFiltersForCatalogChange(filters, selectedItem, {
        brandName: entryForm.brandName,
        patternName: entryForm.patternName,
        sizeLabel: entryForm.sizeLabel,
      })
      await saveStockEntry({
        itemId: selectedItem.id,
        quantity,
        unitCost: parseAmount(entryForm.unitCost),
        occurredAt: entryForm.occurredAt,
        memo: entryForm.memo,
      })

      await saveItemCatalogSettings(selectedItem.id, {
        brandName: entryForm.brandName,
        patternName: entryForm.patternName,
        sizeLabel: entryForm.sizeLabel,
        defaultCostPrice: nextDefaultCostPrice,
        discountRate: Number(entryForm.discountRate || 0),
        publicQuoteEnabled: entryForm.publicQuoteEnabled,
        publicQuoteUrl: entryForm.publicQuoteUrl,
      })
      const updatedSelectedItem = (await getInventoryItemById(selectedItem.id)) ?? predictedSelectedItem
      if (nextFiltersAfterCatalogChange.changed) {
        setFilters(nextFiltersAfterCatalogChange.filters)
      }
      setPriorityItemId(selectedItem.id)
      setItems((current) => current.map((item) => (item.id === updatedSelectedItem.id ? updatedSelectedItem : item)))
      setSelectedItem(updatedSelectedItem)
      setEntryForm(createEntryFormFromItem(updatedSelectedItem))
      await refreshInventory(
        nextFiltersAfterCatalogChange.changed
          ? { ...nextFiltersAfterCatalogChange.filters, query: deferredQuery }
          : undefined,
        selectedItem.id,
        selectedItem.id,
        updatedSelectedItem,
      )
      setOptions(await getInventoryFilterOptions())
      setEntryForm({
        ...createEntryFormFromItem(updatedSelectedItem),
        memo: defaultEntryForm.memo,
        occurredAt: defaultEntryForm.occurredAt,
      })
      setFieldErrors({})
      setStatus('재고 입력이 완료되었습니다. 현재고와 할인율이 반영되었습니다.')
      await showMessageDialog('재고와 품목 설정이 저장되었습니다.', {
        title: '재고 반영 완료',
      })
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '재고 입력 중 오류가 발생했습니다.')
      await showErrorDialog(error, '재고 반영 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveCatalogSettings() {
    if (!selectedItem) {
      const message = '품목 설정을 저장할 재고를 먼저 선택해 주세요.'
      setStatus(message)
      return
    }

    try {
      setSaving(true)
      const predictedSelectedItem = createUpdatedInventoryItem(selectedItem, entryForm)
      const nextDefaultCostPrice =
        entryForm.unitCost.trim() === '' ? selectedItem.defaultCostPrice : parseAmount(entryForm.unitCost)
      const nextFiltersAfterCatalogChange = adjustFiltersForCatalogChange(filters, selectedItem, {
        brandName: entryForm.brandName,
        patternName: entryForm.patternName,
        sizeLabel: entryForm.sizeLabel,
      })
      await saveItemCatalogSettings(selectedItem.id, {
        brandName: entryForm.brandName,
        patternName: entryForm.patternName,
        sizeLabel: entryForm.sizeLabel,
        defaultCostPrice: nextDefaultCostPrice,
        discountRate: Number(entryForm.discountRate || 0),
        publicQuoteEnabled: entryForm.publicQuoteEnabled,
        publicQuoteUrl: entryForm.publicQuoteUrl,
      })
      const updatedSelectedItem = (await getInventoryItemById(selectedItem.id)) ?? predictedSelectedItem
      if (nextFiltersAfterCatalogChange.changed) {
        setFilters(nextFiltersAfterCatalogChange.filters)
      }
      setPriorityItemId(selectedItem.id)
      setItems((current) => current.map((item) => (item.id === updatedSelectedItem.id ? updatedSelectedItem : item)))
      setSelectedItem(updatedSelectedItem)
      setEntryForm(createEntryFormFromItem(updatedSelectedItem))
      await refreshInventory(
        nextFiltersAfterCatalogChange.changed
          ? { ...nextFiltersAfterCatalogChange.filters, query: deferredQuery }
          : undefined,
        selectedItem.id,
        selectedItem.id,
        updatedSelectedItem,
      )
      setOptions(await getInventoryFilterOptions())
      setStatus('품목 설정을 저장했습니다. 공개 견적 노출과 할인율이 반영되었습니다.')
      await showMessageDialog('품목 설정이 저장되었습니다.', {
        title: '품목 설정 저장',
      })
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '품목 설정 저장에 실패했습니다.')
      await showErrorDialog(error, '품목 설정 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateItem() {
    const issues: string[] = []
    const nextFieldErrors: FieldValidationMap<InventoryFieldKey> = {}
    const fieldOrder: InventoryFieldKey[] = []

    if (!createForm.brandName.trim()) {
      const message = '브랜드를 입력해 주세요.'
      issues.push(message)
      nextFieldErrors['inventory-create-brand'] = message
      fieldOrder.push('inventory-create-brand')
    }

    if (!createForm.patternName.trim()) {
      const message = '패턴을 입력해 주세요.'
      issues.push(message)
      nextFieldErrors['inventory-create-pattern'] = message
      fieldOrder.push('inventory-create-pattern')
    }

    if (!createForm.sizeLabel.trim()) {
      const message = '규격을 입력해 주세요.'
      issues.push(message)
      nextFieldErrors['inventory-create-size'] = message
      fieldOrder.push('inventory-create-size')
    }

    if (issues.length > 0) {
      const firstField = findFirstInvalidField(fieldOrder, nextFieldErrors)
      setFieldErrors((current) => ({
        ...current,
        ...nextFieldErrors,
      }))
      setStatus(issues[0] ?? '신규 품목 입력값을 확인해 주세요.')
      await showValidationDialog(issues, '신규 품목 확인')
      if (firstField) {
        focusFieldErrorTarget(firstField)
      }
      return
    }

    try {
      setCreating(true)
      const createdItemId = await createInventoryItem(createForm)
      setCreateForm(defaultCreateForm)
      setFieldErrors({})
      setPriorityItemId(createdItemId)
      await refreshInventory(undefined, createdItemId, createdItemId)
      setOptions(await getInventoryFilterOptions())
      setStatus('신규 품목을 등록했습니다.')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '신규 품목 등록에 실패했습니다.')
      await showErrorDialog(error, '신규 품목 등록 실패')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteItem(item: InventoryListRow) {
    const confirmed = await showConfirmDialog(`${item.brandName} ${item.patternName} ${item.sizeLabel} 품목을 삭제할까요?`, {
      title: '품목 삭제',
      kind: 'warning',
    })
    if (!confirmed) {
      return
    }

    try {
      setSaving(true)
      await deleteInventoryItem(item.id)
      setPriorityItemId((current) => (current === item.id ? null : current))
      setSelectedItem((current) => (current?.id === item.id ? null : current))
      await refreshInventory()
      setStatus('품목을 삭제했습니다. 기존 판매 이력은 그대로 유지됩니다.')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : '품목 삭제에 실패했습니다.')
      await showErrorDialog(error, '품목 삭제 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">재고</p>
          <h2>재고 조회 / 입력</h2>
          <p className="page-copy">
            브랜드, 패턴, 규격으로 빠르게 필터링하고, 기존 품목 재고조정과 신규 품목 등록을 한 화면에서 처리할 수
            있게 구성했습니다.
          </p>
        </div>
        <div className="status-pill">{loading ? '재고를 갱신하는 중입니다.' : status}</div>
      </header>

      <section className="panel">
        <div className="stat-grid compact-stat-grid">
          <article className="stat-card">
            <p className="stat-label">총 재고 수량</p>
            <strong className="stat-value">{overview.totalQuantity.toLocaleString('ko-KR')}</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">등록 품목 수</p>
            <strong className="stat-value">{overview.itemCount.toLocaleString('ko-KR')}</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">저재고 품목</p>
            <strong className="stat-value">{overview.lowStockItemCount.toLocaleString('ko-KR')}</strong>
          </article>
          <article className="stat-card">
            <p className="stat-label">저재고 기준</p>
            <strong className="stat-value">{lowStockThreshold.toLocaleString('ko-KR')}개 이하</strong>
          </article>
        </div>
      </section>

      <section className="content-grid content-grid-wide inventory-layout">
        <article className="panel">
          <div className="filter-grid">
            <label className={`field field-wide${activeFieldErrors['inventory-query'] ? ' has-error' : ''}`}>
              <span>통합 검색</span>
              <input
                aria-invalid={Boolean(activeFieldErrors['inventory-query'])}
                data-field-error-target="inventory-query"
                onChange={(event) => updateFilter('query', event.target.value)}
                placeholder="예: 145 / 145 13 / 145 r 13 / 2554519"
                value={filters.query}
              />
              {activeFieldErrors['inventory-query'] ? (
                <small className="field-error-text">{activeFieldErrors['inventory-query']}</small>
              ) : null}
            </label>

            <label className="field">
              <span>브랜드</span>
              <select
                className="field-select"
                onChange={(event) => updateFilter('brandName', event.target.value)}
                value={filters.brandName}
              >
                <option value="">전체 브랜드</option>
                {options.brands.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>패턴</span>
              <select
                className="field-select"
                onChange={(event) => updateFilter('patternName', event.target.value)}
                value={filters.patternName}
              >
                <option value="">전체 패턴</option>
                {options.patterns.map((pattern) => (
                  <option key={pattern} value={pattern}>
                    {pattern}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>규격</span>
              <select
                className="field-select"
                onChange={(event) => updateFilter('sizeLabel', event.target.value)}
                value={filters.sizeLabel}
              >
                <option value="">전체 규격</option>
                {options.sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>입고일</span>
              <input
                onChange={(event) => updateFilter('receivedDate', event.target.value)}
                type="date"
                value={filters.receivedDate}
              />
            </label>

            <label className="field">
              <span>재고 상태</span>
              <select
                className="field-select"
                onChange={(event) =>
                  updateFilter('stockMode', event.target.value as InventorySearchFilters['stockMode'])
                }
                value={filters.stockMode}
              >
                <option value="all">전체</option>
                <option value="in-stock">재고 있음</option>
                <option value="out-of-stock">품절만</option>
              </select>
            </label>
          </div>

          <div className="button-row">
            <button className="secondary-button" onClick={resetFilters} type="button">
              필터 초기화
            </button>
          </div>

          <div className="note-box compact-note">
            규격 검색은 `145`, `145 13`, `145 r 13`, `2554519`처럼 띄어쓰기 없이 적어도 인식합니다.
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>브랜드</th>
                  <th>패턴</th>
                  <th>규격</th>
                  <th>입고일</th>
                  <th>현재고</th>
                  <th>할인율</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.brandName}</td>
                    <td>{item.patternName}</td>
                    <td>{item.sizeLabel}</td>
                    <td>{formatReceivedDate(item.latestReceivedAt)}</td>
                    <td>
                      <span className={`stock-badge ${getStockBadgeClass(item.quantityAvailable, lowStockThreshold)}`}>
                        {getStockBadgeLabel(item.quantityAvailable, lowStockThreshold)}
                      </span>
                    </td>
                    <td>{item.defaultDiscountRate > 0 ? `${item.defaultDiscountRate}%` : '-'}</td>
                    <td>
                      <div className="button-row" style={{ marginTop: 0, justifyContent: 'flex-end' }}>
                        <button className="table-action" onClick={() => {
                          refreshSequenceRef.current += 1
                          setPriorityItemId(null)
                          setSelectedItem(item)
                          setEntryForm(createEntryFormFromItem(item))
                          requestAnimationFrame(() => {
                            sidePanelRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            })
                          })
                        }} type="button">
                          선택
                        </button>
                        <button className="table-action" disabled={saving} onClick={() => {
                          void handleDeleteItem(item)
                        }} type="button">
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan={7}>
                      표시할 재고가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel inventory-side-panel" ref={sidePanelRef}>
          <h3>재고 입력 / 신규 품목 등록</h3>
          {selectedItem ? (
            <>
              <div className="selected-item-card">
                <strong>
                  {selectedItem.brandName} {selectedItem.patternName}
                </strong>
                <p>{selectedItem.sizeLabel}</p>
                <div className="selected-item-meta">
                  <span className={`stock-badge ${getStockBadgeClass(selectedItem.quantityAvailable, lowStockThreshold)}`}>
                    {getStockBadgeLabel(selectedItem.quantityAvailable, lowStockThreshold)}
                  </span>
                  <span>입고일 {formatReceivedDate(selectedItem.latestReceivedAt)}</span>
                  <span>할인율 {Number(entryForm.discountRate || 0)}%</span>
                  <span>{entryForm.publicQuoteEnabled ? '공개 견적 노출' : '공개 견적 비노출'}</span>
                </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>브랜드</span>
                  <input
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        brandName: event.target.value,
                      }))
                    }
                    value={entryForm.brandName}
                  />
                </label>

                <label className="field">
                  <span>패턴</span>
                  <input
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        patternName: event.target.value,
                      }))
                    }
                    value={entryForm.patternName}
                  />
                </label>

                <label className="field">
                  <span>규격</span>
                  <input
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        sizeLabel: event.target.value,
                      }))
                    }
                    value={entryForm.sizeLabel}
                  />
                </label>

                <label className={`field${activeFieldErrors['inventory-quantity'] ? ' has-error' : ''}`}>
                  <span>현재 재고</span>
                  <input
                    aria-invalid={Boolean(activeFieldErrors['inventory-quantity'])}
                    data-field-error-target="inventory-quantity"
                    min={0}
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                    type="number"
                    value={entryForm.quantity}
                  />
                  {activeFieldErrors['inventory-quantity'] ? (
                    <small className="field-error-text">{activeFieldErrors['inventory-quantity']}</small>
                  ) : (
                    <small className="field-hint">사용자가 계산한 최종 재고 수량을 그대로 입력합니다.</small>
                  )}
                </label>

                <label className={`field${activeFieldErrors['inventory-unit-cost'] ? ' has-error' : ''}`}>
                  <span>노출가격(원)</span>
                  <input
                    aria-invalid={Boolean(activeFieldErrors['inventory-unit-cost'])}
                    data-field-error-target="inventory-unit-cost"
                    inputMode="numeric"
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        unitCost: sanitizeAmountInput(event.target.value),
                      }))
                    }
                    placeholder="선택 입력"
                    type="text"
                    value={entryForm.unitCost}
                  />
                  {activeFieldErrors['inventory-unit-cost'] ? (
                    <small className="field-error-text">{activeFieldErrors['inventory-unit-cost']}</small>
                  ) : (
                    <small className="field-hint">{getAmountFieldPreview(entryForm.unitCost)}</small>
                  )}
                </label>

                <label className="field">
                  <span>반영 날짜</span>
                  <div className="inline-field">
                    <input
                      onChange={(event) =>
                        setEntryForm((current) => ({
                          ...current,
                          occurredAt: event.target.value,
                        }))
                      }
                      ref={receivedDateInputRef}
                      type="date"
                      value={entryForm.occurredAt}
                    />
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const input = receivedDateInputRef.current
                        if (!input) {
                          return
                        }

                        if (typeof input.showPicker === 'function') {
                          input.showPicker()
                          return
                        }

                        input.focus()
                        input.click()
                      }}
                      type="button"
                    >
                      날짜 수정
                    </button>
                  </div>
                </label>

                <label className="field">
                  <span>품목 할인율(%)</span>
                  <input
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        discountRate: normalizeDiscountInput(event.target.value),
                      }))
                    }
                    type="text"
                    value={entryForm.discountRate}
                  />
                </label>

                <label className="field checkbox-field">
                  <span>공개 견적 노출</span>
                  <label className="checkbox-inline">
                    <input
                      checked={entryForm.publicQuoteEnabled}
                      onChange={(event) =>
                        setEntryForm((current) => ({
                          ...current,
                          publicQuoteEnabled: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>이 품목을 홈페이지 견적 목록에 노출합니다.</span>
                  </label>
                </label>

                <label className="field field-wide">
                  <span>네이버 스토어 URL</span>
                  <input
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        publicQuoteUrl: event.target.value,
                      }))
                    }
                    placeholder="https://smartstore.naver.com/tire_sotre/products/..."
                    value={entryForm.publicQuoteUrl}
                  />
                </label>

                <label className="field field-wide">
                  <span>메모</span>
                  <input
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        memo: event.target.value,
                      }))
                    }
                    placeholder="예: 3월 13일 신규 입고"
                    value={entryForm.memo}
                  />
                </label>
              </div>

              <div className="button-row">
                <button className="secondary-button" disabled={saving} onClick={handleSaveCatalogSettings} type="button">
                  {saving ? '저장 중..' : '품목 설정 저장'}
                </button>
                <button className="primary-button" disabled={saving} onClick={handleSaveStockEntry} type="button">
                  {saving ? '저장 중..' : '재고 반영'}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state-box">
              <strong>먼저 왼쪽 목록에서 품목을 선택해 주세요.</strong>
              <p>선택한 품목에 대해 입고, 재고조정, 할인율 수정이 가능합니다.</p>
            </div>
          )}

          <div className="note-box" style={{ marginTop: '1rem' }}>
            <strong>신규 품목 등록</strong>
            <p>새 브랜드, 새 패턴, 새 규격이 들어왔을 때 여기서 바로 등록할 수 있습니다.</p>
          </div>

          <div className="form-grid">
            <label className={`field${activeFieldErrors['inventory-create-brand'] ? ' has-error' : ''}`}>
              <span>브랜드</span>
              <input
                aria-invalid={Boolean(activeFieldErrors['inventory-create-brand'])}
                data-field-error-target="inventory-create-brand"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    brandName: event.target.value,
                  }))
                }
                value={createForm.brandName}
              />
              {activeFieldErrors['inventory-create-brand'] ? (
                <small className="field-error-text">{activeFieldErrors['inventory-create-brand']}</small>
              ) : null}
            </label>

            <label className={`field${activeFieldErrors['inventory-create-pattern'] ? ' has-error' : ''}`}>
              <span>패턴</span>
              <input
                aria-invalid={Boolean(activeFieldErrors['inventory-create-pattern'])}
                data-field-error-target="inventory-create-pattern"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    patternName: event.target.value,
                  }))
                }
                value={createForm.patternName}
              />
              {activeFieldErrors['inventory-create-pattern'] ? (
                <small className="field-error-text">{activeFieldErrors['inventory-create-pattern']}</small>
              ) : null}
            </label>

            <label className={`field${activeFieldErrors['inventory-create-size'] ? ' has-error' : ''}`}>
              <span>규격</span>
              <input
                aria-invalid={Boolean(activeFieldErrors['inventory-create-size'])}
                data-field-error-target="inventory-create-size"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    sizeLabel: event.target.value,
                  }))
                }
                placeholder="예: 255 45 19"
                value={createForm.sizeLabel}
              />
              {activeFieldErrors['inventory-create-size'] ? (
                <small className="field-error-text">{activeFieldErrors['inventory-create-size']}</small>
              ) : null}
            </label>

            <label className="field">
              <span>노출가격(원)</span>
              <input
                inputMode="numeric"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    defaultCostPrice: parseAmount(event.target.value),
                  }))
                }
                type="text"
                value={createForm.defaultCostPrice > 0 ? String(createForm.defaultCostPrice) : ''}
              />
            </label>

            <label className="field">
              <span>할인율(%)</span>
              <input
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    defaultDiscountRate: Number(normalizeDiscountInput(event.target.value)),
                  }))
                }
                type="text"
                value={createForm.defaultDiscountRate > 0 ? String(createForm.defaultDiscountRate) : '0'}
              />
            </label>

            <label className="field">
              <span>초기 재고</span>
              <input
                min={0}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    initialQuantity: Math.max(0, Math.floor(Number(event.target.value || 0))),
                  }))
                }
                type="number"
                value={createForm.initialQuantity}
              />
            </label>

            <label className="field checkbox-field">
              <span>공개 견적 노출</span>
              <label className="checkbox-inline">
                <input
                  checked={createForm.publicQuoteEnabled}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      publicQuoteEnabled: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>이 품목을 홈페이지 견적 목록에 노출합니다.</span>
              </label>
            </label>

            <label className="field field-wide">
              <span>네이버 스토어 URL</span>
              <input
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    publicQuoteUrl: event.target.value,
                  }))
                }
                placeholder="https://smartstore.naver.com/tire_sotre/products/..."
                value={createForm.publicQuoteUrl}
              />
            </label>

            <label className="field field-wide">
              <span>메모</span>
              <input
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    memo: event.target.value,
                  }))
                }
                value={createForm.memo}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="primary-button" disabled={creating} onClick={handleCreateItem} type="button">
              {creating ? '등록 중..' : '신규 품목 등록'}
            </button>
          </div>
        </article>
      </section>
    </section>
  )
}
