import type { FormEvent } from 'react'
import { useDeferredValue, useEffect, useState } from 'react'
import { formatMoney, normalizePhone } from '../../lib/normalize'
import type { PublicQuoteFeed, QuoteEstimateInput, QuoteInquiryInput, QuoteInquiryResponse } from '../../lib/types'
import { fetchPublicQuoteFeed, submitQuoteInquiry } from '../publicQuote/publicQuoteApi'
import {
  DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL,
  buildQuoteEstimate,
  createDefaultPublicQuoteFeed,
  isPublicQuoteFeedStale,
  matchPublicQuoteItems,
} from '../publicQuote/quoteUtils'
import './HomePage.css'

type InquiryFormState = {
  customerName: string
  phone: string
  plateNumber: string
  vehicleModel: string
  desiredVisitAt: string
  memo: string
}

const defaultInquiryForm: InquiryFormState = {
  customerName: '',
  phone: '',
  plateNumber: '',
  vehicleModel: '',
  desiredVisitAt: '',
  memo: '',
}

const quickFilters = [
  { label: '경차 교체', query: '모닝 스파크 레이', sizeLabel: '', brandName: '' },
  { label: '전기차 상담', query: '테슬라 넥쏘 전기차', sizeLabel: '', brandName: '' },
  { label: '화물차 상담', query: '포터 봉고 화물차', sizeLabel: '', brandName: '' },
  { label: '한국타이어', query: '', sizeLabel: '', brandName: '한국타이어' },
  { label: '넥센타이어', query: '', sizeLabel: '', brandName: '넥센타이어' },
]

function getPublishedLabel(feed: PublicQuoteFeed) {
  if (!feed.lastPublishedAt) {
    return '아직 공개 견적 피드가 발행되지 않았습니다.'
  }

  const publishedAt = Date.parse(feed.lastPublishedAt)
  if (!Number.isFinite(publishedAt)) {
    return feed.lastPublishedAt
  }

  return new Date(publishedAt).toLocaleString('ko-KR')
}

