# Ruxxells batch transfer — mint wallet → Safe

Moves reserved Ruxxells NFTs from a single-purpose EOA (the wallet that did
the minting) to your Safe multisig, one `safeTransferFrom` per token.

## Before you run this

- **Use a fresh wallet.** The private key in `.env` should belong to a
  wallet created *only* for this mint — not your personal wallet, not
  anything holding other funds. After the transfer completes, treat that
  wallet as burned: sweep out any leftover gas ETH and never reuse the key.
- **Never share the private key.** Don't paste it into a chat (including
  Claude), don't commit `.env` to git, don't leave it in shell history.
  `.env` is already covered by the `.gitignore` below — keep it that way.
- **Test on a testnet first** if Robinhood Chain has one available, before
  touching the real mint wallet.

## Setup

```bash
cp .env.example .env
# edit .env with your real RPC_URL, PRIVATE_KEY, NFT_CONTRACT, SAFE_ADDRESS, TOKEN_IDS
npm install
```

## Run it

```bash
# 1. Dry run — checks that the mint wallet actually owns each tokenId.
#    Sends zero transactions. Always do this first.
node batchTransfer.js

# 2. Live run — actually sends the transfers (5-second abort window first).
node batchTransfer.js --yes
```

Every run writes a `transfer-log-<timestamp>.csv` with the status and tx
hash for each token ID, so you have a record of exactly what moved where.

## TOKEN_IDS format

Comma-separated, ranges allowed:

```
TOKEN_IDS=1,2,3,10-20,42
```

## Notes

- Standard ERC-721 has no native batch-transfer, so this sends one
  transaction per token ID, sequentially, waiting for each confirmation
  before moving to the next (safer than firing them in parallel — avoids
  nonce collisions). For a large reserve this will take a while and cost
  gas per token; if your contract has a custom `batchTransferFrom`-style
  function, it's worth asking the contract author about using that instead
  to cut it down to one transaction.
- The script checks `ownerOf(tokenId)` before attempting a transfer and
  skips (rather than fails) any token the mint wallet doesn't actually
  hold, so it's safe to pass a token ID list that includes ones already
  moved or never minted.
- `CONFIRMATIONS` in `.env` controls how many block confirmations to wait
  for per transfer before moving to the next one (default 1).
