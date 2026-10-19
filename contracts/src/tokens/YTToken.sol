// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DrippToken} from "./DrippToken.sol";
import {IDrippVault} from "../interfaces/IDrippVault.sol";

/// @title YTToken
/// @notice Yield Token. Accrues, in stock-token shares, all growth of the ERC-8056 uiMultiplier
///         (above its high-water mark) on the principal it represents, until maturity.
/// @dev Every balance change first checkpoints the accrued yield of `from` and `to` in the vault,
///      so yield earned before a transfer stays with the sender.
contract YTToken is DrippToken {
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address stockToken_,
        uint256 maturity_
    ) DrippToken(name_, symbol_, decimals_, stockToken_, maturity_) {}

    function _update(address from, address to, uint256 value) internal override {
        IDrippVault(vault).onYTBalanceChange(from, to);
        super._update(from, to, value);
    }
}
