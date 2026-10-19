// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DrippVault} from "./DrippVault.sol";

/// @notice Holds the DrippVault creation code so DrippVaultFactory stays under the 24 KB size limit.
/// @dev Permissionless: the caller becomes the vault's `factory`, so calling this directly only
///      creates vaults the caller administers. Only vaults in the factory registry are Dripp series.
contract DrippVaultDeployer {
    function deploy(
        bytes32 salt,
        address stockToken,
        uint256 maturity,
        uint8 decimals,
        string calldata ticker,
        string calldata dateLabel,
        uint256 depositCap
    ) external returns (address) {
        return address(
            new DrippVault{salt: keccak256(abi.encode(msg.sender, salt))}(
                msg.sender, stockToken, maturity, decimals, ticker, dateLabel, depositCap
            )
        );
    }
}
