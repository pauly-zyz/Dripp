// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Shared base for PT and YT: ERC-20 + permit, mint/burn restricted to the owning vault.
abstract contract DrippToken is ERC20, ERC20Permit {
    address public immutable vault;
    address public immutable stockToken;
    uint256 public immutable maturity;
    uint8 private immutable _decimals;

    error OnlyVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address stockToken_,
        uint256 maturity_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        vault = msg.sender;
        stockToken = stockToken_;
        maturity = maturity_;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function isMatured() public view returns (bool) {
        return block.timestamp >= maturity;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }
}
