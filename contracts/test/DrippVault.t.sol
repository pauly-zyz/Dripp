// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {IDrippVault} from "../src/interfaces/IDrippVault.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVault} from "../src/DrippVault.sol";
import {DrippToken} from "../src/tokens/DrippToken.sol";
import {IDividendOracle} from "../src/interfaces/IDividendOracle.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

contract DrippVaultTest is BaseTest {
    // ---------------- factory ----------------

    function test_factory_createsVaultWithTokens() public view {
        assertEq(factory.getVault(address(stock), maturity), address(vault));
        assertEq(factory.getVaultBySeries("TSLA-OCT26"), address(vault));
        assertTrue(factory.isVault(address(vault)));
        assertEq(factory.allVaultsLength(), 1);
        assertEq(pt.vault(), address(vault));
        assertEq(yt.vault(), address(vault));
        assertEq(pt.decimals(), 18);
        assertEq(vault.series(), "TSLA-OCT26");
        assertEq(pt.symbol(), "pTSLA-OCT26");
        assertEq(yt.symbol(), "yTSLA-OCT26");
        assertEq(pt.name(), "Dripp PT TSLA-OCT26");
        assertEq(vault.pyIndexStored(), 1e18);
        assertEq(vault.depositCap(), type(uint256).max);
    }

    function test_factory_emitsSeriesCreated() public {
        uint256 m = 1_806_019_200; // 2027-03-26
        vm.expectEmit(true, true, false, false);
        emit DrippVaultFactory.SeriesCreated(address(stock), m, address(0), address(0), address(0), "", 0);
        vm.prank(owner);
        DrippVault v = DrippVault(factory.createVault(address(stock), m, 5e18));
        assertEq(v.series(), "TSLA-MAR27");
        assertEq(v.depositCap(), 5e18);
    }

    function test_factory_rejectsDuplicate() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DrippVaultFactory.VaultExists.selector, address(vault)));
        factory.createVault(address(stock), maturity, 0);
    }

    function test_factory_rejectsDuplicateSeriesName() public {
        // Same stock, same month -> same "TSLA-OCT26" label.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DrippVaultFactory.VaultExists.selector, address(vault)));
        factory.createVault(address(stock), maturity + 1 days, 0);
    }

    function test_factory_rejectsNotAllowed() public {
        ERC20 other = new MockPlainToken();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(DrippVaultFactory.StockTokenNotAllowed.selector, address(other))
        );
        factory.createVault(address(other), maturity, 0);
    }

    function test_factory_rejectsNonERC8056() public {
        ERC20 other = new MockPlainToken();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DrippVaultFactory.NotERC8056.selector, address(other)));
        factory.allowStockToken(address(other), "X");
    }

    function test_factory_requiresOracleRegistration() public {
        MockStockToken other = new MockStockToken("Apple", "AAPLx");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DrippVaultFactory.NotInOracle.selector, address(other)));
        factory.allowStockToken(address(other), "AAPL");
    }

    function test_factory_rejectsPastMaturity() public {
        vm.prank(owner);
        vm.expectRevert(DrippVaultFactory.InvalidMaturity.selector);
        factory.createVault(address(stock), block.timestamp, 0);
    }

    function test_factory_onlyOwner() public {
        vm.expectRevert();
        factory.allowStockToken(address(stock), "TSLA");
        vm.expectRevert();
        factory.disallowStockToken(address(stock));
        vm.expectRevert();
        factory.createVault(address(stock), maturity + 60 days, 0);
        vm.expectRevert();
        factory.setDepositCap(address(vault), 0);
        vm.expectRevert();
        factory.unpauseVault(address(vault));
    }

    function test_factory_disallowStopsNewSeries() public {
        vm.startPrank(owner);
        factory.disallowStockToken(address(stock));
        vm.expectRevert(
            abi.encodeWithSelector(DrippVaultFactory.StockTokenNotAllowed.selector, address(stock))
        );
        factory.createVault(address(stock), maturity + 60 days, 0);
        vm.stopPrank();
        // existing series still works
        _split(alice, 1e18);
    }

    function test_vaultAdmin_onlyFactory() public {
        vm.expectRevert(IDrippVault.OnlyFactory.selector);
        vault.setDepositCap(0);
        vm.expectRevert(IDrippVault.OnlyFactory.selector);
        vault.pause();
    }

    // ---------------- deposit cap ----------------

    function test_depositCap_limitsOutstandingPrincipal() public {
        vm.prank(owner);
        factory.setDepositCap(address(vault), 100e18);
        _split(alice, 60e18);
        vm.prank(bob);
        vm.expectRevert(IDrippVault.DepositCapExceeded.selector);
        vault.split(41e18, bob);
        _split(bob, 40e18);
        // merging frees capacity again
        vm.prank(alice);
        vault.merge(10e18, alice);
        _split(bob, 10e18);
    }

    function test_depositCap_isInSharesNotRawTokens() public {
        vm.prank(owner);
        factory.setDepositCap(address(vault), 100e18);
        _dividend(2e18);
        vm.prank(alice);
        vm.expectRevert(IDrippVault.DepositCapExceeded.selector);
        vault.split(51e18, alice); // 102 shares
    }

    // ---------------- pause ----------------

    function test_pause_guardianPausesOwnerUnpauses() public {
        _split(alice, 10e18);
        vm.prank(guardian);
        factory.pauseVault(address(vault));

        vm.startPrank(alice);
        vm.expectRevert();
        vault.split(1e18, alice);
        vm.expectRevert();
        vault.merge(1e18, alice);
        vm.expectRevert();
        vault.claimYield(alice);
        vm.stopPrank();

        vm.prank(guardian);
        vm.expectRevert();
        factory.unpauseVault(address(vault));

        vm.prank(owner);
        factory.unpauseVault(address(vault));
        _split(alice, 1e18);
    }

    function test_pause_strangerCannotPause() public {
        vm.prank(alice);
        vm.expectRevert(DrippVaultFactory.NotGuardianOrOwner.selector);
        factory.pauseVault(address(vault));
    }

    function test_pause_ytTransfersStillCheckpoint() public {
        _split(alice, 100e18);
        _dividend(1.25e18);
        vm.prank(guardian);
        factory.pauseVault(address(vault));
        vm.prank(alice);
        assertTrue(yt.transfer(bob, 100e18));
        assertEq(vault.accruedYield(alice), 20e18);
        assertEq(vault.claimableYield(bob), 0);
    }

    // ---------------- split / merge ----------------

    function test_split_mintsPTandYTAtIndex() public {
        _dividend(1.5e18);
        uint256 out = _split(alice, 100e18);
        assertEq(out, 150e18);
        assertEq(pt.balanceOf(alice), 150e18);
        assertEq(yt.balanceOf(alice), 150e18);
        assertEq(stock.balanceOf(address(vault)), 100e18);
    }

    function test_merge_returnsPrincipal() public {
        _split(alice, 100e18);
        vm.prank(alice);
        uint256 back = vault.merge(100e18, alice);
        assertEq(back, 100e18);
        assertEq(pt.totalSupply(), 0);
        assertEq(yt.totalSupply(), 0);
        assertEq(stock.balanceOf(alice), 1_000e18);
    }

    function test_merge_afterGrowth_splitsValueBetweenPTandYT() public {
        _split(alice, 100e18); // 100 PT + 100 YT at index 1.0
        _dividend(1.25e18);

        vm.prank(alice);
        uint256 principal = vault.merge(100e18, alice);
        assertEq(principal, 80e18); // 100 UI units / 1.25

        vm.prank(alice);
        uint256 y = vault.claimYield(alice);
        assertEq(y, 20e18); // 100 - 80
        assertEq(stock.balanceOf(address(vault)), 0);
    }

    function test_split_revertsAfterMaturity() public {
        vm.warp(maturity);
        vm.prank(alice);
        vm.expectRevert(IDrippVault.Matured.selector);
        vault.split(1e18, alice);
    }

    function test_merge_afterMaturity_paysLikeRedeem() public {
        _split(alice, 100e18);
        _dividend(1.25e18);
        vm.warp(maturity);
        vault.updateIndex(); // freeze at 1.25
        _dividend(2e18); // post-maturity growth -> treasury

        vm.prank(alice);
        uint256 back = vault.merge(100e18, alice);
        assertEq(back, 50e18); // 100 shares at 2.0
        assertEq(stock.balanceOf(treasury), 30e18); // 80 (backing at maturity) - 50
        assertEq(pt.balanceOf(alice), 0);
        assertEq(yt.balanceOf(alice), 0);
        // pre-maturity yield is still claimable after YT is burned
        vm.prank(alice);
        assertEq(vault.claimYield(alice), 20e18);
        assertEq(stock.balanceOf(address(vault)), 0);
    }

    function test_merge_requiresBothTokens() public {
        _split(alice, 10e18);
        vm.prank(alice);
        yt.transfer(bob, 1e18);
        vm.prank(alice);
        vm.expectRevert();
        vault.merge(10e18, alice);
    }

    function test_onlyVaultMintsAndBurns() public {
        vm.expectRevert(DrippToken.OnlyVault.selector);
        pt.mint(alice, 1);
        vm.expectRevert(DrippToken.OnlyVault.selector);
        yt.burn(alice, 1);
        vm.expectRevert(IDrippVault.OnlyYT.selector);
        vault.onYTBalanceChange(alice, bob);
    }

    // ---------------- YT accrual / high-water mark ----------------

    function test_yt_accruesFromMultiplierGrowth() public {
        _split(alice, 100e18);
        _dividend(2e18);
        // 100 UI units: 100/1 - 100/2 = 50 shares
        assertEq(vault.claimableYield(alice), 50e18);
        vm.prank(alice);
        assertEq(vault.claimYield(alice), 50e18);
        assertEq(vault.claimableYield(alice), 0);
    }

    function test_yt_scheduledMultiplierCountsOnceEffectiveAndConfirmed() public {
        _split(alice, 100e18);
        stock.setUIMultiplier(1.1e18, block.timestamp + 1 days);
        vm.prank(keeper);
        vm.expectRevert(IDividendOracle.MultiplierUnchanged.selector);
        oracle.proposeDividend(address(stock)); // not effective yet
        vm.warp(block.timestamp + 1 days);
        vm.prank(keeper);
        oracle.proposeDividend(address(stock));
        assertEq(vault.claimableYield(alice), 0); // still in dispute window
        vm.warp(block.timestamp + 1 days);
        oracle.confirm(address(stock));
        assertApproxEqAbs(vault.claimableYield(alice), 100e18 - uint256(100e18 * 1e18) / 1.1e18, 1);
    }

    function test_yt_unconfirmedGrowthDoesNotAccrue() public {
        _split(alice, 100e18);
        stock.setMultiplierNow(2e18);
        assertEq(vault.claimableYield(alice), 0);
        vault.updateIndex();
        assertEq(vault.pyIndexStored(), 1e18);
    }

    function test_yt_disputedProposalDoesNotAccrue() public {
        _split(alice, 100e18);
        stock.setMultiplierNow(2e18); // really a 2-for-1 split
        vm.prank(keeper);
        oracle.proposeDividend(address(stock)); // keeper misclassifies
        vm.prank(guardian);
        oracle.dispute(address(stock));
        vm.prank(keeper);
        oracle.proposeSplit(address(stock));
        vm.warp(block.timestamp + 1 days);
        oracle.confirm(address(stock));
        assertEq(vault.claimableYield(alice), 0);
        assertEq(vault.sharesPerPT(), 2e18);
    }

    // ---------------- stock splits ----------------

    function test_split_doesNotAccrueToYT() public {
        _split(alice, 100e18);
        _stockSplit(2e18); // 2-for-1
        assertEq(vault.claimableYield(alice), 0);
        assertEq(vault.currentIndex(), 1e18);
        // Each PT is now worth 2 shares; principal is unchanged in raw tokens.
        assertEq(vault.sharesPerPT(), 2e18);
        assertEq(vault.previewMerge(100e18), 100e18);
    }

    function test_split_thenDividend_accruesOnlyDividend() public {
        _split(alice, 100e18);
        _stockSplit(2e18);
        _dividend(2.2e18); // +10% dividend after the split
        // index 1.0 -> 1.1: 100 - 100/1.1 raw tokens
        assertApproxEqAbs(vault.claimableYield(alice), 100e18 - uint256(100e18 * 1e18) / 1.1e18, 1);
        assertEq(vault.currentIndex(), 1.1e18);
    }

    function test_reverseSplit_keepsIndex() public {
        _split(alice, 100e18);
        _dividend(1.2e18);
        uint256 atPeak = vault.claimableYield(alice);
        _stockSplit(0.6e18); // 1-for-2 reverse split
        assertEq(vault.currentIndex(), 1.2e18);
        assertEq(vault.claimableYield(alice), atPeak);
        assertEq(vault.sharesPerPT(), 0.5e18);
    }

    function test_mixedProposal_separatesSplitFromDividend() public {
        _split(alice, 100e18);
        stock.setMultiplierNow(2.2e18); // 2-for-1 split plus 10% dividend at once
        vm.prank(keeper);
        oracle.propose(address(stock), 2e18);
        vm.warp(block.timestamp + 1 days);
        oracle.confirm(address(stock));
        assertEq(vault.currentIndex(), 1.1e18);
        assertEq(oracle.splitFactor(address(stock)), 2e18);
    }

    function test_vaultCreatedAfterSplit_startsAtLiveMultiplier() public {
        _stockSplit(3e18);
        vm.prank(owner);
        DrippVault v = DrippVault(factory.createVault(address(stock), maturity + 60 days, type(uint256).max));
        assertEq(v.currentIndex(), 3e18);
        assertEq(v.previewSplit(1e18), 3e18); // 1 raw token = 3 shares = 3 PT + 3 YT
        assertEq(v.sharesPerPT(), 1e18);
    }

    // ---------------- maturity index from oracle history ----------------

    function test_maturityIndex_usesOracleValueAtMaturity_evenIfPokedLate() public {
        _split(alice, 100e18);
        _dividend(1.25e18);
        vm.warp(maturity + 10 days); // nobody touched the vault at maturity
        _dividend(2.5e18); // confirmed after maturity
        assertEq(vault.ytIndex(), 1.25e18);
        assertEq(vault.claimableYield(alice), 20e18);
        vault.updateIndex();
        assertEq(vault.indexAtMaturity(), 1.25e18);
        assertEq(vault.pyIndexStored(), 2.5e18);
    }

    // ---------------- YT fee ----------------

    function test_ytFee_5pct_split60StockDrip40Treasury() public {
        vm.prank(owner);
        factory.setFees(500, 10, 6_000);
        _split(alice, 100e18);
        _dividend(1.25e18); // 20 raw tokens of yield
        vm.prank(alice);
        uint256 net = vault.claimYield(alice);
        assertEq(net, 19e18);
        assertEq(stock.balanceOf(stockDrip), 0.6e18);
        assertEq(stock.balanceOf(treasury), 0.4e18);
    }

    function test_ytFee_noStockDrip_allToTreasury() public {
        vm.startPrank(owner);
        factory.setFees(500, 10, 6_000);
        factory.setStockDrip(address(0));
        vm.stopPrank();
        _split(alice, 100e18);
        _dividend(1.25e18);
        vm.prank(alice);
        vault.claimYield(alice);
        assertEq(stock.balanceOf(treasury), 1e18);
    }

    function test_noFeeOnSplitMergeRedeem() public {
        vm.prank(owner);
        factory.setFees(500, 10, 6_000);
        _split(alice, 100e18);
        vm.prank(alice);
        assertEq(vault.merge(50e18, alice), 50e18);
        vm.warp(maturity);
        vm.prank(alice);
        assertEq(vault.redeemPT(50e18, alice), 50e18);
        assertEq(stock.balanceOf(treasury) + stock.balanceOf(stockDrip), 0);
    }

    function test_fees_capped() public {
        vm.startPrank(owner);
        vm.expectRevert(DrippVaultFactory.FeeTooHigh.selector);
        factory.setFees(1_001, 10, 6_000);
        vm.expectRevert(DrippVaultFactory.FeeTooHigh.selector);
        factory.setFees(500, 101, 6_000);
        vm.expectRevert(DrippVaultFactory.FeeTooHigh.selector);
        factory.setFees(500, 10, 10_001);
        vm.stopPrank();
        vm.expectRevert();
        factory.setFees(0, 0, 0);
    }

    function test_yt_newDepositorDoesNotGetPastYield() public {
        _split(alice, 100e18);
        _dividend(2e18);
        _split(bob, 100e18);
        assertEq(vault.claimableYield(bob), 0);
        assertEq(vault.claimableYield(alice), 50e18);
    }

    function test_yt_transferCheckpointsSender() public {
        _split(alice, 100e18);
        _dividend(2e18);

        vm.prank(alice);
        yt.transfer(bob, 100e18);

        // Yield earned before transfer stays with alice; bob starts at index 2.0.
        assertEq(vault.accruedYield(alice), 50e18);
        assertEq(vault.userIndex(bob), 2e18);
        assertEq(vault.claimableYield(bob), 0);

        _dividend(4e18);
        // bob: 100 UI * (1/2 - 1/4) = 25 shares
        assertEq(vault.claimableYield(bob), 25e18);
        assertEq(vault.claimableYield(alice), 50e18);
    }

    function test_yt_transferFromCheckpoints() public {
        _split(alice, 100e18);
        vm.prank(alice);
        yt.approve(bob, type(uint256).max);
        _dividend(1.25e18);
        vm.prank(bob);
        yt.transferFrom(alice, bob, 50e18);
        assertEq(vault.accruedYield(alice), 20e18);
        assertEq(vault.userIndex(bob), 1.25e18);
    }

    function test_pt_transferDoesNotAffectYield() public {
        _split(alice, 100e18);
        vm.prank(alice);
        pt.transfer(bob, 100e18);
        _dividend(2e18);
        assertEq(vault.claimableYield(alice), 50e18);
        assertEq(vault.claimableYield(bob), 0);
    }

    // ---------------- maturity ----------------

    function test_redeemPT_atMaturity() public {
        _split(alice, 100e18);
        _dividend(1.25e18);
        vm.warp(maturity);

        vm.prank(alice);
        uint256 out = vault.redeemPT(100e18, alice);
        assertEq(out, 80e18);
        vm.prank(alice);
        assertEq(vault.claimYield(alice), 20e18);
        assertEq(stock.balanceOf(address(vault)), 0);
    }

    function test_redeemPT_revertsBeforeMaturity() public {
        _split(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(IDrippVault.NotMatured.selector);
        vault.redeemPT(1e18, alice);
    }

    function test_yt_stopsAccruingAfterMaturity() public {
        _split(alice, 100e18);
        _dividend(1.25e18);
        vm.warp(maturity);
        vault.updateIndex(); // keeper freezes index at maturity
        assertEq(vault.indexAtMaturity(), 1.25e18);

        _dividend(2.5e18);
        assertEq(vault.claimableYield(alice), 20e18);

        // PT keeps its UI value: 100 UI / 2.5 = 40 shares; the other 40 go to treasury.
        vm.prank(alice);
        assertEq(vault.redeemPT(100e18, alice), 40e18);
        assertEq(stock.balanceOf(treasury), 40e18);
        vm.prank(alice);
        assertEq(vault.claimYield(alice), 20e18);
        assertEq(stock.balanceOf(address(vault)), 0);
    }

    function test_yt_transferAfterMaturityKeepsFrozenYield() public {
        _split(alice, 100e18);
        _dividend(2e18);
        vm.warp(maturity);
        vm.prank(alice);
        yt.transfer(bob, 100e18);
        _dividend(3e18);
        assertEq(vault.claimableYield(alice), 50e18);
        assertEq(vault.claimableYield(bob), 0);
    }

    // ---------------- fuzz ----------------

    function testFuzz_splitMergeRoundTrip(uint96 shares, uint64 mult) public {
        shares = uint96(bound(shares, 1, 1_000e18));
        mult = uint64(bound(mult, 1e15, 1e19));
        _moveIndex(mult);
        mult = uint64(vault.currentIndex());
        uint256 py = vault.previewSplit(shares);
        vm.assume(py > 0);
        _split(alice, shares);
        vm.prank(alice);
        uint256 back = vault.merge(py, alice);
        assertLe(back, shares);
        assertLe(shares - back, 1e18 / uint256(mult) + 1);
    }

    function testFuzz_ptPlusYtNeverExceedsDeposit(uint96 shares, uint64 m1, uint64 m2) public {
        shares = uint96(bound(shares, 1e6, 1_000e18));
        m1 = uint64(bound(m1, 1e17, 1e19));
        m2 = uint64(bound(m2, 1e17, 1e19));
        _moveIndex(m1);
        _split(alice, shares);
        _moveIndex(m2);
        vm.warp(maturity);
        uint256 bal = pt.balanceOf(alice);
        vm.startPrank(alice);
        uint256 a = vault.redeemPT(bal, alice);
        uint256 b = vault.claimYield(alice);
        vm.stopPrank();
        assertLe(a + b + stock.balanceOf(treasury), shares);
        assertLe(shares - (a + b + stock.balanceOf(treasury)), 2);
    }
}

contract MockPlainToken is ERC20 {
    constructor() ERC20("Plain", "PLN") {}
}
