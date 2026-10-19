// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DrippToken} from "./DrippToken.sol";

/// @title PTToken
/// @notice Principal Token. 1 PT is redeemable at maturity for shares worth 1 unit of the stock
///         token's UI amount (raw * uiMultiplier / 1e18), measured at the vault's high-water index.
contract PTToken is DrippToken {
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address stockToken_,
        uint256 maturity_
    ) DrippToken(name_, symbol_, decimals_, stockToken_, maturity_) {}
}
