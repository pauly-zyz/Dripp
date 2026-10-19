// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IScaledUIAmount, IScaledUIAmountNewUIMultiplier} from "./interfaces/IScaledUIAmount.sol";
import {DrippVault} from "./DrippVault.sol";

/// @title DrippVaultFactory
/// @notice Deploys one DrippVault (with its PT and YT) per (stock token, maturity) pair.
///         Only stock tokens allowlisted by the owner can get vaults; the allowlist is filled from
///         the deployment config (contracts/config/<network>.json).
contract DrippVaultFactory is Ownable2Step {
    address public treasury;

    mapping(address stockToken => bool) public isStockTokenAllowed;
    mapping(address stockToken => mapping(uint256 maturity => address vault)) public getVault;
    mapping(address vault => bool) public isVault;
    address[] public allVaults;

    event TreasuryUpdated(address indexed treasury);
    event StockTokenAllowed(address indexed stockToken, bool allowed);
    event VaultCreated(
        address indexed stockToken, uint256 indexed maturity, address vault, address pt, address yt
    );

    error ZeroAddress();
    error StockTokenNotAllowed(address stockToken);
    error NotERC8056(address stockToken);
    error InvalidMaturity();
    error VaultExists(address vault);

    constructor(address owner_, address treasury_) Ownable(owner_) {
        _setTreasury(treasury_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        _setTreasury(treasury_);
    }

    /// @notice Allow or disallow a stock token. The token must implement ERC-8056 (checked via ERC-165).
    function setStockTokenAllowed(address stockToken, bool allowed) external onlyOwner {
        if (stockToken == address(0)) revert ZeroAddress();
        if (allowed && !isERC8056(stockToken)) revert NotERC8056(stockToken);
        isStockTokenAllowed[stockToken] = allowed;
        emit StockTokenAllowed(stockToken, allowed);
    }

    /// @notice Create the vault for `stockToken` maturing at `maturity` (unix seconds).
    function createVault(address stockToken, uint256 maturity) external returns (address vault) {
        if (!isStockTokenAllowed[stockToken]) revert StockTokenNotAllowed(stockToken);
        if (maturity <= block.timestamp) revert InvalidMaturity();
        address existing = getVault[stockToken][maturity];
        if (existing != address(0)) revert VaultExists(existing);

        IERC20Metadata meta = IERC20Metadata(stockToken);
        string memory label = string.concat(meta.symbol(), "-", Strings.toString(maturity));

        DrippVault v = new DrippVault{salt: keccak256(abi.encode(stockToken, maturity))}(
            stockToken, maturity, meta.decimals(), label
        );
        vault = address(v);

        getVault[stockToken][maturity] = vault;
        isVault[vault] = true;
        allVaults.push(vault);
        emit VaultCreated(stockToken, maturity, vault, address(v.pt()), address(v.yt()));
    }

    function allVaultsLength() external view returns (uint256) {
        return allVaults.length;
    }

    function isERC8056(address token) public view returns (bool) {
        return ERC165Checker.supportsInterface(token, type(IScaledUIAmount).interfaceId)
            && ERC165Checker.supportsInterface(token, type(IScaledUIAmountNewUIMultiplier).interfaceId);
    }

    function _setTreasury(address treasury_) internal {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }
}
