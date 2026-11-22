import {parseEther} from 'viem'

export type ChainName = 'ether' | 'binance'

export interface ChainConfig {
  rpcUrl: string
  startBlock: bigint
}

export const chains: Record<ChainName, ChainConfig> = {
  ether: {
    rpcUrl: process.env.ETHER_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
    startBlock: 15_779_400n,
  },
  binance: {
    rpcUrl: process.env.BINANCE_RPC_URL ?? 'https://bsc-dataseed.binance.org',
    startBlock: 15_779_400n,
  },
}

export const dbPath = 'addresses.db'

// Native coin (ETH / BNB) an address must hold to be stored.
export const minBalance = parseEther('0.5')

// Max JSON-RPC calls per HTTP batch request; BSC dataseed rejects batches over 100.
export const rpcBatchSize = 100

export const retryDelayMs = 1000
