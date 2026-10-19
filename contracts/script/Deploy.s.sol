// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DrippVaultFactory} from "../src/DrippVaultFactory.sol";
import {DrippVaultDeployer} from "../src/DrippVaultDeployer.sol";
import {DividendOracle} from "../src/DividendOracle.sol";
import {DrippRouter} from "../src/DrippRouter.sol";
import {IWETH9} from "../src/interfaces/IUniswapV3.sol";

/// @notice Deploys (or reuses) DividendOracle + DrippVaultFactory, registers and allowlists every stock
///         token in the config, creates one series per (stock token, maturity), deploys DrippRouter, then
///         hands admin rights to the final owner (a 48h timelock for the multisig by default).
///
/// Usage:
///   DRIPP_CONFIG=config/<network>.json forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
///
/// Config fields are documented in contracts/README.md (see config/example.json).
contract Deploy is Script {
    using stdJson for string;

    struct Config {
        address multisig;
        address keeper;
        address owner;
        address guardian;
        address treasury;
        address stockDrip;
        address factory;
        address oracle;
        uint256 timelockDelay;
        address swapRouter;
        bool legacyRouter;
        address weth;
        address usdg;
        address v3Factory;
    }

    struct Deployment {
        DividendOracle oracle;
        DrippVaultFactory factory;
        DrippRouter router;
        address owner;
    }

    function run() external returns (Deployment memory) {
        string memory out = vm.envOr("DRIPP_DEPLOYMENT_OUT", string(""));
        if (bytes(out).length == 0) out = string.concat("deployments/", vm.toString(block.chainid), ".json");
        return runWith(vm.envOr("DRIPP_CONFIG", string("config/example.json")), out);
    }

    /// @param configPath config file to read; @param outPath where to write the deployment file.
    function runWith(string memory configPath, string memory outPath) public returns (Deployment memory d) {
        string memory json = vm.readFile(configPath);
        Config memory c = _readConfig(json);

        uint256 startBlock = block.number;
        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();

        d.oracle = c.oracle == address(0) ? new DividendOracle(broadcaster) : DividendOracle(c.oracle);
        if (c.oracle == address(0)) {
            d.oracle.grantRole(d.oracle.PROPOSER_ROLE(), c.keeper);
            d.oracle.grantRole(d.oracle.PROPOSER_ROLE(), c.multisig);
            d.oracle.grantRole(d.oracle.DISPUTER_ROLE(), c.multisig);
            console2.log("DividendOracle deployed:", address(d.oracle));
        }

        if (c.factory == address(0)) {
            require(c.treasury != address(0), "config: isi `treasury`");
            // Broadcaster owns the factory during setup, then hands it over below.
            d.factory = new DrippVaultFactory(
                broadcaster, c.treasury, c.guardian, new DrippVaultDeployer(), d.oracle
            );
            console2.log("DrippVaultFactory deployed:", address(d.factory));
        } else {
            d.factory = DrippVaultFactory(c.factory);
        }
        if (c.stockDrip != d.factory.stockDrip()) d.factory.setStockDrip(c.stockDrip);

        for (uint256 i;; i++) {
            string memory key = string.concat(".stockTokens[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, key)) break;
            _setupStockToken(d, json, key);
        }

        if (c.swapRouter != address(0)) {
            d.router = new DrippRouter(d.factory, c.swapRouter, c.legacyRouter, IWETH9(c.weth), c.usdg);
            console2.log("DrippRouter deployed:", address(d.router));
        }

        d.owner = c.owner;
        if (d.owner == address(0)) {
            address[] memory admins = new address[](1);
            admins[0] = c.multisig;
            d.owner = address(new TimelockController(c.timelockDelay, admins, admins, address(0)));
            console2.log("TimelockController deployed:", d.owner);
        }
        if (d.factory.owner() != d.owner) d.factory.transferOwnership(d.owner);
        bytes32 adminRole = d.oracle.DEFAULT_ADMIN_ROLE();
        if (d.oracle.hasRole(adminRole, broadcaster) && broadcaster != d.owner) {
            d.oracle.grantRole(adminRole, d.owner);
            d.oracle.renounceRole(adminRole, broadcaster);
        }
        console2.log("Owner / oracle admin:", d.owner);

        vm.stopBroadcast();
        _writeDeployment(d, c, json, startBlock, outPath);
    }

    /// @dev deployments/<chainId>.json: addresses + start block for the indexer, backend and keeper.
    function _writeDeployment(
        Deployment memory d,
        Config memory c,
        string memory json,
        uint256 startBlock,
        string memory path
    ) internal {
        string memory tokens = "[";
        for (uint256 i;; i++) {
            string memory key = string.concat(".stockTokens[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, key)) break;
            string memory feedKey = string.concat(key, ".feed");
            address feed = vm.keyExistsJson(json, feedKey) ? json.readAddress(feedKey) : address(0);
            tokens = string.concat(
                tokens,
                i == 0 ? "" : ",",
                '{"ticker":"',
                json.readString(string.concat(key, ".ticker")),
                '","address":"',
                vm.toString(json.readAddress(string.concat(key, ".address"))),
                '","feed":"',
                vm.toString(feed),
                '"}'
            );
        }
        string memory out = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"startBlock":',
            vm.toString(startBlock),
            ',"factory":"',
            vm.toString(address(d.factory)),
            '","oracle":"',
            vm.toString(address(d.oracle)),
            '","router":"',
            vm.toString(address(d.router)),
            '","owner":"',
            vm.toString(d.owner)
        );
        out = string.concat(
            out,
            '","uniswap":{"v3Factory":"',
            vm.toString(c.v3Factory),
            '","swapRouter":"',
            vm.toString(c.swapRouter),
            '","weth":"',
            vm.toString(c.weth),
            '","usdg":"',
            vm.toString(c.usdg),
            '"},"stockTokens":',
            tokens,
            "]}"
        );
        vm.writeFile(path, out);
        console2.log("Deployment written to", path);
    }

    function _readConfig(string memory json) internal view returns (Config memory c) {
        c.multisig = json.readAddress(".multisig");
        c.keeper = json.readAddress(".keeper");
        c.owner = json.readAddress(".owner");
        c.guardian = json.readAddress(".guardian");
        c.treasury = json.readAddress(".treasury");
        c.stockDrip = json.readAddress(".stockDrip");
        c.factory = json.readAddress(".factory");
        c.oracle = json.readAddress(".oracle");
        c.timelockDelay = vm.keyExistsJson(json, ".timelockDelay") ? json.readUint(".timelockDelay") : 2 days;
        c.swapRouter = json.readAddress(".uniswap.swapRouter");
        c.legacyRouter = json.readBool(".uniswap.legacyRouter");
        c.weth = json.readAddress(".uniswap.weth");
        c.usdg = json.readAddress(".uniswap.usdg");
        c.v3Factory = vm.keyExistsJson(json, ".uniswap.v3Factory")
            ? json.readAddress(".uniswap.v3Factory")
            : address(0);

        require(c.multisig != address(0), "config: isi `multisig`");
        require(c.keeper != address(0), "config: isi `keeper`");
        if (c.guardian == address(0)) c.guardian = c.multisig;
    }

    function _setupStockToken(Deployment memory d, string memory json, string memory key) internal {
        string memory ticker = json.readString(string.concat(key, ".ticker"));
        address token = json.readAddress(string.concat(key, ".address"));
        require(token != address(0), string.concat("config: isi alamat Stock Token untuk ", ticker));

        if (!d.oracle.isRegistered(token)) d.oracle.registerToken(token);
        if (!d.factory.isStockTokenAllowed(token)) d.factory.allowStockToken(token, ticker);

        uint256 capShares = json.readUint(string.concat(key, ".depositCap"));
        uint256 cap =
            capShares == 0 ? d.factory.UNCAPPED() : capShares * 10 ** IERC20Metadata(token).decimals();

        uint256[] memory maturities = json.readUintArray(string.concat(key, ".maturities"));
        for (uint256 j; j < maturities.length; j++) {
            address vault = d.factory.getVault(token, maturities[j]);
            if (vault == address(0)) vault = d.factory.createVault(token, maturities[j], cap);
            console2.log(ticker, maturities[j], vault);
        }
    }
}
