// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVault} from "../src/DrippVault.sol";
import {PTToken} from "../src/tokens/PTToken.sol";
import {YTToken} from "../src/tokens/YTToken.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

abstract contract BaseTest is Test {
    DrippVaultFactory factory;
    DrippVault vault;
    PTToken pt;
    YTToken yt;
    MockStockToken stock;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 maturity;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        maturity = block.timestamp + 365 days;
        stock = new MockStockToken("Tesla xStock", "TSLAx");
        factory = new DrippVaultFactory(owner, treasury);
        vm.prank(owner);
        factory.setStockTokenAllowed(address(stock), true);
        vault = DrippVault(factory.createVault(address(stock), maturity));
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
}
