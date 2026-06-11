// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title HelloPharos — demo target contract for pharos-deploy-skill
contract HelloPharos {
    string public greeting;
    address public immutable deployer;
    uint256 public touches;

    event Touched(address indexed by, string note, uint256 total);

    constructor(string memory _greeting) {
        greeting = _greeting;
        deployer = msg.sender;
    }

    function touch(string calldata note) external {
        touches += 1;
        emit Touched(msg.sender, note, touches);
    }
}
