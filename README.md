# Web3 Wallet Address Fetch

Scan Ethereum or BNB Smart Chain blocks and collect every **unique wallet address** that holds at least **0.5 ETH / BNB**, stored in a local SQLite database.

- Reads every transaction in each block and collects the `from` and `to` addresses
- Scans several blocks in parallel and checks balances in JSON-RPC batches
- Skips addresses that are already stored
- Saves each address once per chain, with its balance and the block it was found in
- Saves each block's addresses and progress together, so a restart continues at the next block without losing or duplicating work

## Requirements

- **Node.js 24+**. It runs TypeScript directly and uses the built-in `node:sqlite`, so there's no build step and no database server.

## Setup

```bash
npm install
```

## Usage

```bash
npm start ether     # Ethereum mainnet
npm start binance   # BNB Smart Chain
```

Example output:

```
ether: starting at block 15779426, 5 in parallel
block 15779426: 119 txs, 191 addresses, 176 new, 2 saved
block 15779427: 104 txs, 162 addresses, 157 new, 7 saved
```

Blocks are scanned in parallel but saved strictly in order, so progress never skips a block. Press **Ctrl+C** to stop. It finishes the block it is saving, then exits. Running the same command again resumes at the next block.

## Configuration

Defaults live in [`src/config.ts`](src/config.ts):

| Setting            | Default         | Notes                                 |
|--------------------|-----------------|---------------------------------------|
| `startBlock`       | `15779400`      | Used only on the first run of a chain |
| `minBalance`       | `0.5` ETH / BNB | Minimum balance to store an address   |
| `blockConcurrency` | `5`             | Blocks scanned in parallel            |
| `rpcBatchSize`     | `100`           | BSC rejects batches larger than 100   |
| `dbPath`           | `addresses.db`  | SQLite file in the project root       |

Override the RPC endpoint with environment variables:

```bash
ETHER_RPC_URL=https://your-eth-node npm start ether
BINANCE_RPC_URL=https://your-bsc-node npm start binance
```

Free public endpoints rate-limit heavily. Failed blocks are retried automatically, but a keyed RPC provider is much faster.

## Notes

- **Current balances only.** Balances are the current ones, not the balance at the scanned block, because historical state needs an archive node.
- **Contracts are included.** Contract addresses such as WETH or WBNB are stored too, if they hold enough.

## Development

```bash
npm run typecheck
```

```
src/
├── index.ts    # CLI entry: parallel block scan, ordered saving, retries
├── db.ts       # SQLite store: unique addresses + per-chain progress
└── config.ts   # chains, RPC URLs, thresholds
```
