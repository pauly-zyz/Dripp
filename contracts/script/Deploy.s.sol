// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";

/// @notice Deploys (or reuses) the factory, allowlists every stock token in the config and
///         creates one vault per (stock token, maturity).
///
/// Usage:
///   DRIPP_CONFIG=config/<network>.json forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
///
/// Config: see config/example.json. Set "factory" to 0x0 to deploy a new one. The broadcaster
/// must be the factory owner for the allowlist step (owner defaults to the broadcaster if 0x0).
contract Deploy is Script {
    using stdJson for string;

    function run() external {
        string memory path = vm.envOr("DRIPP_CONFIG", string("config/example.json"));
        string memory json = vm.readFile(path);

        address owner = json.readAddress(".owner");
        address treasury = json.readAddress(".treasury");
        address factoryAddr = json.readAddress(".factory");

        vm.startBroadcast();
        if (owner == address(0)) owner = msg.sender;

        DrippVaultFactory factory;
        if (factoryAddr == address(0)) {
            require(treasury != address(0), "config: isi `treasury`");
            factory = new DrippVaultFactory(owner, treasury);
            console2.log("DrippVaultFactory deployed:", address(factory));
        } else {
            factory = DrippVaultFactory(factoryAddr);
            console2.log("Using DrippVaultFactory:", factoryAddr);
        }

        for (uint256 i;; i++) {
            string memory key = string.concat(".stockTokens[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, key)) break;

            string memory symbol = json.readString(string.concat(key, ".symbol"));
            address token = json.readAddress(string.concat(key, ".address"));
            require(token != address(0), string.concat("config: isi alamat Stock Token untuk ", symbol));

            if (!factory.isStockTokenAllowed(token)) factory.setStockTokenAllowed(token, true);

            uint256[] memory maturities = json.readUintArray(string.concat(key, ".maturities"));
            for (uint256 j; j < maturities.length; j++) {
                address vault = factory.getVault(token, maturities[j]);
                if (vault == address(0)) vault = factory.createVault(token, maturities[j]);
                console2.log(symbol, maturities[j], vault);
            }
        }
        vm.stopBroadcast();
    }
}
