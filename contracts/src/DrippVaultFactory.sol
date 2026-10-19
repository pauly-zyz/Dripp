// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IScaledUIAmount} from "./interfaces/IScaledUIAmount.sol";
import {IDrippVaultFactory} from "./interfaces/IDrippVaultFactory.sol";
import {IDividendOracle} from "./interfaces/IDividendOracle.sol";
import {DrippVault} from "./DrippVault.sol";
import {DrippVaultDeployer} from "./DrippVaultDeployer.sol";
import {SeriesLabel} from "./libraries/SeriesLabel.sol";

/// @title DrippVaultFactory
/// @notice Deploys one DrippVault (with its PT and YT) per (stock token, maturity) pair and keeps the
///         series registry (e.g. "AAPL-MAR27" -> vault).
///
///         Roles:
///         - owner (multisig behind a 48h TimelockController): allowlist stock tokens, create series,
///           set deposit caps, fees, treasury, Stock Drip receiver, guardian, unpause.
///         - guardian (multisig, no timelock): can pause a vault immediately in an emergency.
///
///         Stock token addresses are not hardcoded; they come from contracts/config/<network>.json
///         through script/Deploy.s.sol.
contract DrippVaultFactory is IDrippVaultFactory, Ownable {
    uint256 public constant UNCAPPED = type(uint256).max;
    uint16 public constant MAX_YT_FEE_BPS = 1_000; // 10%
    uint16 public constant MAX_ZAP_FEE_BPS = 100; // 1%

    DrippVaultDeployer public immutable deployer;
    IDividendOracle public immutable oracle;

    address public guardian;
    FeeConfig internal _fees;

    mapping(address stockToken => bool) public isStockTokenAllowed;
    /// @notice Ticker used in series names, e.g. "AAPL" -> "AAPL-MAR27", "pAAPL-MAR27".
    mapping(address stockToken => string) public tickerOf;

    mapping(address stockToken => mapping(uint256 maturity => address vault)) public getVault;
    mapping(bytes32 seriesHash => address vault) internal _vaultBySeries;
    mapping(address vault => bool) public isVault;
    address[] public allVaults;

    event TreasuryUpdated(address indexed treasury);
    event StockDripUpdated(address indexed stockDrip);
    event FeesUpdated(uint16 ytFeeBps, uint16 zapFeeBps, uint16 stockDripShareBps);
    event GuardianUpdated(address indexed guardian);
    event StockTokenAllowed(address indexed stockToken, bool allowed, string ticker);
    event SeriesCreated(
        address indexed stockToken,
        uint256 indexed maturity,
        address indexed vault,
        address pt,
        address yt,
        string series,
        uint256 depositCap
    );

    error ZeroAddress();
    error EmptyTicker();
    error StockTokenNotAllowed(address stockToken);
    error NotERC8056(address stockToken);
    error InvalidMaturity();
    error VaultExists(address vault);
    error UnknownVault(address vault);
    error NotGuardianOrOwner();
    error NotInOracle(address stockToken);
    error FeeTooHigh();

    /// @dev Fees start at the SPEC values: 5% YT claims, 0.1% zaps, 60% of fees to Stock Drip.
    constructor(
        address owner_,
        address treasury_,
        address guardian_,
        DrippVaultDeployer deployer_,
        IDividendOracle oracle_
    ) Ownable(owner_) {
        if (address(deployer_) == address(0) || address(oracle_) == address(0)) {
            revert ZeroAddress();
        }
        deployer = deployer_;
        oracle = oracle_;
        _setFees(500, 10, 6_000);
        _setTreasury(treasury_);
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    function setTreasury(address treasury_) external onlyOwner {
        _setTreasury(treasury_);
    }

    /// @notice Stock Drip receiver (DrippStaking). address(0) sends the whole fee to the treasury.
    function setStockDrip(address stockDrip_) external onlyOwner {
        _fees.stockDrip = stockDrip_;
        emit StockDripUpdated(stockDrip_);
    }

    function setFees(uint16 ytFeeBps, uint16 zapFeeBps, uint16 stockDripShareBps) external onlyOwner {
        _setFees(ytFeeBps, zapFeeBps, stockDripShareBps);
    }

    /// @notice Guardian may be address(0) (only the owner can pause then).
    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    /// @notice Allow a stock token under `ticker`. It must expose ERC-8056 `uiMultiplier()` and be
    ///         registered in the DividendOracle.
    function allowStockToken(address stockToken, string calldata ticker) external onlyOwner {
        if (stockToken == address(0)) revert ZeroAddress();
        if (bytes(ticker).length == 0) revert EmptyTicker();
        if (!isERC8056(stockToken)) revert NotERC8056(stockToken);
        if (!oracle.isRegistered(stockToken)) revert NotInOracle(stockToken);
        isStockTokenAllowed[stockToken] = true;
        tickerOf[stockToken] = ticker;
        emit StockTokenAllowed(stockToken, true, ticker);
    }

    /// @notice Stop new series for `stockToken`. Existing vaults keep working.
    function disallowStockToken(address stockToken) external onlyOwner {
        isStockTokenAllowed[stockToken] = false;
        emit StockTokenAllowed(stockToken, false, tickerOf[stockToken]);
    }

    /// @notice Create the series for `stockToken` maturing at `maturity` (unix seconds, UTC).
    ///         Named "<TICKER>-<MON><YY>", so one series per stock per month.
    /// @param depositCap Max outstanding principal in shares (token decimals); UNCAPPED for none.
    function createVault(address stockToken, uint256 maturity, uint256 depositCap)
        external
        onlyOwner
        returns (address vault)
    {
        if (!isStockTokenAllowed[stockToken]) revert StockTokenNotAllowed(stockToken);
        if (maturity <= block.timestamp) revert InvalidMaturity();
        address existing = getVault[stockToken][maturity];
        if (existing != address(0)) revert VaultExists(existing);

        string memory ticker = tickerOf[stockToken];
        string memory dateLabel = SeriesLabel.monthYear(maturity);
        string memory series = string.concat(ticker, "-", dateLabel);
        bytes32 seriesHash = keccak256(bytes(series));
        existing = _vaultBySeries[seriesHash];
        if (existing != address(0)) revert VaultExists(existing);

        vault = deployer.deploy(
            keccak256(abi.encode(stockToken, maturity)),
            stockToken,
            maturity,
            IERC20Metadata(stockToken).decimals(),
            ticker,
            dateLabel,
            depositCap
        );
        DrippVault v = DrippVault(vault);

        getVault[stockToken][maturity] = vault;
        _vaultBySeries[seriesHash] = vault;
        isVault[vault] = true;
        allVaults.push(vault);
        emit SeriesCreated(stockToken, maturity, vault, address(v.pt()), address(v.yt()), series, depositCap);
    }

    function setDepositCap(address vault, uint256 cap) external onlyOwner {
        _vault(vault).setDepositCap(cap);
    }

    function unpauseVault(address vault) external onlyOwner {
        _vault(vault).unpause();
    }

    // ------------------------------------------------------------------
    // Guardian or owner
    // ------------------------------------------------------------------

    function pauseVault(address vault) external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        _vault(vault).pause();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Vault for a series name such as "AAPL-MAR27" (address(0) if none).
    function getVaultBySeries(string calldata series) external view returns (address) {
        return _vaultBySeries[keccak256(bytes(series))];
    }

    function allVaultsLength() external view returns (uint256) {
        return allVaults.length;
    }

    /// @notice True if `token` answers ERC-8056 `uiMultiplier()` with a non-zero value. ERC-165 is not
    ///         required, since deployed Stock Tokens may not advertise it.
    function isERC8056(address token) public view returns (bool) {
        if (token.code.length == 0) return false;
        try IScaledUIAmount(token).uiMultiplier() returns (uint256 m) {
            return m != 0;
        } catch {
            return false;
        }
    }

    function treasury() external view returns (address) {
        return _fees.treasury;
    }

    function stockDrip() external view returns (address) {
        return _fees.stockDrip;
    }

    function feeConfig() external view returns (FeeConfig memory) {
        return _fees;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _vault(address vault) internal view returns (DrippVault) {
        if (!isVault[vault]) revert UnknownVault(vault);
        return DrippVault(vault);
    }

    function _setTreasury(address treasury_) internal {
        if (treasury_ == address(0)) revert ZeroAddress();
        _fees.treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function _setFees(uint16 ytFeeBps, uint16 zapFeeBps, uint16 stockDripShareBps) internal {
        if (ytFeeBps > MAX_YT_FEE_BPS || zapFeeBps > MAX_ZAP_FEE_BPS || stockDripShareBps > 10_000) {
            revert FeeTooHigh();
        }
        _fees.ytFeeBps = ytFeeBps;
        _fees.zapFeeBps = zapFeeBps;
        _fees.stockDripShareBps = stockDripShareBps;
        emit FeesUpdated(ytFeeBps, zapFeeBps, stockDripShareBps);
    }
}
