// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
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
///         for one series (stock, maturity), e.g. AAPL-MAR27.
///
///         Unit of account: PT/YT are denominated in shares, i.e. the stock token's *UI amount*
///         (raw * index / 1e18), where `index` is the high-water mark of `uiMultiplier()`.
///         1 PT + 1 YT = 1 share.
///
///         - split:    deposit `s` raw tokens at index I -> mint s*I/1e18 PT and the same amount of YT.
///         - merge:    burn `a` PT + `a` YT (any time) -> receive a*1e18/I raw tokens.
///         - redeemPT: after maturity, burn `a` PT -> receive a*1e18/I_live raw tokens; tokens freed by
///                     multiplier growth after maturity go to the treasury.
///         - YT yield: holding `a` YT while the index moves I0 -> I1 accrues
///                     a*1e18/I0 - a*1e18/I1 raw tokens, claimable any time. Accrual stops at maturity.
///
///         Solvency: tokens held >= PT supply * 1e18 / I + all YT yield owed. Using the high-water
///         mark means a falling multiplier never creates a deficit (PT absorbs the drop instead).
///
/// @dev    Every multiplier increase is currently treated as a dividend. Telling dividends apart from
///         stock splits (DividendOracle, 24h dispute window) is a later milestone; see SPEC.md.
contract DrippVault is IDrippVault, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant ONE = 1e18;

    IERC20 public immutable stockToken;
    PTToken public immutable pt;
    YTToken public immutable yt;
    uint256 public immutable maturity;
    address public immutable factory;
    /// @notice Series label, e.g. "AAPL-MAR27".
    string public series;

    /// @notice Max outstanding principal (PT supply, in shares) that `split` may create.
    ///         type(uint256).max means no cap.
    uint256 public depositCap;

    /// @notice High-water mark of the stock token's uiMultiplier (18 decimals).
    uint256 public pyIndexStored;
    /// @notice Index frozen for YT accrual, set on the first interaction at/after maturity.
    uint256 public indexAtMaturity;

    /// @notice Index at which each user's YT yield was last checkpointed.
    mapping(address => uint256) public userIndex;
    /// @notice Checkpointed, unclaimed YT yield per user, in raw tokens.
    mapping(address => uint256) public accruedYield;
    /// @notice Sum of `accruedYield` across all users.
    uint256 public totalAccruedYield;

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(
        address factory_,
        address stockToken_,
        uint256 maturity_,
        uint8 decimals_,
        string memory ticker_,
        string memory dateLabel_,
        uint256 depositCap_
    ) {
        string memory series_ = string.concat(ticker_, "-", dateLabel_);
        factory = factory_;
        stockToken = IERC20(stockToken_);
        maturity = maturity_;
        series = series_;
        depositCap = depositCap_;

        uint256 m = IScaledUIAmount(stockToken_).uiMultiplier();
        if (m == 0) revert InvalidMultiplier();
        pyIndexStored = m;

        pt = new PTToken(
            string.concat("Dripp PT ", series_),
            string.concat("p", series_),
            decimals_,
            stockToken_,
            maturity_
        );
        yt = new YTToken(
            string.concat("Dripp YT ", series_),
            string.concat("y", series_),
            decimals_,
            stockToken_,
            maturity_
        );
    }

    // ------------------------------------------------------------------
    // User actions
    // ------------------------------------------------------------------

    /// @notice Deposit `amount` raw stock tokens and mint equal amounts of PT and YT to `receiver`.
    function split(uint256 amount, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 pyOut)
    {
        if (isMatured()) revert Matured();
        if (amount == 0) revert ZeroAmount();
        uint256 index = _updateIndex();

        uint256 balBefore = stockToken.balanceOf(address(this));
        stockToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stockToken.balanceOf(address(this)) - balBefore;

        pyOut = Math.mulDiv(received, index, ONE);
        if (pyOut == 0) revert ZeroAmount();
        if (pt.totalSupply() + pyOut > depositCap) revert DepositCapExceeded();

        pt.mint(receiver, pyOut);
        yt.mint(receiver, pyOut); // YT hook checkpoints `receiver` before the balance changes
        emit Split(msg.sender, receiver, received, pyOut, index);
    }

    /// @notice Burn `amount` PT and `amount` YT from the caller and return the principal in raw tokens.
    ///         Works any time; after maturity it pays out the same as `redeemPT` and burns the
    ///         (no longer accruing) YT. Accrued YT yield stays claimable.
    function merge(uint256 amount, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesOut)
    {
        if (amount == 0) revert ZeroAmount();
        uint256 index = _updateIndex();

        pt.burn(msg.sender, amount);
        yt.burn(msg.sender, amount); // checkpoints caller's yield first, so it stays claimable

        sharesOut = _payPrincipal(amount, index, receiver);
        emit Merge(msg.sender, receiver, amount, sharesOut, index);
    }

    /// @notice After maturity, burn `amount` PT and receive raw tokens worth `amount` shares.
    function redeemPT(uint256 amount, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesOut)
    {
        if (!isMatured()) revert NotMatured();
        if (amount == 0) revert ZeroAmount();
        uint256 index = _updateIndex();

        pt.burn(msg.sender, amount);

        sharesOut = _payPrincipal(amount, index, receiver);
        emit Redeem(msg.sender, receiver, amount, sharesOut, index);
    }

    /// @notice Claim all YT yield accrued by the caller, paid in raw stock tokens.
    function claimYield(address receiver) external nonReentrant whenNotPaused returns (uint256 amount) {
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
    // Admin (through the factory: owner = multisig + timelock, guardian = multisig)
    // ------------------------------------------------------------------

    function setDepositCap(uint256 cap) external onlyFactory {
        depositCap = cap;
        emit DepositCapUpdated(cap);
    }

    function pause() external onlyFactory {
        _pause();
    }

    function unpause() external onlyFactory {
        _unpause();
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

    /// @notice Total YT yield claimable by `user` (checkpointed + pending), in raw tokens.
    function claimableYield(address user) public view returns (uint256) {
        return accruedYield[user] + _pending(user, ytIndex());
    }

    /// @notice Raw stock tokens held by the vault (reserves, for proof-of-reserves pages).
    function totalReserves() external view returns (uint256) {
        return stockToken.balanceOf(address(this));
    }

    function previewSplit(uint256 amount) external view returns (uint256) {
        return Math.mulDiv(amount, currentIndex(), ONE);
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

    /// @dev Pays `amount` shares of principal at `index`. After maturity, the difference between the
    ///      principal's backing at maturity and what it is worth now is post-maturity yield and goes
    ///      to the treasury.
    function _payPrincipal(uint256 amount, uint256 index, address receiver)
        internal
        returns (uint256 sharesOut)
    {
        sharesOut = Math.mulDiv(amount, ONE, index);
        stockToken.safeTransfer(receiver, sharesOut);

        uint256 im = indexAtMaturity;
        if (im != 0) {
            uint256 toTreasury = Math.mulDiv(amount, ONE, im) - sharesOut; // im <= index
            if (toTreasury != 0) {
                address treasury = IDrippVaultFactoryTreasury(factory).treasury();
                stockToken.safeTransfer(treasury, toTreasury);
                emit PostMaturityYieldToTreasury(treasury, toTreasury);
            }
        }
    }

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

    /// @dev Yield in raw tokens for holding YT from userIndex[user] to `index`:
    ///      bal * 1e18 / prev - bal * 1e18 / index, rounded down.
    function _pending(address user, uint256 index) internal view returns (uint256) {
        uint256 prev = userIndex[user];
        if (prev == 0 || index <= prev) return 0;
        uint256 bal = yt.balanceOf(user);
        if (bal == 0) return 0;
        return Math.mulDiv(bal, (index - prev) * ONE, prev * index);
    }
}
