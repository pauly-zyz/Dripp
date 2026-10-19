// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDividendOracle} from "./IDividendOracle.sol";

interface IDrippVaultFactory {
    /// @notice Fee settings shared by all vaults and the router. Basis points (10_000 = 100%).
    struct FeeConfig {
        /// @dev Fee on YT yield claims (SPEC: 5%).
        uint16 ytFeeBps;
        /// @dev Fee on router zaps (SPEC: 0.1%).
        uint16 zapFeeBps;
        /// @dev Part of each fee that goes to Stock Drip (SPEC: 60%); the rest goes to the treasury.
        uint16 stockDripShareBps;
        /// @dev Stock Drip receiver (DrippStaking later). address(0) sends everything to the treasury.
        address stockDrip;
        address treasury;
    }

    function oracle() external view returns (IDividendOracle);
    function treasury() external view returns (address);
    function feeConfig() external view returns (FeeConfig memory);
    function isVault(address vault) external view returns (bool);
}
