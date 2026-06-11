# pharos-deploy — the deployment Skill for AI agents on Pharos

**Pharos × Anvita Skill-to-Agent Hackathon — Phase 1 submission**

Every Agent in the Pharos agent economy will eventually need code on-chain — its escrow, its registry, its strategy vault. Today that step is where autonomy ends: the human takes over, opens Remix or Hardhat, and deploys by hand.

**pharos-deploy** closes that gap. It is a reusable Skill that lets any AI agent **compile, cost-estimate, deploy, attest, and trust-check smart contracts on Pharos** — inside guardrails a human owns and the agent cannot bypass.

```
agent: "Deploy my escrow contract to Pharos testnet and attest it."

  → compile.js   solc 0.8.28, optimizer, artifact + source hash
  → deploy.js    DRY-RUN first: gas, cost, predicted address — signs nothing
  → deploy.js    --execute: deploy, wait, verify on-chain bytecode == artifact
  → DeployProof  attest(addr, label) — provenance recorded ON-CHAIN
  → check.js     any agent, any time: is this contract still what was attested?
```

## Why this Skill is different

Most deploy tooling answers *"how do I send bytecode?"*. The hard questions for **autonomous** deployment are different:

1. **"What is this going to cost before I commit?"** — Dry-run is the default mode *and a prerequisite*: keyless, signs nothing, returns gas, cost in PHRS, and the predicted contract address as JSON — and `--execute` refuses to run for any contract+args+network that wasn't dry-run first.
2. **"How do I stop an agent from deploying garbage to mainnet at 3am?"** — A policy file with caps that are **bound into the transaction** (`gasLimit` + `maxFeePerGas` derived from policy), not just checked against an estimate: the tx physically cannot overspend the caps. Networks are testnet-only out of the box; mainnet needs **two** separate human opt-ins. (Scope, stated honestly: the scripts expose no policy-edit command; keeping the policy file itself out of the agent's write reach is the human's job — file permissions, repo ownership.)
3. **"How does anyone trust what an agent deployed?"** — The **DeployProof registry** (included, deployed on Atlantic): after each deploy, the Skill attests the target on-chain. The codehash is recomputed **by the registry contract itself** — it cannot be supplied or faked. The attester is `msg.sender`, permissionless by design: an attestation proves *this attester saw this code at this address at this time*, and trust anchors in **which address attested** — exactly the question another agent can answer mechanically before composing. `stillMatches(id)` detects replaced bytecode; paginated getters keep lookups usable even under attestation spam.

Point 3 is the composability play: **DeployProof turns every deployment into a verifiable fact other Skills can build on.** A payment Skill can require the payee contract be attested by a wallet it trusts; a DAO Skill can require its modules still match their attestations. Provenance as a primitive.

## Quick start (60 seconds, no key needed)

```bash
npm install                                        # ethers v6 + solc
node scripts/compile.js contracts/HelloPharos.sol  # → out/HelloPharos.json
node scripts/deploy.js HelloPharos "gm"            # DRY-RUN: cost + predicted addr
```

Real deploy to Atlantic testnet (faucet: https://zan.top/faucet/pharos):

```bash
export PHAROS_PRIVATE_KEY=0x<testnet-key>          # env only — never CLI, never logged
node scripts/deploy.js HelloPharos "gm" --execute
node scripts/deploy.js HelloPharos "gm" --execute --attest <DeployProofAddr> --label "demo"
node scripts/check.js <deployedAddr> HelloPharos --proof <DeployProofAddr>
```

Every command prints machine-readable JSON. Every executed deploy is appended to `state/deployments.json` (address, tx, gas, source hash, attestation id) — an agent-readable memory of everything it has ever put on-chain.

## Live on Atlantic testnet

Everything below was deployed **by this Skill, run by an AI agent** — dry-run first, then `--execute`, bytecode-verified after, attested on-chain.

| What | Where |
|---|---|
| DeployProof registry v1.1 | [`0xe0F337845C1747bfeF1B16Ed3a0201C4d7A2A71D`](https://atlantic.pharosscan.xyz/address/0xe0F337845C1747bfeF1B16Ed3a0201C4d7A2A71D) — deploy tx [`0x54dc32…ead9dd`](https://atlantic.pharosscan.xyz/tx/0x54dc32455eec948c68088ff4ab4a9fec2f74be01b7a64d178079ae8bf9ead9dd) |
| └ self-attestation (id 0) | tx [`0xc0ae43…ce65b9a`](https://atlantic.pharosscan.xyz/tx/0xc0ae433a105cc8af4fc9a77b496bd9981f50b2fae8ee634f9ce5228a1ce65b9a) |
| Demo deploy (HelloPharos) | [`0x269E73390fad616cadcbE02d36149c84D47c5D62`](https://atlantic.pharosscan.xyz/address/0x269E73390fad616cadcbE02d36149c84D47c5D62) — deploy tx [`0xf4e2bc…ad5328`](https://atlantic.pharosscan.xyz/tx/0xf4e2bc734fd7f17048ffb6bda1447744c7381b9b85351a399d86819ee3ad5328) |
| └ attestation (id 1) | tx [`0xd2a504…843f9d`](https://atlantic.pharosscan.xyz/tx/0xd2a504e3738c67dc7671ee4b4edafa51aded98c125475861038fd9fe7c843f9d) — `stillMatches(1) == true` via `check.js` |

(An earlier v1.0 registry lives at [`0xce3891…34Ef`](https://atlantic.pharosscan.xyz/address/0xce38911461B698735DBc0bA21c73202C934934Ef) — superseded after an independent security review tightened the trust-model semantics and added paginated reads.)

## Phase 2 vision

pharos-deploy is the bottom layer of an **Agent Foundry**: an agent that takes a natural-language spec, writes the contract, dry-runs it, deploys it, attests it, and hands back a verified address — the full idea-to-on-chain loop with a human only at the policy file. Combined with payment Skills from this hackathon, Phase-2 agents can *charge* for verified deployments: deployment-as-a-service between agents, settled on Pharos.

## Architecture

```
pharos-deploy-skill
├── SKILL.md                ← agent manifest + trigger guide
├── contracts/
│   ├── DeployProof.sol     ← on-chain provenance registry (the composable part)
│   └── HelloPharos.sol     ← demo target
├── scripts/
│   ├── lib.js              ← config, policy guard, manifest (shared)
│   ├── compile.js          ← solc → artifact (abi, bytecode, source hash)
│   ├── deploy.js           ← dry-run default / --execute / --attest
│   ├── check.js            ← bytecode + attestation trust check (read-only)
│   └── status.js           ← wallet/network/manifest status (read-only)
├── assets/
│   ├── networks.json       ← Atlantic testnet (default) + mainnet (blocked)
│   └── policy.json         ← HUMAN-OWNED limits — the agent cannot edit its way past this
├── references/             ← per-command docs for agent retrieval
└── state/deployments.json  ← append-only deploy manifest (generated)
```

## License

MIT
