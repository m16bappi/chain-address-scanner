import {setTimeout as sleep} from 'node:timers/promises'
import {styleText} from 'node:util'
import {
  BaseError,
  BlockNotFoundError,
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
} from 'viem'

import {
  blockConcurrency,
  chains,
  dbPath,
  minBalance,
  retryDelayMs,
  rpcBatchSize,
  type ChainName,
} from './config.ts'
import {Store, type BlockResult, type FoundAddress} from './db.ts'

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

// Multicall3 has the same address on Ethereum and BNB Chain: https://www.multicall3.com
const multicall3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const getEthBalanceAbi = parseAbi(['function getEthBalance(address) view returns (uint256)'])

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

  // One eth_call per block for all balances, instead of one request per address.
  // Current balance, not balance at this block: historical state needs an archive node.
  const balances = candidates.length === 0 ? [] : await client.multicall({
    multicallAddress: multicall3,
    allowFailure: false,
    batchSize: 0,
    contracts: candidates.map((address) => ({
      address: multicall3,
      abi: getEthBalanceAbi,
      functionName: 'getEthBalance' as const,
      args: [address],
    })),
  })
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
  console.log(styleText('yellow', '\nstopping after current batch...'))
})

let blockNumber = (store.lastBlock() ?? config.startBlock - 1n) + 1n
console.log(
  styleText('cyan', `${chainName}: starting at block ${blockNumber}, ${blockConcurrency} in parallel`)
)

// Each batch retries earlier failed blocks first, then fills up with new blocks.
// A block that fails is recorded in the db and retried next batch; scanning moves on.
while (running) {
  const retries = store.failedBlocks(blockConcurrency)
  const fresh = Array.from(
    {length: blockConcurrency - retries.length},
    (_, i) => blockNumber + BigInt(i)
  )
  const batch = [...retries, ...fresh]
  const scans = await Promise.allSettled(batch.map(scanBlock))

  const results: BlockResult[] = scans.map((scan, i) =>
    scan.status === 'fulfilled'
      ? {blockNumber: batch[i], ok: true, found: scan.value.found}
      : {blockNumber: batch[i], ok: false}
  )
  const inserted = store.saveBatch(results)

  scans.forEach((scan, i) => {
    const retried = i < retries.length ? ' (retried)' : ''
    if (scan.status === 'rejected') {
      console.error(
        styleText('red', `block ${batch[i]} failed${retried}, will retry: ${errorMessage(scan.reason)}`)
      )
      return
    }
    const block = scan.value
    console.log(
      `block ${batch[i]}${retried}: ${block.txCount} txs, ${block.addressCount} addresses, ` +
        `${block.candidateCount} new, ${styleText('green', `${inserted[i]} saved`)}`
    )
  })

  blockNumber += BigInt(fresh.length)

  if (results.every((result) => !result.ok)) await sleep(retryDelayMs)
}

store.close()
