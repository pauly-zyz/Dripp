// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDrippVaultFactory} from "./interfaces/IDrippVaultFactory.sol";
import {ISwapRouter02, ISwapRouterV1, IWETH9} from "./interfaces/IUniswapV3.sol";
import {DrippVault} from "./DrippVault.sol";

/// @title DrippRouter
/// @notice One-transaction zaps from ETH, USDG (or the stock itself) into a Dripp series via Uniswap v3:
///
///         - Target.PT / Target.YT: one multi-hop swap tokenIn -> ... -> stock -> PT|YT, ending in the
///           series' PT/stock or YT/stock pool. Output goes straight to `receiver`.
///         - Target.PY: swap tokenIn -> ... -> stock, then `split` into equal PT + YT for `receiver`.
///
///         Slippage protection: `minOut` on the final PT/YT amount plus a `deadline`. The zap fee
///         (SPEC: 0.1%) is taken from the input and split between Stock Drip and the treasury.
///
///         `path` is a Uniswap v3 encoded path (token, fee, token, ...). Build it off-chain from
///         QuoterV2 quotes; the router only checks that it starts at the input token and ends at the
///         expected token.
contract DrippRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Target {
        PT,
        YT,
        PY
    }

    struct ZapParams {
        address vault;
        Target target;
        /// @dev address(0) = native ETH (send it as msg.value). Otherwise USDG, WETH or the stock token.
        address tokenIn;
        uint256 amountIn;
        bytes path;
        /// @dev Minimum PT or YT received (for PY: minimum of each).
        uint256 minOut;
        address receiver;
        uint256 deadline;
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ADDR = 20;
    uint256 internal constant HOP = 23; // fee (3) + address (20)

    IDrippVaultFactory public immutable factory;
    address public immutable swapRouter;
    /// @dev true: classic SwapRouter (deadline in struct); false: SwapRouter02.
    bool public immutable legacyRouter;
    IWETH9 public immutable weth;
    address public immutable usdg;

    event Zapped(
        address indexed sender,
        address indexed receiver,
        address indexed vault,
        Target target,
        address tokenIn,
        uint256 amountIn,
        uint256 fee,
        uint256 amountOut
    );

    error Expired();
    error ZeroAmount();
    error ZeroAddress();
    error UnknownVault(address vault);
    error UnsupportedToken(address token);
    error BadMsgValue();
    error BadPath();
    error InsufficientOutput(uint256 out, uint256 minOut);

    constructor(
        IDrippVaultFactory factory_,
        address swapRouter_,
        bool legacyRouter_,
        IWETH9 weth_,
        address usdg_
    ) {
        if (
            address(factory_) == address(0) || swapRouter_ == address(0) || address(weth_) == address(0)
                || usdg_ == address(0)
        ) revert ZeroAddress();
        factory = factory_;
        swapRouter = swapRouter_;
        legacyRouter = legacyRouter_;
        weth = weth_;
        usdg = usdg_;
    }

    function zap(ZapParams calldata p) external payable nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > p.deadline) revert Expired();
        if (p.amountIn == 0) revert ZeroAmount();
        if (p.receiver == address(0)) revert ZeroAddress();
        if (!factory.isVault(p.vault)) revert UnknownVault(p.vault);
        DrippVault vault = DrippVault(p.vault);
        address stock = address(vault.stockToken());

        // 1. Take the input.
        address tokenIn = p.tokenIn;
        if (tokenIn == address(0)) {
            if (msg.value != p.amountIn) revert BadMsgValue();
            weth.deposit{value: msg.value}();
            tokenIn = address(weth);
        } else {
            if (msg.value != 0) revert BadMsgValue();
            if (tokenIn != usdg && tokenIn != address(weth) && tokenIn != stock) {
                revert UnsupportedToken(tokenIn);
            }
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
        }

        // 2. Zap fee in the input token.
        IDrippVaultFactory.FeeConfig memory cfg = factory.feeConfig();
        uint256 fee = p.amountIn * cfg.zapFeeBps / BPS;
        if (fee != 0) _payFee(IERC20(tokenIn), cfg, fee);
        uint256 amount = p.amountIn - fee;

        // 3. Swap and deliver.
        if (p.target == Target.PY) {
            uint256 stockAmount = tokenIn == stock ? amount : _swap(tokenIn, stock, amount, p, address(this));
            IERC20(stock).forceApprove(address(vault), stockAmount);
            amountOut = vault.split(stockAmount, p.receiver);
        } else {
            address tokenOut = p.target == Target.PT ? address(vault.pt()) : address(vault.yt());
            amountOut = _swap(tokenIn, tokenOut, amount, p, p.receiver);
        }
        if (amountOut < p.minOut) revert InsufficientOutput(amountOut, p.minOut);

        emit Zapped(msg.sender, p.receiver, p.vault, p.target, p.tokenIn, p.amountIn, fee, amountOut);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Swaps `amount` of `tokenIn` along `p.path` (which must end at `tokenOut`) to `recipient`
    ///      and returns what `recipient` actually received.
    function _swap(address tokenIn, address tokenOut, uint256 amount, ZapParams calldata p, address recipient)
        internal
        returns (uint256 received)
    {
        bytes calldata path = p.path;
        if (path.length < ADDR + HOP || (path.length - ADDR) % HOP != 0) revert BadPath();
        if (address(bytes20(path[:ADDR])) != tokenIn) revert BadPath();
        if (address(bytes20(path[path.length - ADDR:])) != tokenOut) revert BadPath();

        IERC20(tokenIn).forceApprove(swapRouter, amount);
        uint256 before = IERC20(tokenOut).balanceOf(recipient);
        if (legacyRouter) {
            ISwapRouterV1(swapRouter)
                .exactInput(
                    ISwapRouterV1.ExactInputParams({
                        path: path,
                        recipient: recipient,
                        deadline: p.deadline,
                        amountIn: amount,
                        amountOutMinimum: 0
                    })
                );
        } else {
            ISwapRouter02(swapRouter)
                .exactInput(
                    ISwapRouter02.ExactInputParams({
                        path: path, recipient: recipient, amountIn: amount, amountOutMinimum: 0
                    })
                );
        }
        received = IERC20(tokenOut).balanceOf(recipient) - before;
    }

    function _payFee(IERC20 token, IDrippVaultFactory.FeeConfig memory cfg, uint256 fee) internal {
        uint256 toDrip = cfg.stockDrip == address(0) ? 0 : fee * cfg.stockDripShareBps / BPS;
        if (toDrip != 0) token.safeTransfer(cfg.stockDrip, toDrip);
        if (fee - toDrip != 0) token.safeTransfer(cfg.treasury, fee - toDrip);
    }
}
