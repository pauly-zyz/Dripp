// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IScaledUIAmount, IScaledUIAmountNewUIMultiplier} from "../../src/interfaces/IScaledUIAmount.sol";

/// @notice ERC-8056 stock token mock following the EIP reference implementation,
///         plus `setMultiplierNow` to change the multiplier instantly in tests.
contract MockStockToken is ERC20, ERC165, IScaledUIAmount, IScaledUIAmountNewUIMultiplier {
    uint256 private _uiMultiplier = 1e18;
    uint256 private _newUIMultiplier = 1e18;
    uint256 private _effectiveAt;

    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == type(IScaledUIAmount).interfaceId
            || id == type(IScaledUIAmountNewUIMultiplier).interfaceId || super.supportsInterface(id);
    }

    function uiMultiplier() public view returns (uint256) {
        return block.timestamp >= _effectiveAt ? _newUIMultiplier : _uiMultiplier;
    }

    function newUIMultiplier() external view returns (uint256) {
        return _newUIMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        return _effectiveAt;
    }

    function setUIMultiplier(uint256 m, uint256 at) public {
        require(m > 0 && at > block.timestamp, "bad");
        uint256 old = uiMultiplier();
        _uiMultiplier = old;
        _newUIMultiplier = m;
        _effectiveAt = at;
        emit UIMultiplierUpdated(old, m, at);
    }

    function setMultiplierNow(uint256 m) external {
        uint256 old = uiMultiplier();
        _uiMultiplier = m;
        _newUIMultiplier = m;
        _effectiveAt = block.timestamp;
        emit UIMultiplierUpdated(old, m, block.timestamp);
    }
}
