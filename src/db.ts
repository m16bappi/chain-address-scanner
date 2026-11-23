import {DatabaseSync} from 'node:sqlite'
import type {Address} from 'viem'

import type {ChainName} from './config.ts'

export interface FoundAddress {
  address: Address
  balance: bigint
}

export type BlockResult =
  | {blockNumber: bigint; ok: true; found: FoundAddress[]}
  | {blockNumber: bigint; ok: false}

// Invariant: every block <= progress.last_block is either saved or listed in failed_block.
export class Store {
  private db: DatabaseSync
  private chain: ChainName

  constructor(path: string, chain: ChainName) {
    this.chain = chain
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS address (
        chain        TEXT    NOT NULL,
        address      TEXT    NOT NULL,
        balance_wei  TEXT    NOT NULL,
        block_number INTEGER NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain, address)
      );
      CREATE TABLE IF NOT EXISTS progress (
        chain      TEXT    PRIMARY KEY,
        last_block INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS failed_block (
        chain        TEXT    NOT NULL,
        block_number INTEGER NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (chain, block_number)
      );
    `)
  }

  lastBlock(): bigint | undefined {
    const row = this.db
      .prepare('SELECT last_block FROM progress WHERE chain = ?')
      .get(this.chain)
    return row ? BigInt(row.last_block as number) : undefined
  }

  failedBlocks(limit: number): bigint[] {
    return this.db
      .prepare('SELECT block_number FROM failed_block WHERE chain = ? ORDER BY block_number LIMIT ?')
      .all(this.chain, limit)
      .map((row) => BigInt(row.block_number as number))
  }

  filterUnknown(addresses: Address[]): Address[] {
    const exists = this.db.prepare('SELECT 1 FROM address WHERE chain = ? AND address = ?')
    return addresses.filter((address) => !exists.get(this.chain, address))
  }

  // One transaction per batch, so a crash never loses a failed block or half-saves one.
  // Returns how many new addresses each result inserted, in the same order.
  saveBatch(results: BlockResult[]): number[] {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO address (chain, address, balance_wei, block_number) VALUES (?, ?, ?, ?)'
    )
    const clearFailed = this.db.prepare(
      'DELETE FROM failed_block WHERE chain = ? AND block_number = ?'
    )
    const markFailed = this.db.prepare(
      `INSERT INTO failed_block (chain, block_number) VALUES (?, ?)
       ON CONFLICT (chain, block_number) DO UPDATE SET attempts = attempts + 1`
    )
    // MAX: retrying an old failed block must not move progress backwards.
    const progress = this.db.prepare(
      `INSERT INTO progress (chain, last_block) VALUES (?, ?)
       ON CONFLICT (chain) DO UPDATE SET last_block = MAX(last_block, excluded.last_block)`
    )

    this.db.exec('BEGIN')
    try {
      const inserted = results.map(() => 0)
      for (const [i, result] of results.entries()) {
        progress.run(this.chain, result.blockNumber)

        if (!result.ok) {
          markFailed.run(this.chain, result.blockNumber)
          continue
        }

        for (const {address, balance} of result.found) {
          const {changes} = insert.run(this.chain, address, balance.toString(), result.blockNumber)
          inserted[i] += Number(changes)
        }
        clearFailed.run(this.chain, result.blockNumber)
      }
      this.db.exec('COMMIT')
      return inserted
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}
