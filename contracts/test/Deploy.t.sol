// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVault} from "../src/DrippVault.sol";
import {DividendOracle} from "../src/DividendOracle.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

contract DeployScriptTest is Test {
    string constant PATH = "cache/deploy-test.json";

    address multisig = makeAddr("multisig");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address stockDrip = makeAddr("stockDrip");
    address swapRouter = makeAddr("swapRouter");
    MockStockToken aapl;

    /// The example config ships with placeholder addresses, so the script must refuse to run.
    function test_exampleConfigRequiresAddresses() public {
        Deploy d = new Deploy();
        vm.expectRevert(bytes("config: isi `multisig`"));
        d.runWith("config/example.json", "cache/unused.json");
    }

    function test_filledConfigDeploysEverything() public {
        vm.warp(1_790_000_000); // 2026-09
        aapl = new MockStockToken("Apple", "AAPLx");
        _writeConfig();
        Deploy.Deployment memory d = new Deploy().runWith(PATH, "cache/deploy-test-out.json");
        string memory out = vm.readFile("cache/deploy-test-out.json");
        assertEq(vm.parseJsonAddress(out, ".factory"), address(d.factory));
        assertEq(vm.parseJsonAddress(out, ".stockTokens[0].address"), address(aapl));
        vm.removeFile(PATH);
        _checkGovernance(d);
        _checkSeries(d);
    }

    function _writeConfig() internal {
        string memory json = string.concat(
            '{"multisig":"',
            vm.toString(multisig),
            '","keeper":"',
            vm.toString(keeper),
            '","timelockDelay":172800,"owner":"0x0000000000000000000000000000000000000000",',
            '"guardian":"0x0000000000000000000000000000000000000000","treasury":"',
            vm.toString(treasury),
            '","stockDrip":"',
            vm.toString(stockDrip),
            '","factory":"0x0000000000000000000000000000000000000000",',
            '"oracle":"0x0000000000000000000000000000000000000000",'
        );
        json = string.concat(
            json,
            '"uniswap":{"swapRouter":"',
            vm.toString(swapRouter),
            '","legacyRouter":false,"weth":"',
            vm.toString(makeAddr("weth")),
            '","usdg":"',
            vm.toString(makeAddr("usdg")),
            '"},"stockTokens":[{"ticker":"AAPL","address":"',
            vm.toString(address(aapl)),
            '","depositCap":1000,"maturities":[1806019200,1821916800]}]}'
        );
        vm.writeFile(PATH, json);
    }

    function _checkGovernance(Deploy.Deployment memory d) internal view {
        DrippVaultFactory factory = d.factory;
        DividendOracle oracle = d.oracle;

        // governance
        TimelockController timelock = TimelockController(payable(d.owner));
        assertEq(factory.owner(), d.owner);
        assertEq(timelock.getMinDelay(), 2 days);
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), multisig));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), multisig));
        assertTrue(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), d.owner));
        assertFalse(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), DEFAULT_SENDER));
        assertTrue(oracle.hasRole(oracle.PROPOSER_ROLE(), keeper));
        assertTrue(oracle.hasRole(oracle.DISPUTER_ROLE(), multisig));
        assertEq(factory.guardian(), multisig);

        // fees
        assertEq(factory.treasury(), treasury);
        assertEq(factory.stockDrip(), stockDrip);
        assertEq(factory.feeConfig().ytFeeBps, 500);
        assertEq(factory.feeConfig().zapFeeBps, 10);
        assertEq(factory.feeConfig().stockDripShareBps, 6_000);
    }

    function _checkSeries(Deploy.Deployment memory d) internal view {
        DrippVaultFactory factory = d.factory;
        DividendOracle oracle = d.oracle;
        assertTrue(oracle.isRegistered(address(aapl)));
        assertTrue(factory.isStockTokenAllowed(address(aapl)));
        assertEq(factory.allVaultsLength(), 2);
        DrippVault mar = DrippVault(factory.getVaultBySeries("AAPL-MAR27"));
        assertEq(address(mar), factory.getVault(address(aapl), 1_806_019_200));
        assertEq(mar.pt().symbol(), "pAAPL-MAR27");
        assertEq(mar.yt().symbol(), "yAAPL-MAR27");
        assertEq(mar.depositCap(), 1000e18);
        assertTrue(factory.getVaultBySeries("AAPL-SEP27") != address(0));

        // router
        assertEq(d.router.swapRouter(), swapRouter);
        assertEq(address(d.router.factory()), address(factory));
    }
}
