import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  findFirstInvalidField,
  focusFieldErrorTarget,
  showErrorDialog,
  showValidationDialog,
  type FieldValidationMap,
} from '../../lib/dialogs'
import {
  applyVendorPriceWorkbook,
  detectImportFiles,
  getRuntimeInfo,
  importInitialData,
  parseVendorPriceWorkbook,
} from '../../lib/desktop'
import { ensureReferenceData } from '../../lib/referenceData'
import type {
  InitialImportResult,
  ParsedVendorPriceWorkbook,
  RuntimeInfo,
  VendorPriceImportResult,
} from '../../lib/types'

type ImportFieldKey = 'imports-inventory-path' | 'imports-sales-path'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return '가져오기 중 오류가 발생했습니다.'
  }
}

export function ImportsPage() {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [inventoryPath, setInventoryPath] = useState('')
  const [salesPath, setSalesPath] = useState('')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('다운로드 폴더에서 기본 엑셀 파일을 자동 감지합니다.')
  const [result, setResult] = useState<InitialImportResult | null>(null)
  const [vendorPricePath, setVendorPricePath] = useState('')
  const [vendorPreview, setVendorPreview] = useState<ParsedVendorPriceWorkbook | null>(null)
  const [vendorImportResult, setVendorImportResult] = useState<VendorPriceImportResult | null>(null)
  const [previewingVendorPrice, setPreviewingVendorPrice] = useState(false)
  const [applyingVendorPrice, setApplyingVendorPrice] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldValidationMap<ImportFieldKey>>({})
  const activeFieldErrors: FieldValidationMap<ImportFieldKey> = { ...fieldErrors }

  if (inventoryPath) {
    delete activeFieldErrors['imports-inventory-path']
  }

  if (salesPath) {
    delete activeFieldErrors['imports-sales-path']
  }

  useEffect(() => {
    let active = true

    async function loadRuntime() {
      try {
        const info = await getRuntimeInfo()
        if (!active) {
          return
        }

        setRuntimeInfo(info)
        setInventoryPath(info.detectedFiles.inventoryPath ?? '')
        setSalesPath(info.detectedFiles.salesPath ?? '')
      } catch (error) {
        console.error(error)
        if (active) {
          setMessage('기본 경로를 읽는 중 오류가 발생했습니다.')
        }
        await showErrorDialog(error, '가져오기 준비 실패')
      }
    }

    void loadRuntime()
    return () => {
      active = false
    }
  }, [])

  async function handleDetectFiles() {
    try {
      const files = await detectImportFiles()
      setInventoryPath(files.inventoryPath ?? '')
      setSalesPath(files.salesPath ?? '')
      setMessage('최신 엑셀 파일 경로를 다시 감지했습니다.')
    } catch (error) {
      console.error(error)
      setMessage('엑셀 파일 자동 감지에 실패했습니다.')
      await showErrorDialog(error, '파일 자동 감지 실패')
    }
  }

  async function handleBrowseInventory() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      defaultPath: inventoryPath || runtimeInfo?.detectedFiles.inventoryPath || undefined,
    })

    if (typeof selected === 'string') {
      setInventoryPath(selected)
    }
  }

  async function handleBrowseSales() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      defaultPath: salesPath || runtimeInfo?.detectedFiles.salesPath || undefined,
    })

    if (typeof selected === 'string') {
      setSalesPath(selected)
    }
  }

  async function handleRunImport() {
    if (!inventoryPath || !salesPath) {
      const issues: string[] = []
      const nextFieldErrors: FieldValidationMap<ImportFieldKey> = {}
      const fieldOrder: ImportFieldKey[] = []
      if (!inventoryPath) {
        const message = '재고관리 파일을 선택해 주세요.'
        issues.push(message)
        nextFieldErrors['imports-inventory-path'] = message
        fieldOrder.push('imports-inventory-path')
      }
      if (!salesPath) {
        const message = '판매일보 파일을 선택해 주세요.'
        issues.push(message)
        nextFieldErrors['imports-sales-path'] = message
        fieldOrder.push('imports-sales-path')
      }
      const firstField = findFirstInvalidField(fieldOrder, nextFieldErrors)
      setFieldErrors((current) => ({
        ...current,
        ...nextFieldErrors,
      }))
      setMessage(issues[0] ?? '가져오기 파일을 확인해 주세요.')
      await showValidationDialog(issues, '가져오기 파일 확인')
      if (firstField) {
        focusFieldErrorTarget(firstField)
      }
      return
    }

    setRunning(true)
    setResult(null)
    setMessage('엑셀 파일을 읽고 DB를 초기화하는 중입니다. 잠시만 기다려 주세요.')

    try {
      const importResult = await importInitialData(inventoryPath, salesPath)
      await ensureReferenceData()
      setFieldErrors({})
      setResult(importResult)
      setMessage('초기 데이터 가져오기와 기준 데이터 정리가 완료되었습니다.')
    } catch (error) {
      console.error(error)
      setMessage(getErrorMessage(error))
      await showErrorDialog(error, '초기 데이터 가져오기 실패')
    } finally {
      setRunning(false)
    }
  }

  async function handleBrowseVendorPrice() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      defaultPath: vendorPricePath || undefined,
    })

    if (typeof selected === 'string') {
      setVendorPricePath(selected)
    }
  }

  async function handlePreviewVendorPrice() {
    if (!vendorPricePath.trim()) {
      setMessage('공급사 가격표 파일을 먼저 선택해 주세요.')
      await showValidationDialog(['공급사 가격표 파일을 먼저 선택해 주세요.'], '가격표 확인')
      return
    }

    try {
      setPreviewingVendorPrice(true)
      setVendorImportResult(null)
      setMessage('공급사 가격표를 읽고 현재 재고와 매칭하는 중입니다.')
      const preview = await parseVendorPriceWorkbook(vendorPricePath.trim())
      setVendorPreview(preview)
      setMessage('공급사 가격표 미리보기를 불러왔습니다.')
    } catch (error) {
      console.error(error)
      setMessage(getErrorMessage(error))
      await showErrorDialog(error, '가격표 미리보기 실패')
    } finally {
      setPreviewingVendorPrice(false)
    }
  }

  async function handleApplyVendorPrice() {
    if (!vendorPricePath.trim()) {
      setMessage('공급사 가격표 파일을 먼저 선택해 주세요.')
      await showValidationDialog(['공급사 가격표 파일을 먼저 선택해 주세요.'], '가격표 확인')
      return
    }

    try {
      setApplyingVendorPrice(true)
      setMessage('공급사 가격표의 부가세 포함 금액을 재고 원가에 반영하는 중입니다.')
      const applyResult = await applyVendorPriceWorkbook(vendorPricePath.trim())
      setVendorImportResult(applyResult)
      setVendorPreview(await parseVendorPriceWorkbook(vendorPricePath.trim()))
      setMessage('공급사 가격표 반영이 완료되었습니다.')
    } catch (error) {
      console.error(error)
      setMessage(getErrorMessage(error))
      await showErrorDialog(error, '가격표 반영 실패')
    } finally {
      setApplyingVendorPrice(false)
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Import</p>
          <h2>엑셀 가져오기</h2>
          <p className="page-copy">
            파일 열기 대화상자로 엑셀을 선택한 뒤 초기 데이터를 가져옵니다. 판매이력은
            조회용으로 가져오고, 현재 재고는 재고관리 파일 기준으로 잡습니다.
          </p>
        </div>
        <div className="status-pill">{message}</div>
      </header>

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <h3>가져오기 파일 선택</h3>
          <div className="form-grid">
            <label className={`field field-wide${activeFieldErrors['imports-inventory-path'] ? ' has-error' : ''}`}>
              <span>재고관리 파일</span>
              <div className="inline-field">
                <input
                  aria-invalid={Boolean(activeFieldErrors['imports-inventory-path'])}
                  data-field-error-target="imports-inventory-path"
                  value={inventoryPath}
                  onChange={(event) => setInventoryPath(event.target.value)}
                  placeholder="재고관리 엑셀을 선택해 주세요."
                />
                <button className="secondary-button" onClick={handleBrowseInventory} type="button">
                  파일 열기
                </button>
              </div>
              {activeFieldErrors['imports-inventory-path'] ? (
                <small className="field-error-text">{activeFieldErrors['imports-inventory-path']}</small>
              ) : null}
            </label>

            <label className={`field field-wide${activeFieldErrors['imports-sales-path'] ? ' has-error' : ''}`}>
              <span>판매일보 파일</span>
              <div className="inline-field">
                <input
                  aria-invalid={Boolean(activeFieldErrors['imports-sales-path'])}
                  data-field-error-target="imports-sales-path"
                  value={salesPath}
                  onChange={(event) => setSalesPath(event.target.value)}
                  placeholder="판매일보 엑셀을 선택해 주세요."
                />
                <button className="secondary-button" onClick={handleBrowseSales} type="button">
                  파일 열기
                </button>
              </div>
              {activeFieldErrors['imports-sales-path'] ? (
                <small className="field-error-text">{activeFieldErrors['imports-sales-path']}</small>
              ) : null}
            </label>
          </div>

          <div className="button-row">
            <button className="secondary-button" onClick={handleDetectFiles} type="button">
              다운로드 폴더 다시 감지
            </button>
            <button className="primary-button" disabled={running} onClick={handleRunImport} type="button">
              {running ? '가져오는 중...' : '초기 데이터 가져오기'}
            </button>
          </div>

          <div className="note-box">
            <strong>현재 방식</strong>
            <p>
              이 기능은 현재 프로그램 DB를 엑셀 기준으로 다시 만듭니다. `판매일보`의 최근 판매 이력과
              `재고관리`의 고객등록 시트에 있는 과거 판매 이력까지 함께 분석해서 가져옵니다.
            </p>
          </div>
        </article>

        <article className="panel">
          <h3>자동 감지 결과</h3>
          <dl className="info-list">
            <div>
              <dt>감지된 재고관리</dt>
              <dd>{runtimeInfo?.detectedFiles.inventoryPath ?? '없음'}</dd>
            </div>
            <div>
              <dt>감지된 판매일보</dt>
              <dd>{runtimeInfo?.detectedFiles.salesPath ?? '없음'}</dd>
            </div>
            <div>
              <dt>DB 저장 위치</dt>
              <dd>{runtimeInfo?.dbPath ?? '-'}</dd>
            </div>
          </dl>
        </article>
      </section>

      {result ? (
        <section className="content-grid">
          <article className="panel">
            <h3>가져오기 결과</h3>
            <ul className="stack-list">
              <li>상품 {result.itemCount.toLocaleString('ko-KR')}개</li>
              <li>판매이력 {result.salesCount.toLocaleString('ko-KR')}건</li>
              <li>고객등록 시트 과거 판매 {result.historicalSalesCount.toLocaleString('ko-KR')}건</li>
              <li>고객 {result.customerCount.toLocaleString('ko-KR')}명</li>
              <li>차량 {result.vehicleCount.toLocaleString('ko-KR')}대</li>
              <li>고객등록 시트 고객 seed {result.customerSeedCount.toLocaleString('ko-KR')}건</li>
              <li>매칭되지 않은 타이어 이력 {result.unmatchedTireLines.toLocaleString('ko-KR')}건</li>
              <li>판매량 검증 필요 {result.salesValidationIssueCount.toLocaleString('ko-KR')}건</li>
            </ul>
          </article>

          <article className="panel">
            <h3>적용 규칙</h3>
            <ul className="stack-list">
              <li>재고는 재고관리 파일의 현재고를 기준으로 저장합니다.</li>
              <li>판매이력은 조회용으로 가져오며, 현재고를 다시 차감하지 않습니다.</li>
              <li>앞으로 프로그램에서 저장하는 새 판매만 재고를 실제로 줄입니다.</li>
            </ul>
          </article>
        </section>
      ) : null}

      <section className="content-grid content-grid-wide">
        <article className="panel">
          <h3>공급사 가격표 반영</h3>
          <p className="page-copy" style={{ marginTop: 0 }}>
            업체에서 받은 가격표 엑셀의 `부가세 포함` 금액을 현재 재고 품목의 원가로 반영합니다. 이번 버전은
            `브랜드 / 상품명(또는 패턴코드) / 규격`을 기준으로 자동 매칭하며, 형식이 크게 다른 업체 파일은 다음에
            템플릿 방식으로 더 확장할 수 있습니다.
          </p>

          <div className="form-grid">
            <label className="field field-wide">
              <span>공급사 가격표 파일</span>
              <div className="inline-field">
                <input
                  onChange={(event) => setVendorPricePath(event.target.value)}
                  placeholder="가격표 엑셀(.xlsx)을 선택해 주세요."
                  value={vendorPricePath}
                />
                <button className="secondary-button" onClick={handleBrowseVendorPrice} type="button">
                  파일 열기
                </button>
              </div>
            </label>
          </div>

          <div className="button-row">
            <button
              className="secondary-button"
              disabled={previewingVendorPrice || applyingVendorPrice}
              onClick={handlePreviewVendorPrice}
              type="button"
            >
              {previewingVendorPrice ? '미리보는 중...' : '미리보기'}
            </button>
            <button
              className="primary-button"
              disabled={previewingVendorPrice || applyingVendorPrice}
              onClick={handleApplyVendorPrice}
              type="button"
            >
              {applyingVendorPrice ? '반영 중...' : '재고 원가 반영'}
            </button>
          </div>

          <div className="note-box">
            <strong>추천 운영 방식</strong>
            <p>
              별도 변환 프로그램을 따로 두기보다, 이 화면에서 공급사별 파일을 바로 읽고 반영하는 편이 더 관리하기
              쉽습니다. 형식이 다른 업체 파일이 늘어나면 다음 단계에서 `업체별 컬럼 매핑 템플릿`을 저장하도록
              확장하면 됩니다.
            </p>
          </div>
        </article>

        <article className="panel">
          <h3>가격표 미리보기</h3>
          {vendorPreview ? (
            <>
              <dl className="info-list">
                <div>
                  <dt>시트</dt>
                  <dd>{vendorPreview.sheetName}</dd>
                </div>
                <div>
                  <dt>감지 브랜드</dt>
                  <dd>{vendorPreview.detectedBrandName || '자동 감지 없음'}</dd>
                </div>
                <div>
                  <dt>가격 열</dt>
                  <dd>{vendorPreview.priceColumnLabel}</dd>
                </div>
                <div>
                  <dt>전체 행</dt>
                  <dd>{vendorPreview.rowCount.toLocaleString('ko-KR')}건</dd>
                </div>
                <div>
                  <dt>매칭</dt>
                  <dd>
                    {vendorPreview.matchedRowCount.toLocaleString('ko-KR')}건 / 미매칭{' '}
                    {vendorPreview.unmatchedRowCount.toLocaleString('ko-KR')}건
                  </dd>
                </div>
                <div>
                  <dt>0원 행</dt>
                  <dd>{vendorPreview.zeroPriceRowCount.toLocaleString('ko-KR')}건</dd>
                </div>
              </dl>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>행</th>
                      <th>브랜드</th>
                      <th>상품명 / 패턴코드</th>
                      <th>규격</th>
                      <th>부가세 포함</th>
                      <th>매칭 품목</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorPreview.previewRows.map((row) => (
                      <tr key={`${row.rowNumber}-${row.sizeLabel}-${row.patternCode}`}>
                        <td>{row.rowNumber}</td>
                        <td>{row.brandName || '-'}</td>
                        <td>
                          <strong>{row.productName || '상품명 없음'}</strong>
                          <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                            패턴코드 {row.patternCode || '-'}
                          </div>
                        </td>
                        <td>{row.sizeLabel}</td>
                        <td>{row.priceVatIncluded.toLocaleString('ko-KR')}원</td>
                        <td>{row.matchedItemCount.toLocaleString('ko-KR')}건</td>
                      </tr>
                    ))}
                    {vendorPreview.previewRows.length === 0 ? (
                      <tr>
                        <td className="empty-cell" colSpan={6}>
                          표시할 미리보기 행이 없습니다.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state-box">
              <strong>가격표 파일을 선택한 뒤 미리보기를 실행해 주세요.</strong>
              <p>현재 재고에 몇 건이 매칭되는지 먼저 확인한 뒤 원가 반영을 진행할 수 있습니다.</p>
            </div>
          )}

          {vendorImportResult ? (
            <div className="note-box" style={{ marginTop: '1rem' }}>
              <strong>최근 반영 결과</strong>
              <p>
                {vendorImportResult.updatedItemCount.toLocaleString('ko-KR')}개 품목 원가를 갱신했고, 가격표 행 기준으로는{' '}
                {vendorImportResult.updatedRowCount.toLocaleString('ko-KR')}건을 반영했습니다. 미매칭은{' '}
                {vendorImportResult.unmatchedRowCount.toLocaleString('ko-KR')}건입니다.
              </p>
            </div>
          ) : null}
        </article>
      </section>
    </section>
  )
}
