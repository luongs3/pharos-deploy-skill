#!/usr/bin/env node
// check.js — trust check for an already-deployed contract (read-only).
// Compares on-chain runtime bytecode at <address> against a local artifact,
// and (optionally) checks its DeployProof attestation still matches.
// Usage: node scripts/check.js <address> <Contract|artifact.json> [--network atlantic] [--proof <DeployProofAddr>]
"use strict";

const { ethers, fail, getNetwork, provider, loadArtifact } = require("./lib");

(async () => {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--network" && argv[i - 1] !== "--proof");
  if (pos.length < 2) fail("usage: check.js <address> <Contract|artifact.json> [--proof 0x...]");
  const [address, ref] = pos;
  const netName = argv.includes("--network") ? argv[argv.indexOf("--network") + 1] : "atlantic";
  const proofAddr = argv.includes("--proof") ? argv[argv.indexOf("--proof") + 1] : null;

  const { artifact } = loadArtifact(ref);
  const net = getNetwork(netName);
  const p = provider(net);

  const onchain = await p.getCode(address);
  if (onchain === "0x") fail(`no code at ${address} on ${net.name}`);

  const exact = onchain === artifact.deployedBytecode;
  const fuzzy = onchain.length === artifact.deployedBytecode.length && onchain.slice(0, 100) === artifact.deployedBytecode.slice(0, 100);

  const out = {
    address,
    network: net.key,
    contract: artifact.contractName,
    onchainCodeHash: ethers.keccak256(onchain),
    artifactCodeHash: ethers.keccak256(artifact.deployedBytecode),
    match: exact ? "EXACT" : fuzzy ? "MATCH (immutables differ, expected)" : "MISMATCH",
    explorer: `${net.explorer}/address/${address}`,
  };

  if (proofAddr) {
    const abi = [
      "function attestationCountFor(address) view returns (uint256)",
      "function attestationsForRange(address, uint256, uint256) view returns (uint256[])",
      "function stillMatches(uint256) view returns (bool)",
      "function attestations(uint256) view returns (address attester, address attested, bytes32 codeHash, string label, uint64 timestamp)",
    ];
    const proof = new ethers.Contract(proofAddr, abi, p);
    const total = await proof.attestationCountFor(address);
    const PAGE = 20; // attestation lists are unbounded and permissionless — read a bounded page
    const ids = await proof.attestationsForRange(address, 0, PAGE);
    out.attestationTotal = total.toString();
    out.attestationNote = "Anyone can attest any contract. Trust the ATTESTER address, not the label.";
    out.attestations = [];
    for (const id of ids) {
      const a = await proof.attestations(id);
      out.attestations.push({ id: id.toString(), attester: a.attester, label: a.label, timestamp: new Date(Number(a.timestamp) * 1000).toISOString(), stillMatches: await proof.stillMatches(id) });
    }
    if (total > BigInt(PAGE)) out.attestationTruncated = `showing first ${PAGE} of ${total}`;
  }

  console.log(JSON.stringify(out, null, 2));
  if (out.match === "MISMATCH") process.exit(2);
})();
