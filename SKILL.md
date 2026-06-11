---
name: pharos-deploy
description: Deploy smart contracts to the Pharos network from natural language — compile Solidity, dry-run with gas/cost estimates, deploy with policy guardrails, attest provenance on-chain in the DeployProof registry, and trust-check any deployed contract's bytecode. Use when an agent needs to put code on Pharos (Atlantic testnet by default) or verify what's already there.
---

# Pharos Deploy Skill

Deployment is the missing primitive of the agent economy: every Phase-2 Agent on Pharos needs contracts on-chain, and most agents can't safely put them there. This Skill gives any AI agent a **compile → dry-run → deploy → attest → verify** pipeline with hard guardrails a human owns and the agent cannot bypass.

## What the agent can do

| Intent ("user says") | Command |
|---|---|
| "compile my contract" | `node scripts/compile.js contracts/MyToken.sol` |
| "what would it cost to deploy?" | `node scripts/deploy.js MyToken arg1 arg2` (dry-run, **default**, keyless) |
| "deploy it to Pharos testnet" | `node scripts/deploy.js MyToken arg1 arg2 --execute` |
| "deploy and attest provenance" | `node scripts/deploy.js MyToken --execute --attest <DeployProofAddr> --label "v1"` |
| "is this contract what it claims?" | `node scripts/check.js <addr> MyToken --proof <DeployProofAddr>` |
| "wallet / network / history status" | `node scripts/status.js` |

All script output is JSON — built to be parsed by agents, not humans.

## Safety model (read before --execute)

1. **Dry-run is the default — and enforced.** No flag, no key → full validation, gas estimate, cost estimate, predicted address; nothing signed, nothing sent. `--execute` refuses to run unless the exact same contract+args+network was dry-run first (`policy.require_dry_run_first`).
2. **The key never touches the CLI.** Real execution reads `PHAROS_PRIVATE_KEY` from the environment only; it is never logged and never written to the manifest.
3. **Policy caps are bound into the transaction** (`assets/policy.json`): the deploy tx is sent with a `gasLimit` and `maxFeePerGas` derived from the caps, so it physically cannot consume more than policy allows — the cap guards the spend, not just the estimate. Honest scope: the scripts expose no policy-edit command, but enforcement assumes the policy file itself is owned by the human (file permissions / repo ownership) — an agent with unrestricted shell access could rewrite any local file.
4. **Mainnet is double-locked:** `allow_mainnet=true` in policy AND `PHAROS_ALLOW_MAINNET=yes` in the environment — both human actions.
5. **Ground truth after every deploy:** on-chain runtime bytecode is fetched and compared against the artifact; mismatch exits non-zero.

## On-chain provenance: DeployProof

`contracts/DeployProof.sol` is a public, permissionless attestation registry. After a deploy, the Skill calls `attest(target, label)`; the registry recomputes the target's codehash **on-chain** and emits `CodeAttested`.

**Trust model — be precise about what's proven.** An attestation proves: *this attester saw this exact code at this address at this time.* The codehash is unforgeable (read from the chain inside `attest`, never supplied by the caller). The attester is just `msg.sender` — anyone can attest any contract, and labels are unauthenticated text. So consumers anchor trust in the **attester address**: "is the wallet I already trust among this contract's attesters, and does `stillMatches` still hold?"

- `attestationsForRange(contract, start, count)` — paginated provenance lookup (spam-proof reads)
- `stillMatches(id)` — has the bytecode CHANGED since attestation? (Detects code replacement; a byte-identical metamorphic redeploy keeps the same codehash and is out of scope.)

That makes deployments **composable trust**: a Phase-2 agent can refuse to compose with a contract unless an attester it trusts has attested it and the code still matches.

## Network defaults

Atlantic testnet (chainId 688689) is the only network in policy out of the box. Faucet: https://zan.top/faucet/pharos. State (deploy manifest) lives in `state/deployments.json` — append-only, agent-readable.

## Files

- `scripts/compile.js` — solc 0.8.28, optimizer on, artifact with source hash
- `scripts/deploy.js` — dry-run/execute, policy guard, manifest, attestation
- `scripts/check.js` — bytecode trust check + attestation lookup (read-only)
- `scripts/status.js` — wallet/network/manifest status (read-only)
- `assets/networks.json` / `assets/policy.json` — config + human-owned limits
- `references/` — per-command guides for agent retrieval
