// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrippVault} from "../../src/DrippVault.sol";
import {PTToken} from "../../src/tokens/PTToken.sol";
import {YTToken} from "../../src/tokens/YTToken.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";

/// @notice Drives random sequences of split / merge / transfer / claim / redeem / multiplier changes.
contract DrippVaultHandler is Test {
    DrippVault public vault;
    MockStockToken public stock;
    PTToken public pt;
    YTToken public yt;
    address public treasury;

    address[] public actors;

    uint256 public constant MIN_MULT = 1e17;
    uint256 public constant MAX_MULT = 1e20;

    // ghost accounting
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public ghostOps;
    uint256 public ghostLastIndex;
    bool public ghostIndexDecreased;

    constructor(DrippVault vault_, MockStockToken stock_, address treasury_) {
        vault = vault_;
        stock = stock_;
        pt = vault_.pt();
        yt = vault_.yt();
        treasury = treasury_;
        ghostLastIndex = vault_.pyIndexStored();
        for (uint256 i; i < 4; i++) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            stock.mint(a, 1_000_000e18);
            vm.prank(a);
            stock.approve(address(vault), type(uint256).max);
        }
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    modifier track() {
        _;
        ghostOps++;
        uint256 idx = vault.pyIndexStored();
        if (idx < ghostLastIndex) ghostIndexDecreased = true;
        ghostLastIndex = idx;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function split(uint256 actorSeed, uint256 shares) external track {
        if (vault.isMatured()) return;
        address a = _actor(actorSeed);
        shares = bound(shares, 1, 10_000e18);
        if (vault.previewSplit(shares) == 0) return;
        vm.prank(a);
        vault.split(shares, a);
        ghostDeposited += shares;
    }

    function merge(uint256 actorSeed, uint256 amount) external track {
        if (vault.isMatured()) return;
        address a = _actor(actorSeed);
        uint256 max = pt.balanceOf(a) < yt.balanceOf(a) ? pt.balanceOf(a) : yt.balanceOf(a);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        ghostWithdrawn += vault.merge(amount, a);
    }

    function redeemPT(uint256 actorSeed, uint256 amount) external track {
        if (!vault.isMatured()) return;
        address a = _actor(actorSeed);
        uint256 bal = pt.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        uint256 tBefore = stock.balanceOf(treasury);
        vm.prank(a);
        uint256 out = vault.redeemPT(amount, a);
        ghostWithdrawn += out + (stock.balanceOf(treasury) - tBefore);
    }

    function claimYield(uint256 actorSeed) external track {
        address a = _actor(actorSeed);
        vm.prank(a);
        ghostWithdrawn += vault.claimYield(a);
    }

    function transferYT(uint256 fromSeed, uint256 toSeed, uint256 amount) external track {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 bal = yt.balanceOf(from);
        if (bal == 0) return;
        amount = bound(amount, 0, bal);
        vm.prank(from);
        yt.transfer(to, amount);
    }

    function transferPT(uint256 fromSeed, uint256 toSeed, uint256 amount) external track {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 bal = pt.balanceOf(from);
        if (bal == 0) return;
        amount = bound(amount, 0, bal);
        vm.prank(from);
        pt.transfer(to, amount);
    }

    /// @dev Multiplier moves up (dividends / splits) or down (to exercise the high-water mark).
    function changeMultiplier(uint256 bps, bool up) external track {
        uint256 m = stock.uiMultiplier();
        bps = bound(bps, 0, 5_000); // up to +/-50% per step
        uint256 next = up ? m + m * bps / 10_000 : m - m * bps / 10_000;
        if (next < MIN_MULT) next = MIN_MULT;
        if (next > MAX_MULT) next = MAX_MULT;
        stock.setMultiplierNow(next);
    }

    function scheduleMultiplier(uint256 bps, uint256 delay) external track {
        uint256 m = stock.uiMultiplier();
        bps = bound(bps, 0, 2_000);
        delay = bound(delay, 1, 30 days);
        uint256 next = m + m * bps / 10_000;
        if (next > MAX_MULT) next = MAX_MULT;
        stock.setUIMultiplier(next, block.timestamp + delay);
    }

    function warp(uint256 secs) external track {
        secs = bound(secs, 1, 60 days);
        vm.warp(block.timestamp + secs);
    }

    function poke() external track {
        vault.updateIndex();
    }
}
