// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

contract DeployScriptTest is Test {
    /// The example config ships with placeholder addresses, so the script must refuse to run.
    function test_exampleConfigRequiresAddresses() public {
        vm.setEnv("DRIPP_CONFIG", "config/example.json");
        Deploy d = new Deploy();
        vm.expectRevert(bytes("config: isi `treasury`"));
        d.run();
    }
}
