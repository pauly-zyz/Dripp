Creation bytecode of the canonical Uniswap v3 contracts, copied from the npm artifacts:

| File | Package |
|------|---------|
| `UniswapV3Factory.hex` | `@uniswap/v3-core@1.0.1` (BUSL-1.1, converted to GPL-2.0-or-later on 2023-04-01) |
| `NonfungiblePositionManager.hex`, `SwapRouter.hex` | `@uniswap/v3-periphery@1.4.4` (GPL-2.0-or-later) |
| `SwapRouter02.hex`, `QuoterV2.hex` | `@uniswap/swap-router-contracts@1.3.1` (GPL-2.0-or-later) |

Used only by tests (`test/router/`) to run the router against real Uniswap v3 locally. Robinhood
Chain mainnet uses SwapRouter02; its testnet community deployment uses the classic SwapRouter.
