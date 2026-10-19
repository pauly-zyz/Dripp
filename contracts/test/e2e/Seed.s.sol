// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DrippVaultFactory} from "../../src/DrippVaultFactory.sol";
import {DrippVault} from "../../src/DrippVault.sol";
import {DrippRouter} from "../../src/DrippRouter.sol";
import {INonfungiblePositionManagerT} from "../router/IUniswapV3Test.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";

/// @notice Creates on-chain activity for the local end-to-end test (scripts/e2e-local.sh).
///         SEED_PHASE=1: LP seeds PT/YT pools, users split, zap and trade, the stock pays a 1% dividend
///                       (multiplier 1.0 -> 1.01) and announces a split for next week.
///         SEED_PHASE=2: (after the keeper confirmed the dividend) users claim yield and merge.
///         SEED_PHASE=3: (after the 2:1 split was confirmed) the stock announces a 1% dividend in 30 days.
/// Accounts are anvil's default keys 4..6 (LP, alice, bob).
contract Seed is Script {
    using stdJson for string;

    uint24 constant FEE = 3000;
    uint256 constant LP_KEY = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;
    uint256 constant ALICE_KEY = 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba;
    uint256 constant BOB_KEY = 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e;

    DrippVaultFactory factory;
    DrippRouter router;
    DrippVault vault;
    MockStockToken stock;
    address weth;
    address usdg;
    INonfungiblePositionManagerT npm;

    function run() external {
        string memory dep = vm.readFile(vm.envString("DRIPP_DEPLOYMENT"));
        string memory local = vm.readFile("cache/local-robinhood.json");
        factory = DrippVaultFactory(dep.readAddress(".factory"));
        router = DrippRouter(payable(dep.readAddress(".router")));
        stock = MockStockToken(dep.readAddress(".stockTokens[0].address"));
        weth = dep.readAddress(".uniswap.weth");
        usdg = dep.readAddress(".uniswap.usdg");
        npm = INonfungiblePositionManagerT(local.readAddress(".uniswap.positionManager"));
        vault = DrippVault(factory.allVaults(0));

        uint256 phase = vm.envUint("SEED_PHASE");
        if (phase == 1) phase1();
        else if (phase == 2) phase2();
        else phase3();
    }

    function phase1() internal {
        address lp = vm.addr(LP_KEY);
        address alice = vm.addr(ALICE_KEY);
        address bob = vm.addr(BOB_KEY);
        address pt = address(vault.pt());
        address yt = address(vault.yt());

        // LP: split and seed PT at 0.95, YT at 0.05 stock per share.
        vm.startBroadcast(LP_KEY);
        stock.mint(lp, 1_000e18);
        stock.approve(address(vault), type(uint256).max);
        uint256 py = vault.split(400e18, lp);
        _pool(lp, pt, py, Math.mulDiv(py, 95, 100));
        _pool(lp, yt, py, Math.mulDiv(py, 5, 100));
        vm.stopBroadcast();

        // Alice: zap 1 ETH -> PT (WETH -> USDG -> stock -> PT) and split 50 stock.
        vm.startBroadcast(ALICE_KEY);
        bytes memory path = abi.encodePacked(weth, FEE, usdg, FEE, address(stock), FEE, pt);
        router.zap{value: 1 ether}(
            DrippRouter.ZapParams({
                vault: address(vault),
                target: DrippRouter.Target.PT,
                tokenIn: address(0),
                amountIn: 1 ether,
                path: path,
                minOut: 1,
                receiver: alice,
                deadline: block.timestamp + 1 hours
            })
        );
        stock.mint(alice, 100e18);
        stock.approve(address(vault), type(uint256).max);
        vault.split(50e18, alice);
        require(vault.yt().transfer(bob, 10e18), "transfer");
        vm.stopBroadcast();

        // Bob: zap 0.5 ETH -> YT.
        vm.startBroadcast(BOB_KEY);
        router.zap{value: 0.5 ether}(
            DrippRouter.ZapParams({
                vault: address(vault),
                target: DrippRouter.Target.YT,
                tokenIn: address(0),
                amountIn: 0.5 ether,
                path: abi.encodePacked(weth, FEE, usdg, FEE, address(stock), FEE, yt),
                minOut: 1,
                receiver: bob,
                deadline: block.timestamp + 1 hours
            })
        );
        // Corporate actions on the (mock) stock token: a 1% dividend now, a 2:1 split announced for next week.
        stock.setMultiplierNow(1.01e18);
        stock.setUIMultiplier(2.02e18, block.timestamp + 7 days);
        vm.stopBroadcast();
        console2.log("phase 1 done, vault", address(vault));
    }

    function phase2() internal {
        address alice = vm.addr(ALICE_KEY);
        vm.startBroadcast(ALICE_KEY);
        vault.claimYield(alice);
        vault.merge(10e18, alice);
        vm.stopBroadcast();
        console2.log("phase 2 done");
    }

    function phase3() internal {
        vm.startBroadcast(BOB_KEY);
        stock.setUIMultiplier(stock.uiMultiplier() * 101 / 100, block.timestamp + 30 days);
        vm.stopBroadcast();
        console2.log("phase 3 done");
    }

    function _pool(address lp, address token, uint256 amountToken, uint256 amountStock) internal {
        (address t0, address t1, uint256 a0, uint256 a1) = token < address(stock)
            ? (token, address(stock), amountToken, amountStock)
            : (address(stock), token, amountStock, amountToken);
        npm.createAndInitializePoolIfNecessary(t0, t1, FEE, uint160(Math.sqrt(Math.mulDiv(a1, 1 << 192, a0))));
        IERC20(t0).approve(address(npm), a0);
        IERC20(t1).approve(address(npm), a1);
        npm.mint(
            INonfungiblePositionManagerT.MintParams(
                t0, t1, FEE, -887220, 887220, a0, a1, 0, 0, lp, block.timestamp + 1 hours
            )
        );
    }
}
