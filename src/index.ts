import {setTimeout as sleep} from 'node:timers/promises'
import {styleText} from 'node:util'
import {BaseError, BlockNotFoundError, createPublicClient, getAddress, http, type Address} from 'viem'

import {chains, dbPath, minBalance, retryDelayMs, rpcBatchSize, type ChainName} from './config.ts'
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

async function processBlock(blockNumber: bigint): Promise<void> {
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
  const rich: FoundAddress[] = candidates
    .map((address, i) => ({address, balance: balances[i]}))
    .filter(({balance}) => balance >= minBalance)

  const inserted = store.saveBlock(blockNumber, rich)
  console.log(
    `block ${blockNumber}: ${block.transactions.length} txs, ${seen.size} addresses, ` +
      `${candidates.length} new, ${styleText('green', `${inserted} saved`)}`
  )
}

let running = true
process.once('SIGINT', () => {
  running = false
  console.log(styleText('yellow', '\nstopping after current block...'))
})

let blockNumber = (store.lastBlock() ?? config.startBlock - 1n) + 1n
console.log(styleText('cyan', `${chainName}: starting at block ${blockNumber}`))

while (running) {
  try {
    await processBlock(blockNumber)
    blockNumber++
  } catch (error) {
    // viem's full message embeds the whole batch request body.
    const message = error instanceof BaseError ? error.shortMessage : (error as Error).message
    console.error(styleText('red', `block ${blockNumber} failed, retrying: ${message}`))
    await sleep(retryDelayMs)
  }
}

store.close()
