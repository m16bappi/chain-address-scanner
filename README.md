# Chain Address Scanner

Scan Ethereum or BNB Smart Chain blocks and collect every **unique wallet address** that holds at least **0.5 ETH / BNB**, stored in a local SQLite database.

- Reads every transaction in each block and collects the `from` and `to` addresses
- Checks all of a block's balances in a single request (Multicall3 `getEthBalance`), and scans several blocks in parallel
- Skips addresses that are already stored
- Saves each address once per chain, with its balance and the block it was found in
- A block that fails is recorded and retried in the next batch, so scanning never stalls or restarts from it
- Saves each batch in one transaction, so a restart continues where it stopped without losing or duplicating work

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

Failed blocks show as `block N failed, will retry` and come back later as `block N (retried)`. Press **Ctrl+C** to stop. It finishes the current batch, then exits. Running the same command again resumes where it stopped, retrying failed blocks first.

## Configuration

Defaults live in [`src/config.ts`](src/config.ts):

| Setting            | Default         | Notes                                 |
|--------------------|-----------------|---------------------------------------|
| `startBlock`       | `15779400`      | Used only on the first run of a chain |
| `minBalance`       | `0.5` ETH / BNB | Minimum balance to store an address   |
| `blockConcurrency` | `5`             | Blocks scanned in parallel            |
| `rpcBatchSize`     | `100`           | Max JSON-RPC calls per HTTP request   |
| `dbPath`           | `addresses.db`  | SQLite file in the project root       |

Override the RPC endpoint with environment variables:

```bash
ETHER_RPC_URL=https://your-eth-node npm start ether
BINANCE_RPC_URL=https://your-bsc-node npm start binance
```

Free public endpoints rate-limit. A keyed RPC provider lets you raise `blockConcurrency`.

## Notes

- **Current balances only.** Balances are the current ones, not the balance at the scanned block, because historical state needs an archive node.
- **Contracts are included.** Contract addresses such as WETH or WBNB are stored too, if they hold enough.

## Development

```bash
npm run typecheck
```

```
src/
├── index.ts    # CLI entry: parallel block batches, one balance call per block
├── db.ts       # SQLite store: unique addresses, progress, failed blocks
└── config.ts   # chains, RPC URLs, thresholds
```
