/**
 * Ruxxells batch transfer — moves reserved NFTs from a mint wallet to the
 * Safe multisig, one safeTransferFrom per tokenId.
 *
 * Usage:
 *   1. cp .env.example .env   and fill it in
 *   2. npm install
 *   3. node batchTransfer.js --dry-run     (checks ownership only, sends nothing)
 *   4. node batchTransfer.js --yes         (actually sends the transfers)
 *
 * The script refuses to send anything unless you pass --yes, so a plain
 * `node batchTransfer.js` is always safe to run as a sanity check.
 */

import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";

const ERC721_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
];

function parseTokenIds(raw) {
  if (!raw) return [];
  const ids = new Set();
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((n) => parseInt(n.trim(), 10));
      if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
        throw new Error(`Bad range in TOKEN_IDS: "${part}"`);
      }
      for (let i = a; i <= b; i++) ids.add(i);
    } else {
      const n = parseInt(part, 10);
      if (Number.isNaN(n)) throw new Error(`Bad token id in TOKEN_IDS: "${part}"`);
      ids.add(n);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required .env value: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--yes");

  const RPC_URL = requireEnv("RPC_URL");
  const PRIVATE_KEY = requireEnv("PRIVATE_KEY");
  const NFT_CONTRACT = requireEnv("NFT_CONTRACT");
  const SAFE_ADDRESS = requireEnv("SAFE_ADDRESS");
  const TOKEN_IDS = parseTokenIds(requireEnv("TOKEN_IDS"));
  const CONFIRMATIONS = parseInt(process.env.CONFIRMATIONS || "1", 10);

  if (!ethers.isAddress(NFT_CONTRACT)) throw new Error("NFT_CONTRACT is not a valid address");
  if (!ethers.isAddress(SAFE_ADDRESS)) throw new Error("SAFE_ADDRESS is not a valid address");
  if (TOKEN_IDS.length === 0) throw new Error("TOKEN_IDS is empty");

  const provider = new ethers.JsonRpcProvider(RPC_URL, process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const nft = new ethers.Contract(NFT_CONTRACT, ERC721_ABI, wallet);

  console.log("─".repeat(60));
  console.log(`Mode:          ${dryRun ? "DRY RUN (no transactions will be sent)" : "LIVE — will send transactions"}`);
  console.log(`From (mint wallet): ${wallet.address}`);
  console.log(`To (Safe):          ${SAFE_ADDRESS}`);
  console.log(`Contract:           ${NFT_CONTRACT}`);
  console.log(`Token IDs (${TOKEN_IDS.length}):  ${TOKEN_IDS.join(", ")}`);
  console.log("─".repeat(60));

  if (dryRun) {
    console.log("Checking ownership only. Re-run with --yes to actually transfer.\n");
  } else {
    console.log("Sending transfers in 5 seconds — Ctrl+C now to abort.\n");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const results = [];

  for (const tokenId of TOKEN_IDS) {
    let owner;
    try {
      owner = await nft.ownerOf(tokenId);
    } catch (err) {
      console.log(`#${tokenId}  SKIP — ownerOf() reverted (token may not exist): ${err.shortMessage || err.message}`);
      results.push({ tokenId, status: "skip-no-owner", txHash: "" });
      continue;
    }

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.log(`#${tokenId}  SKIP — owned by ${owner}, not the mint wallet`);
      results.push({ tokenId, status: "skip-not-owner", txHash: "" });
      continue;
    }

    if (dryRun) {
      console.log(`#${tokenId}  OK — owned by mint wallet, ready to transfer`);
      results.push({ tokenId, status: "dry-run-ok", txHash: "" });
      continue;
    }

    try {
      const tx = await nft.safeTransferFrom(wallet.address, SAFE_ADDRESS, tokenId);
      console.log(`#${tokenId}  sent tx ${tx.hash} — waiting for ${CONFIRMATIONS} confirmation(s)...`);
      await tx.wait(CONFIRMATIONS);
      console.log(`#${tokenId}  CONFIRMED`);
      results.push({ tokenId, status: "sent", txHash: tx.hash });
    } catch (err) {
      console.log(`#${tokenId}  FAILED — ${err.shortMessage || err.message}`);
      results.push({ tokenId, status: "failed", txHash: "" });
    }
  }

  const logPath = `./transfer-log-${Date.now()}.csv`;
  const csv = ["tokenId,status,txHash", ...results.map((r) => `${r.tokenId},${r.status},${r.txHash}`)].join("\n");
  fs.writeFileSync(logPath, csv);

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status.startsWith("skip")).length;

  console.log("\n" + "─".repeat(60));
  console.log(`Done. sent=${sent} failed=${failed} skipped=${skipped}`);
  console.log(`Log written to ${logPath}`);
  if (dryRun) console.log("This was a dry run — nothing was sent. Re-run with --yes to transfer for real.");
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
