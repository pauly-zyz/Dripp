// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZapScenario} from "./ZapScenario.sol";
import {INonfungiblePositionManagerT} from "./IUniswapV3Test.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {WETH9} from "../mocks/WETH9.sol";

/// @notice Runs the zap scenario against the canonical Uniswap v3 bytecode (test/fixtures/uniswap)
///         with SwapRouter02, as on Robinhood Chain mainnet.
contract DrippRouterLocalTest is ZapScenario {
    address internal uniFactory;

    function _setUpChain() internal virtual override returns (bool) {
        vm.warp(1_790_000_000);
        weth = address(new WETH9());
        usdg = address(new MockERC20("Global Dollar", "USDG", 6));
        stock = address(new MockStockToken("Apple", "AAPL"));

        uniFactory = _deployFixture("UniswapV3Factory", "");
        npm = INonfungiblePositionManagerT(
            _deployFixture("NonfungiblePositionManager", abi.encode(uniFactory, weth, address(0)))
        );
        _deployRouter();

        // Market: 1 WETH = 10 stock, 1 stock = 300 USDG.
        address lp = makeAddr("baseLp");
        vm.deal(lp, 1_000 ether);
        vm.startPrank(lp);
        WETH9(payable(weth)).deposit{value: 1_000 ether}();
        MockStockToken(stock).mint(lp, 20_000e18);
        MockERC20(usdg).mint(lp, 3_000_000e6);
        _addFullRange(lp, weth, 1_000 ether, stock, 10_000e18);
        _addFullRange(lp, usdg, 3_000_000e6, stock, 10_000e18);
        vm.stopPrank();
        return true;
    }

    function _deployRouter() internal virtual {
        swapRouter = _deployFixture("SwapRouter02", abi.encode(address(0), uniFactory, address(npm), weth));
        legacyRouter = false;
    }

    function _getStock(address to, uint256 amount) internal override {
        MockStockToken(stock).mint(to, amount);
    }

    function _getUsdg(address to, uint256 amount) internal override {
        MockERC20(usdg).mint(to, amount);
    }

    function _pathToStock(address tokenIn) internal view override returns (bytes memory) {
        return abi.encodePacked(tokenIn, POOL_FEE, stock);
    }

    function _lpStock() internal pure override returns (uint256) {
        return 2_000e18;
    }

    function _ethIn() internal pure override returns (uint256) {
        return 1 ether;
    }

    function _usdgIn() internal pure override returns (uint256) {
        return 1_000e6;
    }

    function _setMultiplier(uint256 m) internal override {
        MockStockToken(stock).setMultiplierNow(m);
    }

    function _deployFixture(string memory name, bytes memory args) internal returns (address a) {
        bytes memory code = bytes.concat(
            vm.parseBytes(vm.readFile(string.concat("test/fixtures/uniswap/", name, ".hex"))), args
        );
        assembly {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0), string.concat("deploy failed: ", name));
    }
}

/// @notice Same scenario with the classic SwapRouter (deadline in params), as on Robinhood Chain testnet.
contract DrippRouterLocalLegacyRouterTest is DrippRouterLocalTest {
    function _deployRouter() internal override {
        swapRouter = _deployFixture("SwapRouter", abi.encode(uniFactory, weth));
        legacyRouter = true;
    }
}
