// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Uniswap SwapRouter02 (Robinhood Chain mainnet). No deadline in the params struct.
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Classic Uniswap v3 SwapRouter (used by the Robinhood Chain testnet deployment).
interface ISwapRouterV1 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
}
