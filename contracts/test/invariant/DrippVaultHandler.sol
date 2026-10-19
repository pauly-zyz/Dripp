// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrippVault} from "../../src/DrippVault.sol";
import {DividendOracle} from "../../src/DividendOracle.sol";
import {IDividendOracle} from "../../src/interfaces/IDividendOracle.sol";
import {PTToken} from "../../src/tokens/PTToken.sol";
import {YTToken} from "../../src/tokens/YTToken.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";

/// @notice Drives random sequences of split / merge / transfer / claim / redeem, multiplier changes and
///         oracle proposals (dividend, split, mixed), disputes and confirmations.
contract DrippVaultHandler is Test {
    DrippVault public vault;
    DividendOracle public oracle;
    MockStockToken public stock;
    PTToken public pt;
    YTToken public yt;
    address public keeper;
    address public disputer;

    address[] public actors;

    uint256 public constant MIN_MULT = 1e17;
    uint256 public constant MAX_MULT = 1e20;

    // ghost accounting
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public ghostOps;
    uint256 public ghostLastIndex;
    bool public ghostIndexDecreased;
    bool public ghostSplitAccrued;
    uint256 public ghostSplitsConfirmed;

    constructor(
        DrippVault vault_,
        DividendOracle oracle_,
        MockStockToken stock_,
        address keeper_,
        address disputer_
    ) {
        vault = vault_;
        oracle = oracle_;
        stock = stock_;
        pt = vault_.pt();
        yt = vault_.yt();
        keeper = keeper_;
        disputer = disputer_;
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

    /// @dev Every share leaving the vault (to users, treasury or Stock Drip) counts as withdrawn.
    modifier track() {
        uint256 balBefore = stock.balanceOf(address(vault));
        _;
        uint256 balAfter = stock.balanceOf(address(vault));
        if (balAfter < balBefore) ghostWithdrawn += balBefore - balAfter;
        ghostOps++;
        uint256 idx = vault.pyIndexStored();
        if (idx < ghostLastIndex) ghostIndexDecreased = true;
        ghostLastIndex = idx;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    // ---------------- users ----------------

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
        address a = _actor(actorSeed);
        uint256 max = pt.balanceOf(a) < yt.balanceOf(a) ? pt.balanceOf(a) : yt.balanceOf(a);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(a);
        vault.merge(amount, a);
    }

    function redeemPT(uint256 actorSeed, uint256 amount) external track {
        if (!vault.isMatured()) return;
        address a = _actor(actorSeed);
        uint256 bal = pt.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(a);
        vault.redeemPT(amount, a);
    }

    function claimYield(uint256 actorSeed) external track {
        address a = _actor(actorSeed);
        vm.prank(a);
        vault.claimYield(a);
    }

    function transferYT(uint256 fromSeed, uint256 toSeed, uint256 amount) external track {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 bal = yt.balanceOf(from);
        if (bal == 0) return;
        amount = bound(amount, 0, bal);
        vm.prank(from);
        assertTrue(yt.transfer(to, amount));
    }

    function transferPT(uint256 fromSeed, uint256 toSeed, uint256 amount) external track {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 bal = pt.balanceOf(from);
        if (bal == 0) return;
        amount = bound(amount, 0, bal);
        vm.prank(from);
        assertTrue(pt.transfer(to, amount));
    }

    // ---------------- stock token ----------------

    /// @dev Live multiplier moves up or down (dividends, splits, reverse splits).
    function changeMultiplier(uint256 bps, bool up) external track {
        uint256 m = stock.uiMultiplier();
        bps = bound(bps, 0, 5_000); // up to +/-50% per step
        uint256 next = up ? m + m * bps / 10_000 : m - m * bps / 10_000;
        if (next < MIN_MULT) next = MIN_MULT;
        if (next > MAX_MULT) next = MAX_MULT;
        _moveLiveMultiplier(next);
    }

    /// @dev A raw multiplier move (split or not-yet-confirmed dividend) must never change YT claims.
    function _moveLiveMultiplier(uint256 next) internal {
        vault.updateIndex();
        uint256 owedBefore = _ytOwed();
        stock.setMultiplierNow(next);
        vault.updateIndex();
        if (_ytOwed() != owedBefore) ghostSplitAccrued = true;
    }

    function scheduleMultiplier(uint256 bps, uint256 delay) external track {
        uint256 m = stock.uiMultiplier();
        bps = bound(bps, 0, 2_000);
        delay = bound(delay, 1, 30 days);
        uint256 next = m + m * bps / 10_000;
        if (next > MAX_MULT) next = MAX_MULT;
        stock.setUIMultiplier(next, block.timestamp + delay);
    }

    // ---------------- oracle ----------------

    /// @dev kind 0 = dividend, 1 = pure split, 2 = mixed (split part `ratioBps` of 2x).
    function propose(uint256 kind, uint256 ratioBps) external track {
        (bool pending,) = oracle.pendingProposal(address(stock));
        uint256 live = stock.uiMultiplier();
        uint256 confirmed = oracle.confirmedMultiplier(address(stock));
        if (pending || live == confirmed) return;
        kind = bound(kind, 0, 2);
        vm.startPrank(keeper);
        if (kind == 1 || live < confirmed) {
            oracle.proposeSplit(address(stock));
        } else if (kind == 0) {
            oracle.proposeDividend(address(stock));
        } else {
            // split ratio between 1x and the full change, so the rest is a non-negative dividend
            uint256 full = live * 1e18 / confirmed;
            uint256 r = 1e18 + (full - 1e18) * bound(ratioBps, 0, 10_000) / 10_000;
            try oracle.propose(address(stock), r) {} catch {}
        }
        vm.stopPrank();
    }

    function dispute(uint256 secs) external track {
        (bool pending, uint256 id) = oracle.pendingProposal(address(stock));
        if (!pending) return;
        IDividendOracle.Proposal memory p = oracle.getProposal(address(stock), id);
        if (block.timestamp >= p.disputeEndsAt) return;
        vm.warp(block.timestamp + bound(secs, 0, p.disputeEndsAt - block.timestamp - 1));
        vm.prank(disputer);
        oracle.dispute(address(stock));
    }

    /// @dev Waits out the dispute window and confirms. For pure splits, checks YT gained nothing.
    function confirm() external track {
        (bool pending, uint256 id) = oracle.pendingProposal(address(stock));
        if (!pending) return;
        IDividendOracle.Proposal memory p = oracle.getProposal(address(stock), id);
        if (block.timestamp < p.disputeEndsAt) vm.warp(p.disputeEndsAt);

        bool pureSplit = p.dividendIndexAfter == oracle.dividendIndex(address(stock));
        vault.updateIndex();
        uint256 owedBefore = _ytOwed();
        uint256 indexBefore = vault.pyIndexStored();

        oracle.confirm(address(stock));

        if (pureSplit) {
            ghostSplitsConfirmed++;
            vault.updateIndex();
            if (_ytOwed() != owedBefore || vault.pyIndexStored() != indexBefore) ghostSplitAccrued = true;
        }
    }

    function warp(uint256 secs) external track {
        secs = bound(secs, 1, 60 days);
        vm.warp(block.timestamp + secs);
    }

    function poke() external track {
        vault.updateIndex();
    }

    function _ytOwed() internal view returns (uint256 owed) {
        for (uint256 i; i < actors.length; i++) {
            owed += vault.claimableYield(actors[i]);
        }
    }
}
