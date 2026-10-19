// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ERC-8056 core interface (Scaled UI Amount Extension for ERC-20 Tokens).
/// @dev Multiplier uses 18 decimals (1e18 = 1.0). ERC-165 id: 0xa60bf13d.
interface IScaledUIAmount {
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
    event TransferWithUIAmount(address indexed from, address indexed to, uint256 amount, uint256 uiAmount);
    event UIMultiplierUpdateCancelled(uint256 cancelledMultiplier, uint256 cancelledEffectiveAt);

    function uiMultiplier() external view returns (uint256);
}

/// @notice ERC-8056 required pending-multiplier extension. ERC-165 id: 0x4bd27648.
interface IScaledUIAmountNewUIMultiplier {
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
}
