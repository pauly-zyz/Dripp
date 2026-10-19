// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {DrippVaultFactory} from "../../src/DrippVaultFactory.sol";
import {DrippVaultDeployer} from "../../src/DrippVaultDeployer.sol";
import {DrippVault} from "../../src/DrippVault.sol";
import {DividendOracle} from "../../src/DividendOracle.sol";
import {DrippRouter} from "../../src/DrippRouter.sol";
import {IWETH9} from "../../src/interfaces/IUniswapV3.sol";
import {INonfungiblePositionManagerT} from "./IUniswapV3Test.sol";

/// @notice Zap scenario shared by the local test (real Uniswap v3 bytecode, mock tokens) and the
///         Robinhood Chain fork test (live Uniswap, WETH, USDG and Stock Token).
///
///         Subclasses set up the chain (`_setUpChain`) and say how to get stock / USDG and which
///         Uniswap path leads from WETH or USDG to the stock. Everything Dripp-side is deployed here:
///         oracle, factory, one series, the router, and PT/stock + YT/stock pools seeded by an LP.
abstract contract ZapScenario is Test {
    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant MIN_TICK = -887220; // full range for tick spacing 60
    int24 internal constant MAX_TICK = 887220;

    // chain (set by subclass)
    address internal weth;
    address internal usdg;
    address internal stock;
    address internal swapRouter;
    bool internal legacyRouter;
    INonfungiblePositionManagerT internal npm;

    // dripp
    DividendOracle internal oracle;
    DrippVaultFactory internal factory;
    DrippVault internal vault;
    DrippRouter internal router;
    address internal pt;
    address internal yt;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal stockDrip = makeAddr("stockDrip");
    address internal keeper = makeAddr("keeper");
    address internal user = makeAddr("user");

    /// @dev Return false to skip (e.g. fork RPC not configured).
    function _setUpChain() internal virtual returns (bool);
    /// @dev Give `to` at least `amount` raw stock tokens.
    function _getStock(address to, uint256 amount) internal virtual;
    /// @dev Give `to` at least `amount` USDG.
    function _getUsdg(address to, uint256 amount) internal virtual;
    /// @dev Uniswap path from `tokenIn` (WETH or USDG) to the stock token.
    function _pathToStock(address tokenIn) internal view virtual returns (bytes memory);
    /// @dev Amount of stock (raw) the LP puts into the PT/YT pools in total.
    function _lpStock() internal view virtual returns (uint256);
    /// @dev Zap sizes.
    function _ethIn() internal view virtual returns (uint256);
    function _usdgIn() internal view virtual returns (uint256);

    function setUp() public virtual {
        if (!_setUpChain()) {
            vm.skip(true);
            return;
        }
        oracle = new DividendOracle(owner);
        factory = new DrippVaultFactory(owner, treasury, owner, new DrippVaultDeployer(), oracle);
        vm.startPrank(owner);
        oracle.grantRole(oracle.PROPOSER_ROLE(), keeper);
        oracle.grantRole(oracle.DISPUTER_ROLE(), owner);
        oracle.registerToken(stock);
        factory.allowStockToken(stock, "STK");
        factory.setStockDrip(stockDrip);
        vault = DrippVault(factory.createVault(stock, block.timestamp + 180 days, factory.UNCAPPED()));
        vm.stopPrank();
        pt = address(vault.pt());
        yt = address(vault.yt());
        router = new DrippRouter(factory, swapRouter, legacyRouter, IWETH9(weth), usdg);

        _seedPools();
        vm.deal(user, 100 ether);
    }

    // ------------------------------------------------------------------
    // Scenario
    // ------------------------------------------------------------------

    function test_zapEthToPT() public {
        uint256 amountIn = _ethIn();
        DrippRouter.ZapParams memory p = _params(DrippRouter.Target.PT, address(0), amountIn, _ethToToken(pt));

        uint256 out = _quote(p, amountIn);
        assertGt(out, 0);

        // slippage protection: asking for 1 wei more than the market gives reverts
        p.minOut = out + 1;
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(DrippRouter.InsufficientOutput.selector, out, out + 1));
        router.zap{value: amountIn}(p);

        p.minOut = out;
        vm.prank(user);
        assertEq(router.zap{value: amountIn}(p), out);
        assertEq(IERC20(pt).balanceOf(user), out);

        // 0.1% zap fee in WETH: 60% Stock Drip, 40% treasury
        uint256 fee = amountIn / 1000;
        assertEq(IERC20(weth).balanceOf(stockDrip), fee * 6 / 10);
        assertEq(IERC20(weth).balanceOf(treasury), fee - fee * 6 / 10);
        _assertRouterEmpty();
    }

    function test_zapUsdgToYT() public {
        uint256 amountIn = _usdgIn();
        _getUsdg(user, amountIn);
        vm.prank(user);
        IERC20(usdg).approve(address(router), amountIn);

        bytes memory path = bytes.concat(_pathToStock(usdg), abi.encodePacked(POOL_FEE, yt));
        DrippRouter.ZapParams memory p = _params(DrippRouter.Target.YT, usdg, amountIn, path);
        vm.prank(user);
        uint256 out = router.zap(p);
        assertGt(out, 0);
        assertEq(IERC20(yt).balanceOf(user), out);
        assertEq(IERC20(usdg).balanceOf(stockDrip), amountIn / 1000 * 6 / 10);
        // YT bought through the pool starts accruing from now
        assertEq(vault.userIndex(user), vault.pyIndexStored());
        _assertRouterEmpty();
    }

    function test_zapEthToPTandYT_viaSplit() public {
        uint256 amountIn = _ethIn();
        DrippRouter.ZapParams memory p =
            _params(DrippRouter.Target.PY, address(0), amountIn, _pathToStock(weth));
        vm.prank(user);
        uint256 out = router.zap{value: amountIn}(p);
        assertGt(out, 0);
        assertEq(IERC20(pt).balanceOf(user), out);
        assertEq(IERC20(yt).balanceOf(user), out);
        _assertRouterEmpty();
    }

    function test_zapStockToPT_direct() public {
        uint256 amountIn = _lpStock() / 50;
        _getStock(user, amountIn);
        vm.prank(user);
        IERC20(stock).approve(address(router), amountIn);
        DrippRouter.ZapParams memory p =
            _params(DrippRouter.Target.PT, stock, amountIn, abi.encodePacked(stock, POOL_FEE, pt));
        vm.prank(user);
        uint256 out = router.zap(p);
        // PT trades at a discount: more PT than the stock's share value
        assertGt(out, Math.mulDiv(amountIn - amountIn / 1000, vault.currentIndex(), 1e18));
        _assertRouterEmpty();
    }

    function test_zap_reverts() public {
        uint256 amountIn = _ethIn();
        DrippRouter.ZapParams memory p = _params(DrippRouter.Target.PT, address(0), amountIn, _ethToToken(pt));

        vm.startPrank(user);

        p.deadline = block.timestamp - 1;
        vm.expectRevert(DrippRouter.Expired.selector);
        router.zap{value: amountIn}(p);
        p.deadline = block.timestamp;

        vm.expectRevert(DrippRouter.BadMsgValue.selector);
        router.zap{value: amountIn - 1}(p);

        p.path = _ethToToken(yt); // ends at YT but target is PT
        vm.expectRevert(DrippRouter.BadPath.selector);
        router.zap{value: amountIn}(p);

        p.path = bytes.concat(abi.encodePacked(stock, POOL_FEE), abi.encodePacked(pt)); // starts at stock
        vm.expectRevert(DrippRouter.BadPath.selector);
        router.zap{value: amountIn}(p);

        p.path = _ethToToken(pt);
        p.vault = address(0xdead);
        vm.expectRevert(abi.encodeWithSelector(DrippRouter.UnknownVault.selector, address(0xdead)));
        router.zap{value: amountIn}(p);

        p.vault = address(vault);
        p.tokenIn = address(0xbeef);
        vm.expectRevert(abi.encodeWithSelector(DrippRouter.UnsupportedToken.selector, address(0xbeef)));
        router.zap(p);

        vm.stopPrank();
    }

    /// Split vs dividend on the live token: a 2-for-1 split adds nothing to YT, a 3% dividend does.
    function test_oracle_splitVsDividend() public {
        uint256 shares = _lpStock() / 10;
        _getStock(user, shares);
        vm.startPrank(user);
        IERC20(stock).approve(address(vault), shares);
        vault.split(shares, user);
        vm.stopPrank();

        uint256 m0 = vault.currentIndex();
        _setMultiplier(m0 * 2);
        vm.prank(keeper);
        oracle.proposeSplit(stock);
        vm.warp(block.timestamp + 1 days);
        oracle.confirm(stock);
        assertEq(vault.claimableYield(user), 0);
        assertEq(vault.sharesPerPT(), 2e18);

        _setMultiplier(m0 * 2 * 103 / 100);
        vm.prank(keeper);
        oracle.proposeDividend(stock);
        vm.warp(block.timestamp + 1 days);
        oracle.confirm(stock);
        uint256 expected = shares - Math.mulDiv(shares, 100, 103);
        assertApproxEqAbs(vault.claimableYield(user), expected, 2);

        uint256 before = IERC20(stock).balanceOf(user);
        vm.prank(user);
        uint256 net = vault.claimYield(user);
        assertEq(IERC20(stock).balanceOf(user) - before, net);
        assertApproxEqAbs(net, expected * 95 / 100, 2); // 5% YT fee
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /// @dev Changes what the token reports as uiMultiplier (mock on a fork, setter locally).
    function _setMultiplier(uint256 m) internal virtual;

    function _params(DrippRouter.Target target, address tokenIn, uint256 amountIn, bytes memory path)
        internal
        view
        returns (DrippRouter.ZapParams memory)
    {
        return DrippRouter.ZapParams({
            vault: address(vault),
            target: target,
            tokenIn: tokenIn,
            amountIn: amountIn,
            path: path,
            minOut: 1,
            receiver: user,
            deadline: block.timestamp
        });
    }

    function _ethToToken(address tokenOut) internal view returns (bytes memory) {
        return bytes.concat(_pathToStock(weth), abi.encodePacked(POOL_FEE, tokenOut));
    }

    /// @dev Output of a zap without keeping its effects.
    function _quote(DrippRouter.ZapParams memory p, uint256 value) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        vm.prank(user);
        out = router.zap{value: value}(p);
        vm.revertToState(snap);
    }

    function _assertRouterEmpty() internal view {
        assertEq(IERC20(weth).balanceOf(address(router)), 0, "router kept WETH");
        assertEq(IERC20(usdg).balanceOf(address(router)), 0, "router kept USDG");
        assertEq(IERC20(stock).balanceOf(address(router)), 0, "router kept stock");
        assertEq(IERC20(pt).balanceOf(address(router)), 0, "router kept PT");
        assertEq(IERC20(yt).balanceOf(address(router)), 0, "router kept YT");
        assertEq(address(router).balance, 0, "router kept ETH");
    }

    /// @dev LP splits half its stock and pairs PT at 0.95 and YT at 0.05 stock per share.
    function _seedPools() internal {
        address lp = makeAddr("lp");
        uint256 total = _lpStock();
        _getStock(lp, total);
        uint256 toSplit = total / 2;
        uint256 index = vault.currentIndex();

        vm.startPrank(lp);
        IERC20(stock).approve(address(vault), toSplit);
        uint256 py = vault.split(toSplit, lp);
        // raw stock per share at par = 1e18 / index
        uint256 stockForPT = Math.mulDiv(py, 95e16, index);
        uint256 stockForYT = Math.mulDiv(py, 5e16, index);
        _addFullRange(lp, pt, py, stock, stockForPT);
        _addFullRange(lp, yt, py, stock, stockForYT);
        vm.stopPrank();
    }

    /// @dev Creates the pool at the amountA:amountB price and adds full-range liquidity (caller pranked).
    function _addFullRange(address lp, address tokenA, uint256 amountA, address tokenB, uint256 amountB)
        internal
    {
        (address t0, address t1, uint256 a0, uint256 a1) =
            tokenA < tokenB ? (tokenA, tokenB, amountA, amountB) : (tokenB, tokenA, amountB, amountA);
        // sqrt(a1 / a0) * 2^96
        uint160 sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(a1, 1 << 192, a0)));
        npm.createAndInitializePoolIfNecessary(t0, t1, POOL_FEE, sqrtPriceX96);
        IERC20(t0).approve(address(npm), a0);
        IERC20(t1).approve(address(npm), a1);
        npm.mint(
            INonfungiblePositionManagerT.MintParams({
                token0: t0,
                token1: t1,
                fee: POOL_FEE,
                tickLower: MIN_TICK,
                tickUpper: MAX_TICK,
                amount0Desired: a0,
                amount1Desired: a1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: lp,
                deadline: block.timestamp
            })
        );
    }
}
