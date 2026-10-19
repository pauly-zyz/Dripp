// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDrippVault {
    event Split(
        address indexed caller, address indexed receiver, uint256 sharesIn, uint256 pyOut, uint256 index
    );
    event Merge(
        address indexed caller, address indexed receiver, uint256 pyIn, uint256 sharesOut, uint256 index
    );
    event Redeem(
        address indexed caller, address indexed receiver, uint256 ptIn, uint256 sharesOut, uint256 index
    );
    /// @param sharesOut raw tokens sent to `receiver`; `fee` raw tokens went to Stock Drip / treasury.
    event YieldClaimed(address indexed user, address indexed receiver, uint256 sharesOut, uint256 fee);
    event FeePaid(
        address indexed stockDrip, uint256 toStockDrip, address indexed treasury, uint256 toTreasury
    );
    event IndexUpdated(uint256 oldIndex, uint256 newIndex);
    event MaturityIndexSet(uint256 index);
    event PostMaturityYieldToTreasury(address indexed treasury, uint256 shares);
    event DepositCapUpdated(uint256 cap);

    error Matured();
    error NotMatured();
    error ZeroAmount();
    error OnlyYT();
    error OnlyFactory();
    error InvalidMultiplier();
    error DepositCapExceeded();

    /// @notice Called by the YT token before every balance change (mint, burn, transfer).
    function onYTBalanceChange(address from, address to) external;
}
