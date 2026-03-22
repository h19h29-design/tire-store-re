export type ImportFileHints = {
  inventoryPath: string | null
  salesPath: string | null
}

export type RuntimeInfo = {
  appConfigDir: string
  dbPath: string
  backupDir: string
  detectedFiles: ImportFileHints
}

export type RuntimeReadyResult = {
  saleLineCostSnapshotColumnReady: boolean
  costSnapshotBackfilledCount: number
  dailyExpenseBackfilledCount: number
}

export type BackupResult = {
  backupPath: string
  createdAt: string
}

export type InventorySeedItem = {
  skuCode: string
  brandName: string
  patternName: string
  sizeLabel: string
  productName: string
  normalizedBrand: string
  normalizedPattern: string
  normalizedSize: string
  defaultCostPrice: number
  defaultSalePrice: number
  quantityOnHand: number
  aliases: string[]
  sizeSearchTokens: string[]
}

export type ParsedInventoryWorkbook = {
  sourcePath: string
  inventorySheet: string
  priceSheet: string
  customerSheet: string | null
  itemCount: number
  customerSeedCount: number
  historicalSaleCount: number
  historicalServiceCount: number
  items: InventorySeedItem[]
}

export type ParsedSaleRow = {
  saleNumber: string
  soldAt: string
  dayLabel: string
  rowNumber: number
  customerName: string
  phone: string
  normalizedPhone: string
  vehicleModel: string
  plateNumber: string
  normalizedPlateNumber: string
  pattern: string
  normalizedPattern: string
  sizeLabel: string
  normalizedSize: string
  quantity: number
  alAmount: number
  totalAmount: number
  cardAmount: number
  cashAmount: number
  memo: string
  lineType: string
}

export type ParsedSalesDaySummary = {
  dayLabel: string
  soldAt: string
  parsedTireQuantity: number
  reportedTireQuantity: number
  quantityDelta: number
  parsedTotalAmount: number
  reportedTotalAmount: number
  amountDelta: number
  parsedCardAmount: number
  reportedCardAmount: number
  cardDelta: number
  parsedCashAmount: number
  reportedCashAmount: number
  cashDelta: number
  expenseAmount: number
  expenseNote: string
  removedSummaryRowNumber: number | null
}

export type ParsedSalesWorkbook = {
  sourcePath: string
  rowCount: number
  tireLineCount: number
  serviceLineCount: number
  daySummaries: ParsedSalesDaySummary[]
  rows: ParsedSaleRow[]
}

export type InitialImportResult = {
  itemCount: number
  customerSeedCount: number
  historicalSalesCount: number
  customerCount: number
  vehicleCount: number
  salesCount: number
  unmatchedTireLines: number
  salesValidationIssueCount: number
}

export type VendorPricePreviewRow = {
  rowNumber: number
  brandName: string
  productName: string
  patternCode: string
  sizeLabel: string
  priceVatIncluded: number
  matchedItemCount: number
}

export type ParsedVendorPriceWorkbook = {
  sourcePath: string
  sheetName: string
  detectedBrandName: string
  priceColumnLabel: string
  rowCount: number
  matchedRowCount: number
  unmatchedRowCount: number
  zeroPriceRowCount: number
  previewRows: VendorPricePreviewRow[]
}

export type VendorPriceImportResult = {
  sourcePath: string
  sheetName: string
  detectedBrandName: string
  rowCount: number
  matchedRowCount: number
  unmatchedRowCount: number
  updatedItemCount: number
  updatedRowCount: number
  skippedZeroPriceRowCount: number
}

export type InventoryListRow = {
  id: number
  skuCode: string
  brandName: string
  patternName: string
  sizeLabel: string
  productName: string
  defaultCostPrice: number
  defaultSalePrice: number
  defaultDiscountRate: number
  quantityOnHand: number
  quantityAvailable: number
  publicQuoteEnabled: boolean
  publicQuoteUrl: string
}

