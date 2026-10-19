// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IScaledUIAmount} from "./interfaces/IScaledUIAmount.sol";
import {IDrippVault} from "./interfaces/IDrippVault.sol";
import {PTToken} from "./tokens/PTToken.sol";
import {YTToken} from "./tokens/YTToken.sol";

interface IDrippVaultFactoryTreasury {
    function treasury() external view returns (address);
}

/// @title DrippVault
/// @notice Splits an ERC-8056 Stock Token into a Principal Token (PT) and a Yield Token (YT)
///         for one maturity.
///
///         Unit of account: PT/YT are denominated in the stock token's *UI amount*
///         (raw * index / 1e18), where `index` is the high-water mark of `uiMultiplier()`.
///
///         - split:    deposit `s` raw shares at index I  -> mint s*I/1e18 PT and the same amount of YT.
///         - merge:    burn `a` PT + `a` YT (before maturity) -> receive a*1e18/I raw shares.
///         - redeemPT: after maturity, burn `a` PT -> receive a*1e18/I_live raw shares; shares freed by
///                     multiplier growth after maturity go to the treasury.
///         - YT yield: holding `a` YT while the index moves I0 -> I1 accrues
///                     a*1e18/I0 - a*1e18/I1 raw shares, claimable any time. Accrual stops at maturity.
///
///         Solvency: shares held >= PT supply * 1e18 / I + all YT yield owed. Using the high-water
///         mark means a falling multiplier never creates a deficit (PT absorbs the drop instead).
contract DrippVault is IDrippVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ONE = 1e18;

    IERC20 public immutable stockToken;
    PTToken public immutable pt;
    YTToken public immutable yt;
    uint256 public immutable maturity;
    address public immutable factory;

    /// @notice High-water mark of the stock token's uiMultiplier (18 decimals).
    uint256 public pyIndexStored;
    /// @notice Index frozen for YT accrual, set on the first interaction at/after maturity.
    uint256 public indexAtMaturity;

    /// @notice Index at which each user's YT yield was last checkpointed.
    mapping(address => uint256) public userIndex;
    /// @notice Checkpointed, unclaimed YT yield per user, in raw shares.
    mapping(address => uint256) public accruedYield;
    /// @notice Sum of `accruedYield` across all users.
    uint256 public totalAccruedYield;

    constructor(address stockToken_, uint256 maturity_, uint8 decimals_, string memory label_) {
        factory = msg.sender;
        stockToken = IERC20(stockToken_);
        maturity = maturity_;

        uint256 m = IScaledUIAmount(stockToken_).uiMultiplier();
        if (m == 0) revert InvalidMultiplier();
        pyIndexStored = m;

        pt = new PTToken(
            string.concat("Dripp PT ", label_),
            string.concat("PT-", label_),
            decimals_,
            stockToken_,
            maturity_
        );
        yt = new YTToken(
            string.concat("Dripp YT ", label_),
            string.concat("YT-", label_),
            decimals_,
            stockToken_,
            maturity_
        );
    }

    // ------------------------------------------------------------------
    // User actions
    // ------------------------------------------------------------------

    /// @notice Deposit `shares` raw stock tokens and mint equal amounts of PT and YT to `receiver`.
    function split(uint256 shares, address receiver) external nonReentrant returns (uint256 pyOut) {
        if (isMatured()) revert Matured();
        if (shares == 0) revert ZeroAmount();
        uint256 index = _updateIndex();

        uint256 balBefore = stockToken.balanceOf(address(this));
        stockToken.safeTransferFrom(msg.sender, address(this), shares);
        uint256 received = stockToken.balanceOf(address(this)) - balBefore;

        pyOut = Math.mulDiv(received, index, ONE);
        if (pyOut == 0) revert ZeroAmount();

        pt.mint(receiver, pyOut);
        yt.mint(receiver, pyOut); // YT hook checkpoints `receiver` before the balance changes
        emit Split(msg.sender, receiver, received, pyOut, index);
    }

    /// @notice Burn `amount` PT and `amount` YT from the caller and return the principal in raw shares.
    /// @dev Only before maturity; afterwards use `redeemPT` (YT no longer carries principal).
    function merge(uint256 amount, address receiver) external nonReentrant returns (uint256 sharesOut) {
        if (isMatured()) revert Matured();
        if (amount == 0) revert ZeroAmount();
        uint256 index = _updateIndex();

        pt.burn(msg.sender, amount);
        yt.burn(msg.sender, amount); // checkpoints caller's yield first, so it stays claimable

        sharesOut = Math.mulDiv(amount, ONE, index);
        stockToken.safeTransfer(receiver, sharesOut);
        emit Merge(msg.sender, receiver, amount, sharesOut, index);
    }

    /// @notice After maturity, burn `amount` PT and receive raw shares worth `amount` UI units.
    function redeemPT(uint256 amount, address receiver) external nonReentrant returns (uint256 sharesOut) {
        if (!isMatured()) revert NotMatured();
        if (amount == 0) revert ZeroAmount();
        uint256 liveIndex = _updateIndex();

        pt.burn(msg.sender, amount);

        sharesOut = Math.mulDiv(amount, ONE, liveIndex);
        // Shares backing this PT at maturity; anything above `sharesOut` is post-maturity yield.
        uint256 basis = Math.mulDiv(amount, ONE, indexAtMaturity);
        uint256 toTreasury = basis - sharesOut;

        stockToken.safeTransfer(receiver, sharesOut);
        if (toTreasury != 0) {
            address treasury = IDrippVaultFactoryTreasury(factory).treasury();
            stockToken.safeTransfer(treasury, toTreasury);
            emit PostMaturityYieldToTreasury(treasury, toTreasury);
        }
        emit RedeemPT(msg.sender, receiver, amount, sharesOut, liveIndex);
    }

    /// @notice Claim all YT yield accrued by the caller, paid in raw shares.
    function claimYield(address receiver) external nonReentrant returns (uint256 amount) {
        _updateIndex();
        _checkpoint(msg.sender);
        amount = accruedYield[msg.sender];
        if (amount != 0) {
            accruedYield[msg.sender] = 0;
            totalAccruedYield -= amount;
            stockToken.safeTransfer(receiver, amount);
        }
        emit YieldClaimed(msg.sender, receiver, amount);
    }

    /// @notice Permissionless poke: refresh the high-water index (and freeze the maturity index).
    ///         A keeper should call this right at maturity so YT accrual stops at the right index.
    function updateIndex() external nonReentrant returns (uint256) {
        return _updateIndex();
    }

    /// @inheritdoc IDrippVault
    function onYTBalanceChange(address from, address to) external {
        if (msg.sender != address(yt)) revert OnlyYT();
        _updateIndex();
        _checkpoint(from);
        _checkpoint(to);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function isMatured() public view returns (bool) {
        return block.timestamp >= maturity;
    }

    /// @notice High-water index as it would be after an update.
    function currentIndex() public view returns (uint256) {
        uint256 m = IScaledUIAmount(address(stockToken)).uiMultiplier();
        return m > pyIndexStored ? m : pyIndexStored;
    }

    /// @notice Index used for YT accrual right now (frozen after maturity).
    function ytIndex() public view returns (uint256) {
        if (!isMatured()) return currentIndex();
        return indexAtMaturity != 0 ? indexAtMaturity : currentIndex();
    }

    /// @notice Total YT yield claimable by `user` (checkpointed + pending).
    function claimableYield(address user) public view returns (uint256) {
        return accruedYield[user] + _pending(user, ytIndex());
    }

    function previewSplit(uint256 shares) external view returns (uint256) {
        return Math.mulDiv(shares, currentIndex(), ONE);
    }

    function previewMerge(uint256 amount) external view returns (uint256) {
        return Math.mulDiv(amount, ONE, currentIndex());
    }

    function previewRedeemPT(uint256 amount) external view returns (uint256) {
        return Math.mulDiv(amount, ONE, currentIndex());
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _updateIndex() internal returns (uint256 index) {
        uint256 m = IScaledUIAmount(address(stockToken)).uiMultiplier();
        if (m == 0) revert InvalidMultiplier();
        index = pyIndexStored;
        if (m > index) {
            emit IndexUpdated(index, m);
            index = m;
            pyIndexStored = m;
        }
        if (indexAtMaturity == 0 && isMatured()) {
            indexAtMaturity = index;
            emit MaturityIndexSet(index);
        }
    }

    function _currentYtIndex() internal view returns (uint256) {
        return indexAtMaturity != 0 ? indexAtMaturity : pyIndexStored;
    }

    function _checkpoint(address user) internal {
        if (user == address(0)) return;
        uint256 index = _currentYtIndex();
        uint256 interest = _pending(user, index);
        if (interest != 0) {
            accruedYield[user] += interest;
            totalAccruedYield += interest;
        }
        userIndex[user] = index;
    }

    /// @dev Yield in raw shares for holding YT from userIndex[user] to `index`:
    ///      bal * 1e18 / prev - bal * 1e18 / index, rounded down.
    function _pending(address user, uint256 index) internal view returns (uint256) {
        uint256 prev = userIndex[user];
        if (prev == 0 || index <= prev) return 0;
        uint256 bal = yt.balanceOf(user);
        if (bal == 0) return 0;
        return Math.mulDiv(bal, (index - prev) * ONE, prev * index);
    }
}
