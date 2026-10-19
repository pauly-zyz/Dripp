// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVault} from "../src/DrippVault.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

contract DeployScriptTest is Test {
    string constant PATH = "cache/deploy-test.json";

    /// The example config ships with placeholder addresses, so the script must refuse to run.
    function test_exampleConfigRequiresAddresses() public {
        vm.setEnv("DRIPP_CONFIG", "config/example.json");
        Deploy d = new Deploy();
        vm.expectRevert(bytes("config: isi `multisig` (atau `owner` dan `guardian`)"));
        d.run();
    }

    function test_filledConfigDeploysSeriesAndTimelock() public {
        vm.warp(1_790_000_000); // 2026-09
        MockStockToken aapl = new MockStockToken("Apple", "AAPLx");
        address multisig = makeAddr("multisig");
        address treasury = makeAddr("treasury");

        string memory json = string.concat(
            '{"multisig":"',
            vm.toString(multisig),
            '","timelockDelay":172800,"owner":"0x0000000000000000000000000000000000000000",',
            '"guardian":"0x0000000000000000000000000000000000000000","treasury":"',
            vm.toString(treasury),
            '","factory":"0x0000000000000000000000000000000000000000","stockTokens":[{"ticker":"AAPL",',
            '"address":"',
            vm.toString(address(aapl)),
            '","depositCap":1000,"maturities":[1806019200,1821916800]}]}'
        );
        vm.writeFile(PATH, json);
        vm.setEnv("DRIPP_CONFIG", PATH);

        DrippVaultFactory factory = new Deploy().run();

        assertEq(factory.treasury(), treasury);
        assertEq(factory.guardian(), multisig);
        TimelockController timelock = TimelockController(payable(factory.owner()));
        assertEq(timelock.getMinDelay(), 2 days);
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), multisig));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), multisig));

        assertTrue(factory.isStockTokenAllowed(address(aapl)));
        assertEq(factory.allVaultsLength(), 2);
        DrippVault mar = DrippVault(factory.getVaultBySeries("AAPL-MAR27"));
        assertEq(address(mar), factory.getVault(address(aapl), 1_806_019_200));
        assertEq(mar.pt().symbol(), "pAAPL-MAR27");
        assertEq(mar.yt().symbol(), "yAAPL-MAR27");
        assertEq(mar.depositCap(), 1000e18);
        assertTrue(factory.getVaultBySeries("AAPL-SEP27") != address(0));
        vm.removeFile(PATH);
    }
}
