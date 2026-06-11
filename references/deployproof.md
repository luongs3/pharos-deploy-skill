# DeployProof registry — reference

On-chain code attestation for agent deployments. One registry per network; permissionless: anyone can attest any contract.

## Trust model (the part that matters)

An attestation proves exactly one thing: **this attester saw this exact code (codehash) at this address at this time.**

- **Unforgeable:** the codehash is read from the target inside `attest()` — the caller never supplies it.
- **Permissionless:** `attester` is just `msg.sender`. The registry does NOT verify the attester deployed or owns the target.
- **Labels are untrusted** attester-supplied text.

Consumers therefore anchor trust in the **attester address**: "has a wallet I already trust attested this contract, and does the code still match?" An attestation from an unknown wallet proves nothing about legitimacy.

## Contract API

- `attest(address target, string label) → uint256 id` — reverts if no code at target. Emits `CodeAttested(id, attester, attested, codeHash, label)`.
- `attestations(id) → (attester, attested, codeHash, label, timestamp)`
- `attestationCountFor(target)` / `attestationCountOf(attester)` — totals.
- `attestationsForRange(target, start, count)` / `attestationsOfRange(attester, start, count)` — paginated id lookups. Lists are unbounded (permissionless writes), so always read ranges; `check.js` reads the first 20 and reports the total.
- `stillMatches(id) → bool` — current codehash vs attested codehash. `false` = the bytecode at that address **changed** since attestation: do not trust it. Scope note: a metamorphic redeploy of byte-identical code keeps the same codehash and is not detected — this checks code identity, not deployment continuity.

## Agent patterns

- **Before composing with an unknown contract:** `check.js <addr> <Artifact> --proof <registry>` — bytecode match + attester list in one JSON. Then decide: is a trusted attester in the list?
- **After deploying anything:** `deploy.js ... --execute --attest <registry>` — make your deployment a fact other agents can verify.
- The registry deployed via this Skill attests itself as entry 0 — turtles, but verified turtles.