export type InventoryOverview = {
  totalQuantity: number
  itemCount: number
  lowStockItemCount: number
}

export type InventorySearchFilters = {
  query: string
  brandName: string
  patternName: string
  sizeLabel: string
  stockMode: 'all' | 'in-stock' | 'out-of-stock'
}

export type InventoryFilterOptions = {
  brands: string[]
  patterns: string[]
  sizes: string[]
}

export type StockEntryInput = {
  itemId: number
  movementType: 'receive' | 'adjustment-increase' | 'adjustment-decrease'
  quantity: number
  unitCost: number
  memo: string
}

export type InventoryCatalogSettingsInput = {
  brandName: string
  patternName: string
  sizeLabel: string
  defaultCostPrice: number
  discountRate: number
  publicQuoteEnabled: boolean
  publicQuoteUrl: string
}

export type InventoryCreateItemInput = {
  brandName: string
  patternName: string
  sizeLabel: string
  productName?: string
  defaultCostPrice: number
  defaultSalePrice: number
  defaultDiscountRate: number
  initialQuantity: number
  memo: string
  publicQuoteEnabled: boolean
  publicQuoteUrl: string
}

export type CustomerListRow = {
  id: number
  customerId: number | null
  plateNumber: string
  customerName: string
  phone: string
  vehicleBrand: string
  vehicleModel: string
  odometer: number
  saleQuantity: number
  visitCount: number
  totalSaleAmount: number
  cardAmount: number
  cashAmount: number
  naverAmount: number
  alignmentAmount: number
  latestSaleAt: string | null
  latestTireSummary: string
  memo: string
}

export type CustomerRecordUpdateInput = {
  vehicleId: number
  customerId: number | null
  customerName: string
  phone: string
  plateNumber: string
  vehicleBrand: string
  vehicleModel: string
  odometer: number
  memo: string
}

export type CustomerSearchFilters = {
  query: string
  vehicleBrand: string
  vehicleModel: string
  purchasedBrand: string
  saleStatus: 'all' | 'with-sales' | 'without-sales'
}

export type CustomerFilterOptions = {
  vehicleBrands: string[]
  vehicleModels: string[]
  purchasedBrands: string[]
}

export type DashboardRangeMode = 'date' | 'month' | 'year'

export type DashboardSummary = {
  salesCount: number
  totalAmount: number
  tireQuantity: number
  cardAmount: number
  cashAmount: number
  naverAmount: number
  cardFeeAmount: number
  serviceAmount: number
  tireSalesAmount: number
  tireCostAmount: number
  expenseAmount: number
  tireProfit: number
  netProfit: number
}

export type DashboardBreakdownRow = {
  label: string
  quantity: number
  amount: number
}

export type DashboardRecentSaleRow = {
  id: number
  soldAt: string
  plateNumber: string
  customerName: string
  totalAmount: number
  tireQuantity: number
  cardAmount: number
  cashAmount: number
  naverAmount: number
}

export type DashboardInventoryMetrics = {
  totalQuantity: number
  stockedItemCount: number
  lowStockThreshold: number
  lowStockItemCount: number
}

export type DashboardLowStockRow = {
  itemId: number
  brandName: string
  patternName: string
  sizeLabel: string
  quantityAvailable: number
}

export type DashboardPeriodBucketRow = {
  label: string
  salesCount: number
  quantity: number
  amount: number
  totalAmount: number
  cardAmount: number
  cashAmount: number
  naverAmount: number
}

export type DashboardValidation = {
  periodTireQuantity: number
  groupedLabel: string
  groupedQuantity: number
  brandQuantity: number
  sizeQuantity: number
  groupedMatches: boolean
  brandMatches: boolean
  sizeMatches: boolean
}

export type DashboardExpenseRecord = {
  expenseDate: string
  amount: number
  note: string
  updatedAt: string | null
}

export type DashboardExpenseHistoryRow = {
  expenseDate: string
  amount: number
  note: string
  updatedAt: string | null
}

