#!/usr/bin/env node
// status.js — wallet, network, and deployment-manifest status (read-only).
// Usage: node scripts/status.js [--network atlantic] [--address 0x...]
"use strict";

const { ethers, getNetwork, provider, readManifest } = require("./lib");

(async () => {
  const argv = process.argv.slice(2);
  const netName = argv.includes("--network") ? argv[argv.indexOf("--network") + 1] : "atlantic";
  const addrIdx = argv.indexOf("--address");
  const net = getNetwork(netName);
  const p = provider(net);

  const addr = addrIdx > -1
    ? argv[addrIdx + 1]
    : process.env.PHAROS_PRIVATE_KEY
      ? new ethers.Wallet(process.env.PHAROS_PRIVATE_KEY).address
      : null;

  const [block, feeData] = await Promise.all([p.getBlockNumber(), p.getFeeData()]);
  const out = {
    network: net.name,
    chainId: net.chainId,
    rpc: net.rpc,
    blockNumber: block,
    gasPrice: (feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n).toString(),
  };
  if (addr) {
    out.wallet = addr;
    out.balance = ethers.formatEther(await p.getBalance(addr)) + " " + net.nativeToken;
    out.nonce = await p.getTransactionCount(addr);
  }
  const m = readManifest();
  out.deployments = m.deployments.length;
  out.lastDeployment = m.deployments[m.deployments.length - 1] || null;
  console.log(JSON.stringify(out, null, 2));
})();
