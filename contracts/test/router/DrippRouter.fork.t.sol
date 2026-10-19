// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZapScenario} from "./ZapScenario.sol";
import {IUniswapV3FactoryT, IUniswapV3PoolT, INonfungiblePositionManagerT} from "./IUniswapV3Test.sol";
import {IScaledUIAmount} from "../../src/interfaces/IScaledUIAmount.sol";
import {IWETH9} from "../../src/interfaces/IUniswapV3.sol";

interface ISwapRouter02ExactOutput {
    struct ExactOutputParams {
        bytes path;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactOutput(ExactOutputParams calldata params) external payable returns (uint256 amountIn);
}

/// @notice Zap scenario on a Robinhood Chain mainnet fork: real Uniswap v3 (SwapRouter02), WETH, USDG and
///         a real Stock Token. Skipped unless ROBINHOOD_RPC_URL is set.
///
///   ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork -vvv
///
/// Optional: ROBINHOOD_FORK_BLOCK (pin a block), FORK_STOCK_INDEX (stockTokens[i] in the config, default 0),
/// FORK_CONFIG (config file, default config/robinhood-mainnet.json; see test/router/LocalRobinhood.s.sol).
contract DrippRouterForkTest is ZapScenario {
    using stdJson for string;

    uint24[4] internal FEES = [uint24(500), 3000, 10000, 100];

    IUniswapV3FactoryT internal uniFactory;
    // route WETH -> stock: tokens[0..n], fees[0..n-1]
    address[] internal routeTokens;
    uint24[] internal routeFees;

    function _setUpChain() internal override returns (bool) {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return false;
        uint256 blockNo = vm.envOr("ROBINHOOD_FORK_BLOCK", uint256(0));
        if (blockNo == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNo);
        assertEq(block.chainid, 4663, "not Robinhood Chain mainnet");

        string memory json = vm.readFile(vm.envOr("FORK_CONFIG", string("config/robinhood-mainnet.json")));
        swapRouter = json.readAddress(".uniswap.swapRouter");
        legacyRouter = json.readBool(".uniswap.legacyRouter");
        weth = json.readAddress(".uniswap.weth");
        usdg = json.readAddress(".uniswap.usdg");
        uniFactory = IUniswapV3FactoryT(json.readAddress(".uniswap.v3Factory"));
        npm = INonfungiblePositionManagerT(json.readAddress(".uniswap.positionManager"));
        uint256 i = vm.envOr("FORK_STOCK_INDEX", uint256(0));
        stock = json.readAddress(string.concat(".stockTokens[", vm.toString(i), "].address"));

        assertGt(swapRouter.code.length, 0, "SwapRouter02 has no code");
        assertGt(stock.code.length, 0, "stock token has no code");
        assertGt(IScaledUIAmount(stock).uiMultiplier(), 0, "stock token has no uiMultiplier");
        _findRoute();
        return true;
    }

    /// @dev Direct WETH/stock pool if one has liquidity, else WETH -> USDG -> stock.
    function _findRoute() internal {
        (uint24 direct, bool ok) = _bestFee(weth, stock);
        if (ok) {
            routeTokens = [weth, stock];
            routeFees = [direct];
            return;
        }
        (uint24 f1, bool ok1) = _bestFee(weth, usdg);
        (uint24 f2, bool ok2) = _bestFee(usdg, stock);
        require(ok1 && ok2, "no Uniswap v3 route WETH -> stock (direct or via USDG)");
        routeTokens = [weth, usdg, stock];
        routeFees = [f1, f2];
    }

    function _bestFee(address a, address b) internal view returns (uint24 fee, bool ok) {
        uint128 best;
        for (uint256 i; i < FEES.length; i++) {
            address pool = uniFactory.getPool(a, b, FEES[i]);
            if (pool == address(0)) continue;
            uint128 l = IUniswapV3PoolT(pool).liquidity();
            if (l > best) (best, fee, ok) = (l, FEES[i], true);
        }
    }

    function _pathToStock(address tokenIn) internal view override returns (bytes memory path) {
        uint256 start = tokenIn == weth ? 0 : 1;
        require(routeTokens[start] == tokenIn, "token not on route");
        path = abi.encodePacked(routeTokens[start]);
        for (uint256 i = start; i < routeFees.length; i++) {
            path = bytes.concat(path, abi.encodePacked(routeFees[i], routeTokens[i + 1]));
        }
    }

    /// @dev Reverse path (tokenOut first) from WETH to `tokenOut` on the route, for exactOutput.
    function _reversePathFromWeth(address tokenOut) internal view returns (bytes memory path) {
        uint256 end;
        while (routeTokens[end] != tokenOut) end++;
        path = abi.encodePacked(routeTokens[end]);
        for (uint256 i = end; i > 0; i--) {
            path = bytes.concat(path, abi.encodePacked(routeFees[i - 1], routeTokens[i - 1]));
        }
    }

    function _buyWithEth(address token, address to, uint256 amount) internal {
        if (token == usdg && routeTokens.length == 2) {
            // direct route: still need a WETH/USDG pool for USDG
            (uint24 f, bool ok) = _bestFee(weth, usdg);
            require(ok, "no WETH/USDG pool");
            _exactOutput(abi.encodePacked(usdg, f, weth), to, amount);
        } else {
            _exactOutput(_reversePathFromWeth(token), to, amount);
        }
    }

    function _exactOutput(bytes memory path, address to, uint256 amount) internal {
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 10_000 ether);
        vm.startPrank(buyer);
        IWETH9(weth).deposit{value: 10_000 ether}();
        IERC20(weth).approve(swapRouter, type(uint256).max);
        ISwapRouter02ExactOutput(swapRouter)
            .exactOutput(
                ISwapRouter02ExactOutput.ExactOutputParams({
                    path: path, recipient: to, amountOut: amount, amountInMaximum: 10_000 ether
                })
            );
        vm.stopPrank();
    }

    function _getStock(address to, uint256 amount) internal override {
        _buyWithEth(stock, to, amount);
        assertGe(IERC20(stock).balanceOf(to), amount);
    }

    function _getUsdg(address to, uint256 amount) internal override {
        _buyWithEth(usdg, to, amount);
    }

    function _lpStock() internal pure override returns (uint256) {
        return 4e18;
    }

    function _ethIn() internal pure override returns (uint256) {
        return 0.01 ether;
    }

    function _usdgIn() internal pure override returns (uint256) {
        return 20e6;
    }

    function _setMultiplier(uint256 m) internal override {
        vm.mockCall(stock, abi.encodeWithSelector(IScaledUIAmount.uiMultiplier.selector), abi.encode(m));
    }
}
