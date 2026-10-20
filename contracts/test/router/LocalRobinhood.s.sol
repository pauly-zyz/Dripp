// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {INonfungiblePositionManagerT} from "./IUniswapV3Test.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {WETH9} from "../mocks/WETH9.sol";

/// @notice Stand-in for Robinhood Chain on a local anvil (chain id 4663) to dry-run the fork test when the
///         real RPC is unreachable. Deploys WETH, USDG (6 dec), an ERC-8056 stock and canonical Uniswap v3
///         with WETH/USDG and USDG/stock pools only (so the fork test must route through USDG), then
///         writes cache/local-robinhood.json in the config/robinhood-mainnet.json format.
///
///   anvil --chain-id 4663 &
///   forge script test/router/LocalRobinhood.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
///   ROBINHOOD_RPC_URL=http://127.0.0.1:8545 FORK_CONFIG=cache/local-robinhood.json \
///     forge test --match-contract Fork
contract LocalRobinhood is Script {
    uint24 constant FEE = 3000;

    function run() external {
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        WETH9 weth = new WETH9();
        MockERC20 usdg = new MockERC20("Global Dollar", "USDG", 6);
        MockStockToken stock = new MockStockToken("Apple", "AAPL");
        address factory = _deploy("UniswapV3Factory", "");
        address npm = _deploy("NonfungiblePositionManager", abi.encode(factory, address(weth), address(0)));
        address router = _deploy("SwapRouter02", abi.encode(address(0), factory, npm, address(weth)));
        address quoter = _deploy("QuoterV2", abi.encode(factory, address(weth)));

        weth.deposit{value: 100 ether}();
        usdg.mint(me, 600_000e6);
        stock.mint(me, 1_000e18);
        _pool(INonfungiblePositionManagerT(npm), me, address(weth), 100 ether, address(usdg), 300_000e6);
        _pool(INonfungiblePositionManagerT(npm), me, address(usdg), 300_000e6, address(stock), 1_000e18);
        vm.stopBroadcast();

        string memory json = string.concat(
            '{"uniswap":{"swapRouter":"',
            vm.toString(router),
            '","legacyRouter":false,"weth":"',
            vm.toString(address(weth)),
            '","usdg":"',
            vm.toString(address(usdg)),
            '","v3Factory":"',
            vm.toString(factory),
            '","positionManager":"',
            vm.toString(npm),
            '","quoterV2":"',
            vm.toString(quoter),
            '"},"stockTokens":[{"ticker":"AAPL","address":"',
            vm.toString(address(stock)),
            '"}]}'
        );
        vm.writeFile("cache/local-robinhood.json", json);
    }

    function _pool(
        INonfungiblePositionManagerT npm,
        address me,
        address a,
        uint256 amtA,
        address b,
        uint256 amtB
    ) internal {
        (address t0, address t1, uint256 a0, uint256 a1) = a < b ? (a, b, amtA, amtB) : (b, a, amtB, amtA);
        npm.createAndInitializePoolIfNecessary(t0, t1, FEE, uint160(Math.sqrt(Math.mulDiv(a1, 1 << 192, a0))));
        IERC20(t0).approve(address(npm), a0);
        IERC20(t1).approve(address(npm), a1);
        npm.mint(
            INonfungiblePositionManagerT.MintParams(
                t0, t1, FEE, -887220, 887220, a0, a1, 0, 0, me, block.timestamp + 1 hours
            )
        );
    }

    function _deploy(string memory name, bytes memory args) internal returns (address a) {
        bytes memory code = bytes.concat(
            vm.parseBytes(vm.readFile(string.concat("test/fixtures/uniswap/", name, ".hex"))), args
        );
        assembly {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0), name);
    }
}
