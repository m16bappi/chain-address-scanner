import {DatabaseSync} from 'node:sqlite'
import type {Address} from 'viem'

import type {ChainName} from './config.ts'

export interface FoundAddress {
  address: Address
  balance: bigint
}

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
    `)
  }

  lastBlock(): bigint | undefined {
    const row = this.db
      .prepare('SELECT last_block FROM progress WHERE chain = ?')
      .get(this.chain)
    return row ? BigInt(row.last_block as number) : undefined
  }

  filterUnknown(addresses: Address[]): Address[] {
    const exists = this.db.prepare('SELECT 1 FROM address WHERE chain = ? AND address = ?')
    return addresses.filter((address) => !exists.get(this.chain, address))
  }

  // Addresses and progress commit together, so a crash never skips or half-saves a block.
  saveBlock(blockNumber: bigint, found: FoundAddress[]): number {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO address (chain, address, balance_wei, block_number) VALUES (?, ?, ?, ?)'
    )
    const progress = this.db.prepare(
      `INSERT INTO progress (chain, last_block) VALUES (?, ?)
       ON CONFLICT (chain) DO UPDATE SET last_block = excluded.last_block`
    )

    this.db.exec('BEGIN')
    try {
      let inserted = 0
      for (const {address, balance} of found) {
        inserted += Number(
          insert.run(this.chain, address, balance.toString(), blockNumber).changes
        )
      }
      progress.run(this.chain, blockNumber)
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
