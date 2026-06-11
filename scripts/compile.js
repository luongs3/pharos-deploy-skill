#!/usr/bin/env node
// compile.js — compile a Solidity file with solc, write artifact to out/<Contract>.json
// Usage: node scripts/compile.js contracts/HelloPharos.sol [--contract HelloPharos]
"use strict";

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ROOT, fail } = require("./lib");

const args = process.argv.slice(2);
const srcPath = args.find((a) => !a.startsWith("--"));
if (!srcPath) fail("usage: compile.js <file.sol> [--contract Name]");
const wantIdx = args.indexOf("--contract");
const wantName = wantIdx > -1 ? args[wantIdx + 1] : null;

const fullSrc = path.resolve(srcPath);
if (!fs.existsSync(fullSrc)) fail(`source not found: ${fullSrc}`);
const source = fs.readFileSync(fullSrc, "utf8");

const input = {
  language: "Solidity",
  sources: { [path.basename(fullSrc)]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  fail("compilation failed");
}
(out.errors || []).filter((e) => e.severity === "warning").forEach((e) => console.error(e.formattedMessage));

const fileKey = path.basename(fullSrc);
const contracts = out.contracts[fileKey] || {};
const names = Object.keys(contracts);
if (!names.length) fail("no contracts in source");
const name = wantName || names[names.length - 1];
if (!contracts[name]) fail(`contract "${name}" not in ${fileKey} (found: ${names.join(", ")})`);

const c = contracts[name];
const artifact = {
  contractName: name,
  sourceFile: fileKey,
  sourceHash: require("crypto").createHash("sha256").update(source).digest("hex"),
  compiler: { name: "solc", version: solc.version(), optimizer: { enabled: true, runs: 200 } },
  abi: c.abi,
  bytecode: "0x" + c.evm.bytecode.object,
  deployedBytecode: "0x" + c.evm.deployedBytecode.object,
  metadata: c.metadata,
  compiledAt: new Date().toISOString(),
};

const outDir = path.join(ROOT, "out");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${name}.json`);
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(JSON.stringify({ ok: true, contract: name, artifact: path.relative(ROOT, outPath), solc: solc.version(), bytecodeBytes: (c.evm.bytecode.object.length / 2) }, null, 2));
