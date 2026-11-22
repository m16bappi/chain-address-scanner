# Web3 Wallet Address Fetch

Scan Ethereum or BNB Smart Chain blocks and collect every **unique wallet address** that holds at least **0.5 ETH / BNB**, stored in a local SQLite database.

- Reads every transaction in each block and collects the `from` and `to` addresses
- Checks balances in JSON-RPC batches and skips addresses already stored
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
ether: starting at block 15779410
block 15779410: 150 txs, 237 addresses, 226 new, 9 saved
block 15779411: 160 txs, 252 addresses, 228 new, 12 saved
```

Press **Ctrl+C** to stop. It finishes the current block, then exits. Running the same command again resumes at the next block.

## Configuration

Defaults live in [`src/config.ts`](src/config.ts):

| Setting        | Default                               | Notes                                  |
|----------------|---------------------------------------|----------------------------------------|
| `startBlock`   | `15779400`                            | Used only on the first run of a chain  |
| `minBalance`   | `0.5` ETH / BNB                       | Minimum balance to store an address    |
| `rpcBatchSize` | `100`                                 | BSC rejects batches larger than 100    |
| `dbPath`       | `addresses.db`                        | SQLite file in the project root        |

Override the RPC endpoint with environment variables:

```bash
ETHER_RPC_URL=https://your-eth-node npm start ether
BINANCE_RPC_URL=https://your-bsc-node npm start binance
```

Free public endpoints rate-limit heavily. Failed blocks are retried automatically, but a keyed RPC provider is much faster.

## Database

All data is in `addresses.db`:

| Table      | Columns                                                         |
|------------|-----------------------------------------------------------------|
| `address`  | `chain`, `address`, `balance_wei`, `block_number`, `created_at` |
| `progress` | `chain`, `last_block`                                           |

`(chain, address)` is the primary key, so each address is stored only once per chain.

Example queries:

```bash
# count per chain
sqlite3 -header -column addresses.db "select chain, count(*) from address group by chain"

# top 10 richest addresses on Ethereum
sqlite3 -header -column addresses.db \
  "select address, cast(balance_wei as real) / 1e18 as eth
   from address where chain = 'ether'
   order by cast(balance_wei as real) desc limit 10"

# where each chain stopped
sqlite3 -header -column addresses.db "select * from progress"
```

To start over, delete `addresses.db`.

## Notes

- **Current balances only.** Balances are the current ones, not the balance at the scanned block, because historical state needs an archive node.
- **Contracts are included.** Contract addresses such as WETH or WBNB are stored too, if they hold enough.

## Development

```bash
npm run typecheck
```

```
src/
├── index.ts    # CLI entry: block loop, balance batching, retries
├── db.ts       # SQLite store: unique addresses + per-chain progress
└── config.ts   # chains, RPC URLs, thresholds
```