export type DashboardExpenseInput = {
  expenseDate: string
  amount: number
  note: string
}

export type DashboardHeadlineMetrics = {
  previousQuantity: number
  todayQuantity: number
  cumulativeQuantity: number
  previousProfit: number
  todayProfit: number
  cumulativeProfit: number
}

export type DashboardAnalytics = {
  headline: DashboardHeadlineMetrics
  today: DashboardSummary
  period: DashboardSummary
  inventory: DashboardInventoryMetrics
  topBrands: DashboardBreakdownRow[]
  topSizes: DashboardBreakdownRow[]
  lowStockItems: DashboardLowStockRow[]
  periodBuckets: DashboardPeriodBucketRow[]
  validation: DashboardValidation
  recentSales: DashboardRecentSaleRow[]
  warnings: string[]
}

export type DashboardPaymentFilters = {
  card: boolean
  cash: boolean
  naver: boolean
}

export type ReferenceDataSummary = {
  tireBrandCount: number
  vehicleBrandCount: number
  vehicleModelCount: number
}

export type BackupPreferences = {
  googleDriveAccountEmail: string
  backupFolderPath: string
  autoBackupEnabled: boolean
  autoBackupMemo: string
  lowStockThreshold: number
}

export type BrandDiscountRule = {
  brandName: string
  discountRate: number
}

export type ProductDiscountRule = {
  productName: string
  discountRate: number
}

export type PublicQuoteStoreInfo = {
  storeName: string
  serviceArea: string
  phoneNumber: string
  kakaoUrl: string
  naverStoreUrl: string
  defaultInstallationFee: number
  defaultAlignmentFee: number
  quoteNotice: string
}

export type PublicQuoteItem = {
  skuCode: string
  brandName: string
  patternName: string
  sizeLabel: string
  productName: string
  quoteUnitPrice: number
  quoteAvailable: boolean
  publicQuoteUrl: string
  searchText: string
}

export type PublicQuoteFeed = {
  store: PublicQuoteStoreInfo
  lastPublishedAt: string | null
  items: PublicQuoteItem[]
}

export type PublicQuotePreferences = {
  enabled: boolean
  publishEndpoint: string
  publishAuthKey: string
  storeName: string
  serviceArea: string
  phoneNumber: string
  kakaoUrl: string
  naverStoreUrl: string
  defaultInstallationFee: number
  defaultAlignmentFee: number
  quoteNotice: string
  lastPublishedAt: string | null
  lastPublishError: string
}

export type QuoteEstimateInput = {
  vehicleQuery: string
  sizeLabel: string
  brandName: string
  quantity: 2 | 4
  includeInstallation: boolean
  includeAlignment: boolean
}

export type QuoteEstimateResult = {
  item: PublicQuoteItem
  quantity: 2 | 4
  includeInstallation: boolean
  includeAlignment: boolean
  tireSubtotal: number
  serviceTotal: number
  totalEstimate: number
  notice: string
  lastPublishedAt: string | null
  isStale: boolean
}

export type QuoteInquiryInput = {
  customerName: string
  phone: string
  plateNumber: string
  vehicleModel: string
  desiredVisitAt: string
  memo: string
  estimate: QuoteEstimateResult
}

export type QuoteInquiryResponse = {
  id: string
  storedAt: string
}

export type BackupLogRow = {
  id: number
  backupPath: string
  backupType: string
  createdAt: string
  note: string
}

export type PlateLookupRow = {
  vehicleId: number
  customerId: number | null
  plateNumber: string
  customerName: string
  phone: string
  vehicleModel: string
  odometer: number
  latestSaleAt: string | null
}

export type CustomerVisitRow = {
  saleId: number
  soldAt: string
  tireQuantity: number
  totalAmount: number
  cardAmount: number
  cashAmount: number
  naverAmount: number
  alignmentAmount: number
  serviceAmount: number
  memo: string
}
