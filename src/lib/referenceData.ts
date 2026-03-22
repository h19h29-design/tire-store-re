import { execute, selectCount, selectRows } from './db'
import { normalizeText } from './normalize'
import type { ReferenceDataSummary } from './types'

const DEFAULT_TIRE_BRANDS = [
  '한국',
  '금호',
  '넥센',
  '라우펜',
  '미쉐린',
  '굿이어',
  '브리지스톤',
  '콘티넨탈',
  '피렐리',
  '던롭',
  '요코하마',
  '토요',
  '쿠퍼',
  '맥시스',
  '팔켄',
]

const DEFAULT_VEHICLE_REFERENCE = [
  { brandName: '현대', models: ['아반떼', '쏘나타', '그랜저', '싼타페', '투싼', '팰리세이드', '스타리아', '포터', '아이오닉5', '아이오닉6'] },
  { brandName: '기아', models: ['모닝', '레이', 'K3', 'K5', 'K8', 'K9', '쏘렌토', '스포티지', '카니발', '봉고', 'EV6', 'EV9'] },
  { brandName: '제네시스', models: ['G70', 'G80', 'G90', 'GV70', 'GV80'] },
  { brandName: '쉐보레', models: ['스파크', '말리부', '트랙스', '트레일블레이저', '콜로라도'] },
  { brandName: '르노', models: ['SM6', 'QM6', 'XM3', '마스터'] },
  { brandName: '쌍용', models: ['티볼리', '코란도'] },
  { brandName: 'KG모빌리티', models: ['토레스', '렉스턴'] },
  { brandName: 'BMW', models: ['3시리즈', '5시리즈', 'X3', 'X5'] },
  { brandName: '벤츠', models: ['E클래스', 'C클래스', 'S클래스', 'GLC'] },
  { brandName: '아우디', models: ['A4', 'A6', 'Q5'] },
  { brandName: '폭스바겐', models: ['티구안', '골프'] },
  { brandName: '볼보', models: ['XC60', 'XC90'] },
  { brandName: '렉서스', models: ['ES'] },
  { brandName: '토요타', models: ['캠리'] },
  { brandName: '혼다', models: ['어코드'] },
]

type BrandRow = {
  brandName: string
}

type VehicleRow = {
  id: number
  brandName: string
  modelName: string
}

export function guessVehicleBrandName(modelName: string) {
  const normalizedModel = normalizeText(modelName)
  if (!normalizedModel) {
    return ''
  }

  for (const entry of DEFAULT_VEHICLE_REFERENCE) {
    if (normalizedModel.includes(normalizeText(entry.brandName))) {
      return entry.brandName
    }

    for (const model of entry.models) {
      if (normalizedModel.includes(normalizeText(model))) {
        return entry.brandName
      }
    }
  }

  return ''
}

export async function ensureReferenceData() {
  for (const brandName of DEFAULT_TIRE_BRANDS) {
    await execute(
      `INSERT OR IGNORE INTO tire_brand_reference (
        brand_name,
        normalized_brand,
        source
      ) VALUES (?, ?, 'default')`,
      [brandName, normalizeText(brandName)],
    )
  }

  for (const entry of DEFAULT_VEHICLE_REFERENCE) {
    const normalizedBrand = normalizeText(entry.brandName)

    await execute(
      `INSERT OR IGNORE INTO vehicle_brand_reference (
        brand_name,
        normalized_brand,
        source
      ) VALUES (?, ?, 'default')`,
      [entry.brandName, normalizedBrand],
    )

    for (const modelName of entry.models) {
      await execute(
        `INSERT OR IGNORE INTO vehicle_model_reference (
          brand_name,
          model_name,
          normalized_brand,
          normalized_model,
          source
        ) VALUES (?, ?, ?, ?, 'default')`,
        [entry.brandName, modelName, normalizedBrand, normalizeText(modelName)],
      )
    }
  }

  const itemBrands = await selectRows<BrandRow>(
    `SELECT DISTINCT brand_name AS brandName
    FROM items
    WHERE TRIM(brand_name) <> ''
    ORDER BY brand_name ASC`,
  )

  for (const row of itemBrands) {
    await execute(
      `INSERT OR IGNORE INTO tire_brand_reference (
        brand_name,
        normalized_brand,
        source
      ) VALUES (?, ?, 'imported')`,
      [row.brandName, normalizeText(row.brandName)],
    )
  }

  const vehicles = await selectRows<VehicleRow>(
    `SELECT
      id AS id,
      brand_name AS brandName,
      model_name AS modelName
    FROM vehicles
    WHERE TRIM(model_name) <> ''`,
  )

  for (const vehicle of vehicles) {
    const guessedBrand = vehicle.brandName || guessVehicleBrandName(vehicle.modelName)
    const normalizedBrand = normalizeText(guessedBrand)

    if (guessedBrand && vehicle.brandName !== guessedBrand) {
      await execute(
        `UPDATE vehicles
        SET
          brand_name = ?,
          normalized_brand = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [guessedBrand, normalizedBrand, vehicle.id],
      )
    }

    if (guessedBrand) {
      await execute(
        `INSERT OR IGNORE INTO vehicle_brand_reference (
          brand_name,
          normalized_brand,
          source
        ) VALUES (?, ?, 'imported')`,
        [guessedBrand, normalizedBrand],
      )
    }

    await execute(
      `INSERT OR IGNORE INTO vehicle_model_reference (
        brand_name,
        model_name,
        normalized_brand,
        normalized_model,
        source
      ) VALUES (?, ?, ?, ?, 'imported')`,
      [guessedBrand, vehicle.modelName, normalizedBrand, normalizeText(vehicle.modelName)],
    )
  }
}

export async function getReferenceDataSummary(): Promise<ReferenceDataSummary> {
  const [tireBrandCount, vehicleBrandCount, vehicleModelCount] = await Promise.all([
    selectCount('SELECT COUNT(*) AS count FROM tire_brand_reference WHERE is_active = 1'),
    selectCount('SELECT COUNT(*) AS count FROM vehicle_brand_reference WHERE is_active = 1'),
    selectCount('SELECT COUNT(*) AS count FROM vehicle_model_reference WHERE is_active = 1'),
  ])

  return {
    tireBrandCount,
    vehicleBrandCount,
    vehicleModelCount,
  }
}
