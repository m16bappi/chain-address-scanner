import {setTimeout as sleep} from 'node:timers/promises'
import {styleText} from 'node:util'
import {BaseError, BlockNotFoundError, createPublicClient, getAddress, http, type Address} from 'viem'

import {
  blockConcurrency,
  chains,
  dbPath,
  minBalance,
  retryDelayMs,
  rpcBatchSize,
  type ChainName,
} from './config.ts'
import {Store, type FoundAddress} from './db.ts'

const chainName = process.argv[2]
if (!(chainName && Object.hasOwn(chains, chainName))) {
  console.error(`Usage: npm start <${Object.keys(chains).join('|')}>`)
  process.exit(1)
}

const config = chains[chainName as ChainName]
const store = new Store(dbPath, chainName as ChainName)
const client = createPublicClient({
  transport: http(config.rpcUrl, {batch: {batchSize: rpcBatchSize}}),
})

interface ScannedBlock {
  blockNumber: bigint
  txCount: number
  addressCount: number
  candidateCount: number
  found: FoundAddress[]
}

async function waitForBlock(blockNumber: bigint) {
  while (true) {
    try {
      return await client.getBlock({blockNumber, includeTransactions: true})
    } catch (error) {
      if (!(error instanceof BlockNotFoundError)) throw error
      await sleep(retryDelayMs)
    }
  }
}

async function scanBlock(blockNumber: bigint): Promise<ScannedBlock> {
  const block = await waitForBlock(blockNumber)

  const seen = new Set<Address>()
  for (const tx of block.transactions) {
    seen.add(getAddress(tx.from))
    if (tx.to) seen.add(getAddress(tx.to))
  }
  const candidates = store.filterUnknown([...seen])

  // Current balance, not balance at this block: historical state needs an archive node.
  // The http transport packs these concurrent calls into JSON-RPC batch requests.
  const balances = await Promise.all(candidates.map((address) => client.getBalance({address})))
  const found = candidates
    .map((address, i) => ({address, balance: balances[i]}))
    .filter(({balance}) => balance >= minBalance)

  return {
    blockNumber,
    txCount: block.transactions.length,
    addressCount: seen.size,
    candidateCount: candidates.length,
    found,
  }
}

function errorMessage(error: unknown): string {
  // viem's full message embeds the whole batch request body.
  return error instanceof BaseError ? error.shortMessage : (error as Error).message
}

let running = true
process.once('SIGINT', () => {
  running = false
  console.log(styleText('yellow', '\nstopping after current block...'))
})

let blockNumber = (store.lastBlock() ?? config.startBlock - 1n) + 1n
console.log(
  styleText('cyan', `${chainName}: starting at block ${blockNumber}, ${blockConcurrency} in parallel`)
)

while (running) {
  // Scan a window of blocks in parallel, but save strictly in order so progress
  // never moves past a block that failed. After a failure the window restarts there.
  const scans = Array.from({length: blockConcurrency}, (_, i) => scanBlock(blockNumber + BigInt(i)))
  for (const scan of scans) scan.catch(() => {})

  for (const scan of scans) {
    if (!running) break
    try {
      const block = await scan
      const inserted = store.saveBlock(block.blockNumber, block.found)
      console.log(
        `block ${block.blockNumber}: ${block.txCount} txs, ${block.addressCount} addresses, ` +
          `${block.candidateCount} new, ${styleText('green', `${inserted} saved`)}`
      )
      blockNumber++
    } catch (error) {
      console.error(styleText('red', `block ${blockNumber} failed, retrying: ${errorMessage(error)}`))
      await sleep(retryDelayMs)
      break
    }
  }
}

store.close()
