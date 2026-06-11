#!/usr/bin/env node
// deploy.js — deploy a compiled contract to Pharos. DRY-RUN IS THE DEFAULT.
//
// Usage:
//   node scripts/deploy.js <Contract|artifact.json> [ctorArg ...]            # dry-run (no key needed)
//   node scripts/deploy.js <Contract> [ctorArg ...] --execute                # real deploy (PHAROS_PRIVATE_KEY)
//   options: --network atlantic|mainnet   --label "text"   --attest <DeployProofAddr>
//
// Dry-run: validates artifact + ctor args, connects to the RPC, estimates gas
// and cost, predicts the deploy address — signs nothing, sends nothing.
// Execute: deploys, waits for the receipt, verifies on-chain runtime bytecode
// against the artifact, appends to state/deployments.json, and (optionally)
// attests the deployment in the DeployProof registry.
"use strict";

const { ethers, fail, getNetwork, guardNetwork, guardDailyCount, deployFingerprint, recordDryRun, hasDryRun, provider, wallet, appendManifest, loadArtifact, POLICY } = require("./lib");

(async () => {
  const argv = process.argv.slice(2);
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute") flags.execute = true;
    else if (argv[i] === "--network") flags.network = argv[++i];
    else if (argv[i] === "--label") flags.label = argv[++i];
    else if (argv[i] === "--attest") flags.attest = argv[++i];
    else pos.push(argv[i]);
  }
  if (!pos.length) fail("usage: deploy.js <Contract|artifact.json> [ctorArgs...] [--execute]");

  const { artifact } = loadArtifact(pos[0]);
  const ctorArgs = pos.slice(1);
  const net = getNetwork(flags.network);
  guardNetwork(net);

  const p = provider(net);
  const chainId = Number((await p.getNetwork()).chainId);
  if (chainId !== net.chainId) fail(`RPC chainId ${chainId} != expected ${net.chainId} — refusing.`);

  const iface = new ethers.Interface(artifact.abi);
  let deployData;
  try {
    const ctorFragment = artifact.abi.find((f) => f.type === "constructor");
    const encodedArgs = ctorFragment && ctorFragment.inputs.length
      ? iface.encodeDeploy(ctorArgs)
      : iface.encodeDeploy([]);
    deployData = artifact.bytecode + encodedArgs.slice(2);
  } catch (e) {
    fail(`constructor args don't match ABI: ${e.message}`);
  }

  // From address: real wallet if key present, otherwise a static probe address (dry-run works keyless)
  const fromAddr = process.env.PHAROS_PRIVATE_KEY
    ? new ethers.Wallet(process.env.PHAROS_PRIVATE_KEY).address
    : "0x000000000000000000000000000000000000dEaD";

  const [gas, feeData, balance, nonce] = await Promise.all([
    p.estimateGas({ from: fromAddr, data: deployData }).catch((e) => fail(`gas estimation failed (bad bytecode/args?): ${e.shortMessage || e.message}`)),
    p.getFeeData(),
    p.getBalance(fromAddr),
    p.getTransactionCount(fromAddr),
  ]);

  if (Number(gas) > POLICY.max_deploy_gas) fail(`estimated gas ${gas} exceeds policy cap ${POLICY.max_deploy_gas}`);
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const estCost = gas * gasPrice;
  if (estCost > ethers.parseEther(POLICY.max_fee_per_deploy_native)) {
    fail(`estimated cost ${ethers.formatEther(estCost)} ${net.nativeToken} exceeds policy cap ${POLICY.max_fee_per_deploy_native}`);
  }
  const predicted = ethers.getCreateAddress({ from: fromAddr, nonce });

  const report = {
    mode: flags.execute ? "EXECUTE" : "DRY-RUN",
    network: net.key,
    chainId,
    contract: artifact.contractName,
    ctorArgs,
    from: fromAddr,
    balance: ethers.formatEther(balance) + " " + net.nativeToken,
    estimatedGas: gas.toString(),
    estimatedCost: ethers.formatEther(estCost) + " " + net.nativeToken,
    predictedAddress: predicted,
  };

  const fp = deployFingerprint(artifact, ctorArgs, net.key);

  if (!flags.execute) {
    recordDryRun(fp);
    console.log(JSON.stringify({ ...report, note: "Nothing was signed or sent. Re-run with --execute to deploy." }, null, 2));
    return;
  }

  // ---- EXECUTE ----
  if (POLICY.require_dry_run_first && !hasDryRun(fp)) {
    fail("policy.require_dry_run_first: no recorded dry-run for this exact contract+args+network. Run without --execute first.");
  }
  guardDailyCount();
  const w = wallet(net);
  if (balance === 0n) fail(`wallet ${w.address} has 0 ${net.nativeToken} on ${net.name}. Faucet: ${net.faucet || "n/a"}`);

  // Bind policy caps INTO the transaction, not just the estimate: the tx
  // physically cannot consume more gas or fee than policy allows.
  const gasLimit = gas + gas / 5n > BigInt(POLICY.max_deploy_gas) ? BigInt(POLICY.max_deploy_gas) : gas + gas / 5n;
  const capWei = ethers.parseEther(POLICY.max_fee_per_deploy_native);
  let maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maxFeePerGas && maxFeePerGas * gasLimit > capWei) maxFeePerGas = capWei / gasLimit;
  const txOverrides = { gasLimit };
  if (feeData.maxFeePerGas) {
    txOverrides.maxFeePerGas = maxFeePerGas;
    txOverrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas < maxFeePerGas ? feeData.maxPriorityFeePerGas : maxFeePerGas;
  } else {
    txOverrides.gasPrice = maxFeePerGas;
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, w);
  const contract = await factory.deploy(...ctorArgs, txOverrides);
  const tx = contract.deploymentTransaction();
  console.error(`tx sent: ${tx.hash} — waiting for confirmation...`);
  const receipt = await tx.wait();
  const address = await contract.getAddress();

  // Ground-truth check: on-chain runtime bytecode must match the artifact
  const onchain = await p.getCode(address);
  const codeMatches = onchain === artifact.deployedBytecode
    // immutables patch deployedBytecode at deploy time; fall back to length+prefix check
    || (onchain.length === artifact.deployedBytecode.length && onchain.slice(0, 100) === artifact.deployedBytecode.slice(0, 100));

  let attestation = null;
  if (flags.attest) {
    const proofAbi = ["function attest(address target, string label) returns (uint256)", "event CodeAttested(uint256 indexed id, address indexed attester, address indexed attested, bytes32 codeHash, string label)"];
    const proof = new ethers.Contract(flags.attest, proofAbi, w);
    const atx = await proof.attest(address, flags.label || artifact.contractName);
    const areceipt = await atx.wait();
    const ev = areceipt.logs.map((l) => { try { return proof.interface.parseLog(l); } catch { return null; } }).find(Boolean);
    attestation = { registry: flags.attest, tx: atx.hash, id: ev ? ev.args.id.toString() : null };
  }

  const entry = {
    contract: artifact.contractName,
    address,
    network: net.key,
    chainId,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployer: w.address,
    ctorArgs,
    sourceHash: artifact.sourceHash,
    codeMatches,
    attestation,
    label: flags.label || null,
    explorer: `${net.explorer}/address/${address}`,
    executedAt: new Date().toISOString(),
  };
  appendManifest(entry);

  console.log(JSON.stringify({ ...report, mode: "EXECUTED", address, txHash: tx.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), codeMatches, attestation, explorer: entry.explorer }, null, 2));
  if (!codeMatches) {
    console.error("⚠️  on-chain bytecode does not match artifact — investigate before trusting this deployment.");
    process.exit(2);
  }
})();