export function HomePage() {
  const [feed, setFeed] = useState<PublicQuoteFeed>(createDefaultPublicQuoteFeed())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [sizeLabel, setSizeLabel] = useState('')
  const [brandName, setBrandName] = useState('')
  const [quantity, setQuantity] = useState<2 | 4>(4)
  const [includeInstallation, setIncludeInstallation] = useState(true)
  const [includeAlignment, setIncludeAlignment] = useState(false)
  const [selectedSkuCode, setSelectedSkuCode] = useState('')
  const [inquiryForm, setInquiryForm] = useState<InquiryFormState>(defaultInquiryForm)
  const [submitState, setSubmitState] = useState<{
    running: boolean
    error: string
    result: QuoteInquiryResponse | null
  }>({
    running: false,
    error: '',
    result: null,
  })

  const deferredVehicleQuery = useDeferredValue(vehicleQuery)

  useEffect(() => {
    let active = true

    async function loadFeed() {
      try {
        const nextFeed = await fetchPublicQuoteFeed()
        if (!active) {
          return
        }

        setFeed({
          ...createDefaultPublicQuoteFeed(),
          ...nextFeed,
          store: {
            ...createDefaultPublicQuoteFeed().store,
            ...nextFeed.store,
          },
        })
        setLoadError('')
      } catch (error) {
        console.error(error)
        if (!active) {
          return
        }

        setFeed(createDefaultPublicQuoteFeed())
        setLoadError(error instanceof Error ? error.message : '최신 견적 데이터를 불러오지 못했습니다.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadFeed()

    return () => {
      active = false
    }
  }, [])

  const estimateInput: QuoteEstimateInput = {
    vehicleQuery: deferredVehicleQuery,
    sizeLabel,
    brandName,
    quantity,
    includeInstallation,
    includeAlignment,
  }

  const matchedItems = matchPublicQuoteItems(feed, estimateInput)
  const selectedItem =
    matchedItems.find((item) => item.skuCode === selectedSkuCode) ??
    (matchedItems.length > 0 ? matchedItems[0] : null)

  const estimate = selectedItem ? buildQuoteEstimate(selectedItem, feed, estimateInput) : null
  const hasStaleFeed = isPublicQuoteFeedStale(feed.lastPublishedAt)
  const publishedLabel = getPublishedLabel(feed)
  const storePhoneLink = feed.store.phoneNumber ? `tel:${normalizePhone(feed.store.phoneNumber)}` : ''
  const primaryStoreUrl = selectedItem?.publicQuoteUrl || feed.store.naverStoreUrl || DEFAULT_PUBLIC_QUOTE_NAVER_STORE_URL

  useEffect(() => {
    if (!selectedItem) {
      setSelectedSkuCode('')
      return
    }

    if (!selectedSkuCode || !matchedItems.some((item) => item.skuCode === selectedSkuCode)) {
      setSelectedSkuCode(selectedItem.skuCode)
    }
  }, [matchedItems, selectedItem, selectedSkuCode])

  function applyQuickFilter(filter: (typeof quickFilters)[number]) {
    setVehicleQuery(filter.query)
    setSizeLabel(filter.sizeLabel)
    setBrandName(filter.brandName)
  }

  function updateInquiryForm<Key extends keyof InquiryFormState>(key: Key, value: InquiryFormState[Key]) {
    setInquiryForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleInquirySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!estimate) {
      setSubmitState({
        running: false,
        error: '먼저 견적 가능한 상품을 선택해 주세요.',
        result: null,
      })
      return
    }

    if (!inquiryForm.customerName.trim() || !normalizePhone(inquiryForm.phone).trim()) {
      setSubmitState({
        running: false,
        error: '이름과 연락처를 입력해 주세요.',
        result: null,
      })
      return
    }

    const payload: QuoteInquiryInput = {
      customerName: inquiryForm.customerName.trim(),
      phone: inquiryForm.phone.trim(),
      plateNumber: inquiryForm.plateNumber.trim(),
      vehicleModel: inquiryForm.vehicleModel.trim() || deferredVehicleQuery.trim(),
      desiredVisitAt: inquiryForm.desiredVisitAt,
      memo: inquiryForm.memo.trim(),
      estimate,
    }

    try {
      setSubmitState({
        running: true,
        error: '',
        result: null,
      })

      const result = await submitQuoteInquiry(payload)
      setSubmitState({
        running: false,
        error: '',
        result,
      })
      setInquiryForm(defaultInquiryForm)
    } catch (error) {
      console.error(error)
      setSubmitState({
        running: false,
        error: error instanceof Error ? error.message : '문의 접수에 실패했습니다.',
        result: null,
      })
    }
  }

  return (
    <div className="marketing-page">
      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="eyebrow">Ilsan · Paju Tire Quote</p>
          <h1>일산 · 파주 타이어 상담을 더 빠르게, 더 정확하게.</h1>
          <p>
            타이어스토어 식사점의 공개 재고 피드를 바탕으로 예상 견적을 먼저 확인하고, 방문 문의까지 바로 남길 수 있게
            구성했습니다.
          </p>
          <div className="marketing-hero-actions">
            <a className="marketing-primary-link" href="#quote-section">
              온라인 견적 시작
            </a>
            <a className="marketing-secondary-link" href={primaryStoreUrl} rel="noreferrer" target="_blank">
              네이버스토어 보기
            </a>
            {feed.store.kakaoUrl ? (
              <a className="marketing-secondary-link" href={feed.store.kakaoUrl} rel="noreferrer" target="_blank">
                카카오 문의
              </a>
            ) : null}
            {storePhoneLink ? (
              <a className="marketing-secondary-link" href={storePhoneLink}>
                전화 상담
              </a>
            ) : null}
          </div>
          <div className="marketing-hero-badges">
            <span>네이버스토어 운영중</span>
            <span>{feed.store.serviceArea || '일산 · 파주'} 장착 상담</span>
            <span>브랜드 비교 견적</span>
          </div>
        </div>

        <div className="marketing-highlight-card">
          <p className="marketing-highlight-label">Latest feed</p>
          <strong>{loading ? '불러오는 중' : publishedLabel}</strong>
          <p>
            {hasStaleFeed
              ? '공개 견적 데이터가 오래되었을 수 있습니다. 접수 후 매장에서 최종 재고와 금액을 다시 확인합니다.'
              : '최신 발행 기준으로 예상 견적을 계산합니다. 최종 금액은 상담 후 확정됩니다.'}
          </p>
          <div className="marketing-highlight-stats">
            <div>
              <span>공개 상품</span>
              <strong>{feed.items.length.toLocaleString('ko-KR')}</strong>
            </div>
            <div>
              <span>가능 상태</span>
              <strong>{feed.items.filter((item) => item.quoteAvailable).length.toLocaleString('ko-KR')}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-strip">
        <article>
          <strong>브랜드 폭</strong>
          <p>한국, 금호, 넥센, 미쉐린, 피렐리, 콘티넨탈, 굿이어 등 비교 상담</p>
        </article>
        <article>
          <strong>차종 상담</strong>
          <p>경차, SUV, 전기차, 화물차까지 차종/차량명 중심으로 빠르게 문의</p>
        </article>
        <article>
          <strong>장착 중심</strong>
          <p>온라인 견적 후 실제 장착 일정과 최종 재고를 매장에서 다시 확인</p>
        </article>
      </section>

      <section className="marketing-section" id="quote-section">
        <div className="marketing-section-heading">
          <p className="eyebrow">Quote Flow</p>
          <h2>재고 연동 예상 견적</h2>
          <p>
            차종/차량명, 규격, 브랜드를 기준으로 공개 가능한 상품만 보여줍니다. 정확한 수량은 숨기고, 견적 가능 여부만
            안내합니다.
          </p>
        </div>

        <div className="marketing-quote-layout">
          <article className="marketing-quote-panel">
            <div className="marketing-chip-row">
              {quickFilters.map((filter) => (
                <button className="marketing-chip" key={filter.label} onClick={() => applyQuickFilter(filter)} type="button">
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="marketing-form-grid">
              <label className="field field-wide">
                <span>차종 또는 차량명</span>
                <input
                  onChange={(event) => setVehicleQuery(event.target.value)}
                  placeholder="예: 모닝, 스파크, 쏘렌토, 테슬라 모델Y"
                  value={vehicleQuery}
                />
              </label>

              <label className="field">
                <span>타이어 규격</span>
                <input
                  onChange={(event) => setSizeLabel(event.target.value)}
                  placeholder="예: 245 45 19"
                  value={sizeLabel}
                />
              </label>

              <label className="field">
                <span>브랜드</span>
                <input
                  list="public-quote-brands"
                  onChange={(event) => setBrandName(event.target.value)}
                  placeholder="브랜드 선택"
                  value={brandName}
                />
                <datalist id="public-quote-brands">
                  {Array.from(new Set(feed.items.map((item) => item.brandName).filter(Boolean))).map((brand) => (
                    <option key={brand} value={brand} />
                  ))}
                </datalist>
              </label>

              <label className="field">
                <span>본수</span>
                <div className="marketing-toggle-row">
                  <button
                    className={`marketing-toggle${quantity === 2 ? ' is-active' : ''}`}
                    onClick={() => setQuantity(2)}
                    type="button"
                  >
                    2본
                  </button>
                  <button
                    className={`marketing-toggle${quantity === 4 ? ' is-active' : ''}`}
                    onClick={() => setQuantity(4)}
                    type="button"
                  >
                    4본
                  </button>
                </div>
              </label>

              <label className="field checkbox-field">
                <span>서비스 포함</span>
                <label className="checkbox-inline">
                  <input
                    checked={includeInstallation}
                    onChange={(event) => setIncludeInstallation(event.target.checked)}
                    type="checkbox"
                  />
                  <span>장착비 포함</span>
                </label>
                <label className="checkbox-inline">
                  <input
                    checked={includeAlignment}
                    onChange={(event) => setIncludeAlignment(event.target.checked)}
                    type="checkbox"
                  />
                  <span>얼라인먼트 포함</span>
                </label>
              </label>
            </div>

            {loadError ? <div className="marketing-warning-box">{loadError}</div> : null}

            <div className="marketing-result-list">
              {matchedItems.map((item) => {
                const itemEstimate = buildQuoteEstimate(item, feed, estimateInput)

                return (
                  <button
                    className={`marketing-result-card${selectedItem?.skuCode === item.skuCode ? ' is-selected' : ''}`}
                    key={item.skuCode}
                    onClick={() => setSelectedSkuCode(item.skuCode)}
                    type="button"
                  >
                    <div>
                      <strong>
                        {item.brandName} {item.patternName}
                      </strong>
                      <p>
                        {item.sizeLabel}
                        {item.productName ? ` · ${item.productName}` : ''}
                      </p>
                    </div>
                    <div className="marketing-result-meta">
                      <span className={`marketing-availability${item.quoteAvailable ? ' is-open' : ''}`}>
                        {item.quoteAvailable ? '견적 가능' : '상담 필요'}
                      </span>
                      <strong>{formatMoney(item.quoteUnitPrice)}원</strong>
                      <small>{quantity}본 예상 {formatMoney(itemEstimate.tireSubtotal)}원</small>
                    </div>
                  </button>
                )
              })}

              {!loading && matchedItems.length === 0 ? (
                <div className="marketing-empty-state">
                  <strong>조건에 맞는 공개 견적 상품이 없습니다.</strong>
                  <p>차종 또는 규격을 조금 더 넓게 입력하거나 문의 접수로 바로 연결해 주세요.</p>
                </div>
              ) : null}
            </div>
          </article>

          <article className="marketing-estimate-panel">
            <div className="marketing-section-heading compact">
              <p className="eyebrow">Estimate</p>
              <h2>선택한 예상 견적</h2>
            </div>

            {estimate ? (
              <>
                <div className="marketing-summary-card">
                  <strong>
                    {estimate.item.brandName} {estimate.item.patternName}
                  </strong>
                  <p>
                    {estimate.item.sizeLabel}
                    {estimate.item.productName ? ` · ${estimate.item.productName}` : ''}
                  </p>
                  <div className="marketing-price-grid">
                    <div>
                      <span>개당 예상가</span>
                      <strong>{formatMoney(estimate.item.quoteUnitPrice)}원</strong>
                    </div>
                    <div>
                      <span>타이어 합계</span>
                      <strong>{formatMoney(estimate.tireSubtotal)}원</strong>
                    </div>
                    <div>
                      <span>서비스 합계</span>
                      <strong>{formatMoney(estimate.serviceTotal)}원</strong>
                    </div>
                    <div>
                      <span>총 예상가</span>
                      <strong>{formatMoney(estimate.totalEstimate)}원</strong>
                    </div>
                  </div>
                  <p className="marketing-summary-note">{estimate.notice}</p>
                </div>

                <form className="marketing-inquiry-form" onSubmit={handleInquirySubmit}>
                  <div className="marketing-form-grid">
                    <label className="field">
                      <span>이름</span>
                      <input
                        onChange={(event) => updateInquiryForm('customerName', event.target.value)}
                        placeholder="홍길동"
                        value={inquiryForm.customerName}
                      />
                    </label>

                    <label className="field">
                      <span>연락처</span>
                      <input
                        onChange={(event) => updateInquiryForm('phone', event.target.value)}
                        placeholder="010-1234-5678"
                        value={inquiryForm.phone}
                      />
                    </label>

                    <label className="field">
                      <span>차량번호</span>
                      <input
                        onChange={(event) => updateInquiryForm('plateNumber', event.target.value)}
                        placeholder="12가3456"
                        value={inquiryForm.plateNumber}
                      />
                    </label>

                    <label className="field">
                      <span>희망 방문일</span>
                      <input
                        onChange={(event) => updateInquiryForm('desiredVisitAt', event.target.value)}
                        type="datetime-local"
                        value={inquiryForm.desiredVisitAt}
                      />
                    </label>

                    <label className="field field-wide">
                      <span>추가 메모</span>
                      <input
                        onChange={(event) => updateInquiryForm('memo', event.target.value)}
                        placeholder="브랜드 추천, 소음/승차감 상담, 방문 가능 시간 등을 남겨 주세요."
                        value={inquiryForm.memo}
                      />
                    </label>
                  </div>

                  {submitState.error ? <div className="marketing-warning-box">{submitState.error}</div> : null}
                  {submitState.result ? (
                    <div className="marketing-success-box">
                      <strong>문의가 접수되었습니다.</strong>
                      <p>
                        접수번호 {submitState.result.id} · {new Date(submitState.result.storedAt).toLocaleString('ko-KR')}
                      </p>
                    </div>
                  ) : null}

                  <div className="button-row">
                    <button className="primary-button" disabled={submitState.running} type="submit">
                      {submitState.running ? '접수 중...' : '견적 문의 접수'}
                    </button>
                    <a className="marketing-secondary-link" href={primaryStoreUrl} rel="noreferrer" target="_blank">
                      네이버스토어 이동
                    </a>
                    {feed.store.kakaoUrl ? (
                      <a className="marketing-secondary-link" href={feed.store.kakaoUrl} rel="noreferrer" target="_blank">
                        카카오 문의
                      </a>
                    ) : null}
                    {storePhoneLink ? (
                      <a className="marketing-secondary-link" href={storePhoneLink}>
                        전화 상담
                      </a>
                    ) : null}
                  </div>
                </form>
              </>
            ) : (
              <div className="marketing-empty-state">
                <strong>오른쪽에 예상 견적이 표시됩니다.</strong>
                <p>공개 견적 상품을 하나 선택하면 총 예상가와 문의 폼이 함께 열립니다.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-section-heading">
          <p className="eyebrow">Process</p>
          <h2>상담에서 장착까지</h2>
        </div>
        <div className="marketing-process-grid">
          <article>
            <strong>1. 온라인 예상 견적</strong>
            <p>공개 가능한 재고와 가격 기준으로 먼저 예상 금액을 확인합니다.</p>
          </article>
          <article>
            <strong>2. 문의 접수</strong>
            <p>차종, 연락처, 희망 방문일을 남기면 매장에서 최종 재고와 금액을 확인합니다.</p>
          </article>
          <article>
            <strong>3. 방문 장착</strong>
            <p>일산 · 파주 상담 흐름에 맞춰 장착 일정과 추가 서비스 여부를 확정합니다.</p>
          </article>
        </div>
      </section>
    </div>
  )
}
