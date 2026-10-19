// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVaultDeployer} from "../src/DrippVaultDeployer.sol";
import {DrippVault} from "../src/DrippVault.sol";
import {DividendOracle} from "../src/DividendOracle.sol";
import {PTToken} from "../src/tokens/PTToken.sol";
import {YTToken} from "../src/tokens/YTToken.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

abstract contract BaseTest is Test {
    DrippVaultFactory factory;
    DividendOracle oracle;
    DrippVault vault;
    PTToken pt;
    YTToken yt;
    MockStockToken stock;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address guardian = makeAddr("guardian");
    address keeper = makeAddr("keeper");
    address stockDrip = makeAddr("stockDrip");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 maturity;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        maturity = block.timestamp + 365 days;
        stock = new MockStockToken("Tesla xStock", "TSLAx");

        oracle = new DividendOracle(owner);
        factory = new DrippVaultFactory(owner, treasury, guardian, new DrippVaultDeployer(), oracle);
        vm.startPrank(owner);
        oracle.grantRole(oracle.PROPOSER_ROLE(), keeper);
        oracle.grantRole(oracle.DISPUTER_ROLE(), guardian);
        oracle.registerToken(address(stock));
        factory.allowStockToken(address(stock), "TSLA");
        factory.setStockDrip(stockDrip);
        // Accrual-math tests run fee-free; fee tests switch fees on explicitly.
        factory.setFees(0, 0, 6_000);
        vault = DrippVault(factory.createVault(address(stock), maturity, factory.UNCAPPED()));
        vm.stopPrank();
        pt = vault.pt();
        yt = vault.yt();

        _fund(alice, 1_000e18);
        _fund(bob, 1_000e18);
    }

    function _fund(address who, uint256 amount) internal {
        stock.mint(who, amount);
        vm.prank(who);
        stock.approve(address(vault), type(uint256).max);
    }

    function _split(address who, uint256 shares) internal returns (uint256) {
        vm.prank(who);
        return vault.split(shares, who);
    }

    /// @dev Multiplier moves to `m`; keeper proposes it as a dividend; 24h pass; anyone confirms.
    function _dividend(uint256 m) internal {
        stock.setMultiplierNow(m);
        vm.prank(keeper);
        oracle.proposeDividend(address(stock));
        vm.warp(block.timestamp + oracle.DISPUTE_PERIOD());
        oracle.confirm(address(stock));
    }

    /// @dev Multiplier moves to `m` because of a stock split (or reverse split).
    function _stockSplit(uint256 m) internal {
        stock.setMultiplierNow(m);
        vm.prank(keeper);
        oracle.proposeSplit(address(stock));
        vm.warp(block.timestamp + oracle.DISPUTE_PERIOD());
        oracle.confirm(address(stock));
    }

    /// @dev Up = dividend, down = reverse split.
    function _moveIndex(uint256 m) internal {
        uint256 cur = oracle.confirmedMultiplier(address(stock));
        if (m > cur) _dividend(m);
        else if (m < cur) _stockSplit(m);
    }
}
