// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseTest} from "../Base.t.sol";
import {DrippVaultHandler} from "./DrippVaultHandler.sol";

/// @notice Core invariant: PT + YT = shares held by the vault.
///         Value of all outstanding PT (in raw shares) + all YT yield owed (in raw shares)
///         equals the stock-token balance of the vault, up to rounding dust that always
///         favours the vault.
contract DrippVaultInvariantTest is StdInvariant, BaseTest {
    DrippVaultHandler handler;

    function setUp() public override {
        super.setUp();
        handler = new DrippVaultHandler(vault, stock, treasury);
        targetContract(address(handler));
    }

    /// @dev Raw shares owed to PT holders (incl. the treasury's post-maturity cut).
    function _ptOwed() internal view returns (uint256) {
        uint256 idx = vault.indexAtMaturity();
        if (idx == 0) idx = vault.pyIndexStored();
        return Math.mulDiv(pt.totalSupply(), 1e18, idx);
    }

    /// @dev Raw shares owed to YT holders: checkpointed + not yet checkpointed.
    function _ytOwed() internal view returns (uint256 owed) {
        owed = vault.totalAccruedYield();
        uint256 n = handler.actorsLength();
        for (uint256 i; i < n; i++) {
            address a = handler.actors(i);
            owed += vault.claimableYield(a) - vault.accruedYield(a);
        }
    }

    /// @dev Pending yield must be computed against the stored index, not a view that peeks ahead.
    function _sync() internal {
        vault.updateIndex();
    }

    /// PT + YT = saham tersimpan (minus vault-favouring rounding dust).
    function invariant_ptPlusYtEqualsStoredShares() public {
        _sync();
        uint256 held = stock.balanceOf(address(vault));
        uint256 owed = _ptOwed() + _ytOwed();
        assertGe(held, owed, "vault insolvent: PT + YT > shares held");
        // each op can leave at most ~1e18/MIN_MULT + a few wei of dust
        uint256 maxDust = (handler.ghostOps() + 1) * (1e18 / handler.MIN_MULT() + 4);
        assertLe(held - owed, maxDust, "PT + YT drifted from shares held");
    }

    /// Every share that entered the vault is either still inside or was paid out.
    function invariant_shareConservation() public view {
        assertEq(
            stock.balanceOf(address(vault)),
            handler.ghostDeposited() - handler.ghostWithdrawn(),
            "share conservation broken"
        );
    }

    /// Before maturity PT and YT are always minted and burned together.
    function invariant_ptSupplyEqualsYtSupplyBeforeMaturity() public view {
        if (!vault.isMatured()) assertEq(pt.totalSupply(), yt.totalSupply());
        else assertLe(pt.totalSupply(), yt.totalSupply());
    }

    /// The accrual index is a high-water mark: it never goes down.
    function invariant_indexNeverDecreases() public view {
        assertFalse(handler.ghostIndexDecreased());
        assertGe(vault.pyIndexStored(), 1e18 > handler.MIN_MULT() ? handler.MIN_MULT() : 1e18);
    }

    /// totalAccruedYield is the exact sum of per-user checkpointed yield.
    function invariant_totalAccruedMatchesSum() public view {
        uint256 sum;
        uint256 n = handler.actorsLength();
        for (uint256 i; i < n; i++) {
            sum += vault.accruedYield(handler.actors(i));
        }
        assertEq(sum, vault.totalAccruedYield());
    }

    /// YT accrual stops at maturity: frozen index never exceeds the live high-water mark.
    function invariant_maturityIndexFrozen() public view {
        uint256 im = vault.indexAtMaturity();
        if (im != 0) assertLe(im, vault.pyIndexStored());
    }
}
