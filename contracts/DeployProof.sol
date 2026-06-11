// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DeployProof — on-chain code-attestation registry for agent deployments
/// @notice Trust model (read this before composing):
///         An attestation proves exactly one thing: ATTESTER saw THIS CODE
///         (codehash, recomputed on-chain — unforgeable) at THIS ADDRESS at
///         THIS TIME. The attester is `msg.sender` — the registry does NOT
///         verify that the attester deployed or owns the target, and labels
///         are unauthenticated text. Trust is anchored in WHO attested:
///         consumers should check the attester address against identities
///         they already trust (e.g. the deployer wallet they expect).
contract DeployProof {
    struct Attestation {
        address attester;
        address attested;
        bytes32 codeHash; // keccak256 of the target's runtime bytecode at attest time
        string label;     // unauthenticated, attester-supplied
        uint64 timestamp;
    }

    Attestation[] public attestations;
    mapping(address => uint256[]) private byAttester;
    mapping(address => uint256[]) private byContract;

    event CodeAttested(
        uint256 indexed id,
        address indexed attester,
        address indexed attested,
        bytes32 codeHash,
        string label
    );

    /// @notice Attest the code currently at `target`. The codehash is read
    ///         from the chain inside this call, so it cannot be supplied or
    ///         faked by the attester.
    function attest(address target, string calldata label) external returns (uint256 id) {
        bytes32 codeHash = target.codehash;
        require(codeHash != bytes32(0) && codeHash != keccak256(""), "no code at address");

        id = attestations.length;
        attestations.push(
            Attestation(msg.sender, target, codeHash, label, uint64(block.timestamp))
        );
        byAttester[msg.sender].push(id);
        byContract[target].push(id);

        emit CodeAttested(id, msg.sender, target, codeHash, label);
    }

    function count() external view returns (uint256) {
        return attestations.length;
    }

    function attestationCountFor(address target) external view returns (uint256) {
        return byContract[target].length;
    }

    function attestationCountOf(address attester) external view returns (uint256) {
        return byAttester[attester].length;
    }

    /// @notice Paginated lookups — attestation lists are unbounded (anyone can
    ///         attest anything), so range queries keep reads usable even if a
    ///         target is spammed with attestations.
    function attestationsForRange(address target, uint256 start, uint256 maxCount)
        external view returns (uint256[] memory ids)
    {
        uint256[] storage all = byContract[target];
        uint256 end = start + maxCount;
        if (end > all.length) end = all.length;
        if (start >= end) return new uint256[](0);
        ids = new uint256[](end - start);
        for (uint256 i = start; i < end; i++) ids[i - start] = all[i];
    }

    function attestationsOfRange(address attester, uint256 start, uint256 maxCount)
        external view returns (uint256[] memory ids)
    {
        uint256[] storage all = byAttester[attester];
        uint256 end = start + maxCount;
        if (end > all.length) end = all.length;
        if (start >= end) return new uint256[](0);
        ids = new uint256[](end - start);
        for (uint256 i = start; i < end; i++) ids[i - start] = all[i];
    }

    /// @notice Does the code at the attested address still hash to what was
    ///         attested? `false` means the bytecode CHANGED since attestation.
    ///         Note: a metamorphic redeploy of byte-identical code keeps the
    ///         same codehash and is NOT detected — this checks code identity,
    ///         not deployment continuity.
    function stillMatches(uint256 id) external view returns (bool) {
        Attestation storage a = attestations[id];
        return a.attested.codehash == a.codeHash;
    }
}
