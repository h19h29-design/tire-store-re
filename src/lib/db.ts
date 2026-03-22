import Database from '@tauri-apps/plugin-sql'

export const DB_PATH = 'sqlite:tire-store.db'

let dbPromise: Promise<Database> | null = null
let dbOperationQueue: Promise<void> = Promise.resolve()

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function isDatabaseLockedError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes('database is locked')
}

async function retryLockedDatabaseOperation<T>(operation: () => Promise<T>) {
  let attempt = 0

  while (true) {
    try {
      return await operation()
    } catch (error) {
      if (!isDatabaseLockedError(error) || attempt >= 5) {
        throw error
      }

      attempt += 1
      await delay(40 * attempt)
    }
  }
}

function queueDatabaseOperation<T>(operation: () => Promise<T>) {
  const nextOperation = dbOperationQueue.then(
    () => retryLockedDatabaseOperation(operation),
    () => retryLockedDatabaseOperation(operation),
  )

  dbOperationQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  )

  return nextOperation
}

export function getDatabase() {
  dbPromise ??= (async () => {
    const db = await Database.load(DB_PATH)
    await db.execute('PRAGMA journal_mode = WAL')
    await db.execute('PRAGMA busy_timeout = 5000')
    return db
  })()
  return dbPromise
}

type CountRow = {
  count: number
}

export async function selectCount(query: string, bindValues: unknown[] = []) {
  const rows = await queueDatabaseOperation(async () => {
    const db = await getDatabase()
    return db.select<CountRow[]>(query, bindValues)
  })
  return Number(rows[0]?.count ?? 0)
}

type ExecuteResult = {
  rowsAffected: number
  lastInsertId: number
}

export async function execute(query: string, bindValues: unknown[] = []) {
  return queueDatabaseOperation(async () => {
    const db = await getDatabase()
    return db.execute(query, bindValues) as Promise<ExecuteResult>
  })
}

export async function selectRows<T>(query: string, bindValues: unknown[] = []) {
  return queueDatabaseOperation(async () => {
    const db = await getDatabase()
    return db.select<T[]>(query, bindValues)
  })
}

export async function selectFirst<T>(query: string, bindValues: unknown[] = []) {
  const rows = await selectRows<T>(query, bindValues)
  return rows[0] ?? null
}

export async function runTransaction<T>(work: () => Promise<T>) {
  // The Tauri SQL plugin uses pooled SQLite connections, so front-end BEGIN/COMMIT
  // cannot safely guarantee that subsequent statements run on the same connection.
  return work()
}
