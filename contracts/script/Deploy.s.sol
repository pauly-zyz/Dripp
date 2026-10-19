// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVaultDeployer} from "../src/DrippVaultDeployer.sol";

/// @notice Deploys (or reuses) the factory, allowlists every stock token in the config, creates one
///         series per (stock token, maturity), then hands ownership to the final owner.
///
/// Usage:
///   DRIPP_CONFIG=config/<network>.json forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
///
/// Config (see config/example.json and contracts/README.md):
///   multisig       admin multisig. Used as timelock proposer/executor and as default guardian.
///   timelockDelay  seconds (default 48h). A TimelockController is deployed when owner is 0x0.
///   owner          final factory owner. 0x0 -> new timelock (needs multisig).
///   guardian       can pause vaults instantly. 0x0 -> multisig.
///   treasury       receives post-maturity yield (and later, fees).
///   factory        existing factory to reuse (broadcaster must own it), or 0x0 to deploy.
///   stockTokens[]  { ticker, address, depositCap (whole shares, 0 = no cap), maturities[] }
contract Deploy is Script {
    using stdJson for string;

    function run() external returns (DrippVaultFactory factory) {
        string memory path = vm.envOr("DRIPP_CONFIG", string("config/example.json"));
        string memory json = vm.readFile(path);

        address multisig = json.readAddress(".multisig");
        address owner = json.readAddress(".owner");
        address guardian = json.readAddress(".guardian");
        address treasury = json.readAddress(".treasury");
        address factoryAddr = json.readAddress(".factory");
        uint256 delay = vm.keyExistsJson(json, ".timelockDelay") ? json.readUint(".timelockDelay") : 2 days;

        if (owner == address(0) || guardian == address(0)) {
            require(multisig != address(0), "config: isi `multisig` (atau `owner` dan `guardian`)");
        }
        if (guardian == address(0)) guardian = multisig;

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();

        if (factoryAddr == address(0)) {
            require(treasury != address(0), "config: isi `treasury`");
            // Broadcaster owns the factory during setup, then hands it over below.
            factory = new DrippVaultFactory(broadcaster, treasury, guardian, new DrippVaultDeployer());
            console2.log("DrippVaultFactory deployed:", address(factory));
        } else {
            factory = DrippVaultFactory(factoryAddr);
            console2.log("Using DrippVaultFactory:", factoryAddr);
        }

        for (uint256 i;; i++) {
            string memory key = string.concat(".stockTokens[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, key)) break;
            _setupStockToken(factory, json, key);
        }

        if (owner == address(0)) {
            address[] memory admins = new address[](1);
            admins[0] = multisig;
            TimelockController timelock = new TimelockController(delay, admins, admins, address(0));
            owner = address(timelock);
            console2.log("TimelockController deployed:", owner);
        }
        if (factory.owner() != owner) factory.transferOwnership(owner);
        console2.log("Factory owner:", owner);
        console2.log("Guardian:", factory.guardian());

        vm.stopBroadcast();
    }

    function _setupStockToken(DrippVaultFactory factory, string memory json, string memory key) internal {
        string memory ticker = json.readString(string.concat(key, ".ticker"));
        address token = json.readAddress(string.concat(key, ".address"));
        require(token != address(0), string.concat("config: isi alamat Stock Token untuk ", ticker));

        if (!factory.isStockTokenAllowed(token)) factory.allowStockToken(token, ticker);

        uint256 capShares = json.readUint(string.concat(key, ".depositCap"));
        uint256 cap = capShares == 0 ? factory.UNCAPPED() : capShares * 10 ** IERC20Metadata(token).decimals();

        uint256[] memory maturities = json.readUintArray(string.concat(key, ".maturities"));
        for (uint256 j; j < maturities.length; j++) {
            address vault = factory.getVault(token, maturities[j]);
            if (vault == address(0)) vault = factory.createVault(token, maturities[j], cap);
            console2.log(ticker, maturities[j], vault);
        }
    }
}
