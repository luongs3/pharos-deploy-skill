// Shared plumbing for pharos-deploy-skill: config, provider, wallet, policy
// guard, and the append-only deployment manifest.
"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const NETWORKS = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "networks.json"), "utf8"));
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "policy.json"), "utf8"));
const STATE_DIR = path.join(ROOT, "state");
const MANIFEST = path.join(STATE_DIR, "deployments.json");

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function getNetwork(name) {
  const net = NETWORKS[name || "atlantic"];
  if (!net) fail(`unknown network "${name}". Known: ${Object.keys(NETWORKS).join(", ")}`);
  return { key: name || "atlantic", ...net };
}

/** Policy gate — every execution path goes through here before signing. */
function guardNetwork(net) {
  if (!POLICY.allowed_networks.includes(net.key)) {
    fail(`network "${net.key}" is not in policy.allowed_networks (${POLICY.allowed_networks.join(", ")}). A human must edit assets/policy.json to change this.`);
  }
  if (!net.testnet) {
    if (!POLICY.allow_mainnet) fail("mainnet is blocked by policy (allow_mainnet=false). A human must opt in.");
    if (process.env.PHAROS_ALLOW_MAINNET !== "yes") {
      fail("mainnet additionally requires PHAROS_ALLOW_MAINNET=yes in the environment (human-set).");
    }
    console.error("⚠️  MAINNET execution — real funds at risk.");
  }
}

function guardDailyCount() {
  const m = readManifest();
  const today = new Date().toISOString().slice(0, 10);
  const todays = m.deployments.filter((d) => d.executedAt && d.executedAt.startsWith(today));
  if (todays.length >= POLICY.max_deploys_per_day) {
    fail(`daily deploy cap reached (${POLICY.max_deploys_per_day}). Policy-owned limit.`);
  }
}

function provider(net) {
  return new ethers.JsonRpcProvider(net.rpc, net.chainId);
}

/** Key comes from env only — never CLI, never logged, never in the manifest. */
function wallet(net) {
  const key = process.env.PHAROS_PRIVATE_KEY;
  if (!key) fail("PHAROS_PRIVATE_KEY not set. Export it in the environment (never pass keys on the CLI).");
  try {
    return new ethers.Wallet(key, provider(net));
  } catch {
    fail("PHAROS_PRIVATE_KEY is not a valid private key.");
  }
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return { version: 1, deployments: [] };
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

function appendManifest(entry) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const m = readManifest();
  m.deployments.push(entry);
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
  return m.deployments.length - 1;
}

const DRYRUNS = path.join(STATE_DIR, "dryruns.json");

/** Fingerprint of a deploy intent: same artifact source, args, network. */
function deployFingerprint(artifact, ctorArgs, netKey) {
  return require("crypto").createHash("sha256")
    .update(JSON.stringify([artifact.sourceHash, artifact.contractName, ctorArgs, netKey]))
    .digest("hex");
}

function recordDryRun(fp) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  let d = {};
  if (fs.existsSync(DRYRUNS)) d = JSON.parse(fs.readFileSync(DRYRUNS, "utf8"));
  d[fp] = new Date().toISOString();
  fs.writeFileSync(DRYRUNS, JSON.stringify(d, null, 2));
}

function hasDryRun(fp) {
  if (!fs.existsSync(DRYRUNS)) return false;
  const d = JSON.parse(fs.readFileSync(DRYRUNS, "utf8"));
  return Boolean(d[fp]);
}

function loadArtifact(ref) {
  // Accept either an artifact JSON path or a bare contract name in out/
  let p = ref;
  if (!fs.existsSync(p)) p = path.join(ROOT, "out", `${ref}.json`);
  if (!fs.existsSync(p)) fail(`artifact not found: ${ref}. Run compile.js first.`);
  return { artifact: JSON.parse(fs.readFileSync(p, "utf8")), artifactPath: p };
}

module.exports = {
  ROOT, NETWORKS, POLICY, MANIFEST,
  fail, getNetwork, guardNetwork, guardDailyCount,
  deployFingerprint, recordDryRun, hasDryRun,
  provider, wallet, readManifest, appendManifest, loadArtifact,
  ethers,
};
