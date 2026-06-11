# deploy.js — reference

Dry-run is the default; `--execute` is the only way anything gets signed — and it refuses to run unless the same contract+args+network was dry-run first (`policy.require_dry_run_first`, tracked in `state/dryruns.json`). Policy gas/cost caps are bound into the transaction as `gasLimit`/`maxFeePerGas`, so the sent tx cannot exceed them.

```
node scripts/deploy.js <Contract|artifact.json> [ctorArg ...] [flags]
```

Flags:
- `--execute` — actually deploy. Requires `PHAROS_PRIVATE_KEY` in env. Subject to policy (network allowlist, gas cap, cost cap, daily cap).
- `--network atlantic|mainnet` — default `atlantic`. Mainnet requires policy `allow_mainnet=true` AND env `PHAROS_ALLOW_MAINNET=yes`.
- `--attest <DeployProofAddr>` — after a successful deploy, record provenance in the DeployProof registry (second tx).
- `--label "text"` — label stored with the attestation + manifest entry.

Dry-run output fields: `estimatedGas`, `estimatedCost`, `predictedAddress` (CREATE address from sender nonce), `balance`.

Execute adds: `address`, `txHash`, `blockNumber`, `gasUsed`, `codeMatches` (on-chain runtime bytecode vs artifact — `false` exits code 2), `attestation {registry, tx, id}`, `explorer`.

Constructor args are positional strings; ethers coerces them against the ABI. Mismatched args fail in dry-run, before anything is signed.

Failure modes: RPC chainId mismatch (refuses), zero balance (points at the faucet), gas/cost above policy caps, daily cap reached.
