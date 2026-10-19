// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

import {IScaledUIAmount} from "./interfaces/IScaledUIAmount.sol";
import {IDividendOracle} from "./interfaces/IDividendOracle.sol";

/// @title DividendOracle
/// @notice Classifies every change of a Stock Token's ERC-8056 `uiMultiplier` as dividend and/or stock split.
///
///         uiMultiplier = dividendIndex * splitFactor / 1e18 (as of the last confirmed proposal).
///         Only `dividendIndex` feeds YT accrual, so a stock split never adds to YT claims.
///
///         Flow: a keeper (PROPOSER_ROLE) proposes the token's *current* uiMultiplier together with the
///         split ratio it contains. The number itself is read on-chain, so only the classification can be
///         wrong. During the 24h dispute window the multisig (DISPUTER_ROLE) can reject it; afterwards
///         anyone can confirm it. One pending proposal per token at a time.
///
///         Confirmed dividend indexes are checkpointed by confirmation time, so vaults can read the index
///         as of their maturity.
contract DividendOracle is IDividendOracle, AccessControl {
    using Checkpoints for Checkpoints.Trace208;

    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant DISPUTER_ROLE = keccak256("DISPUTER_ROLE");
    uint256 public constant DISPUTE_PERIOD = 24 hours;
    uint256 internal constant ONE = 1e18;

    struct TokenState {
        bool registered;
        /// @dev uiMultiplier as of the last confirmed proposal.
        uint256 multiplier;
        /// @dev Cumulative stock split factor (1e18 = none).
        uint256 splitFactor;
        /// @dev id + 1 of the pending proposal, 0 if none.
        uint256 pendingPlusOne;
    }

    mapping(address stockToken => TokenState) internal _state;
    mapping(address stockToken => Proposal[]) internal _proposals;
    mapping(address stockToken => Checkpoints.Trace208) internal _dividendIndex;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice Start tracking `stockToken`. Its current multiplier becomes the starting dividend index.
    function registerToken(address stockToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        TokenState storage s = _state[stockToken];
        if (s.registered) revert AlreadyRegistered(stockToken);
        uint256 m = _liveMultiplier(stockToken);
        s.registered = true;
        s.multiplier = m;
        s.splitFactor = ONE;
        _dividendIndex[stockToken].push(_now48(), SafeCast.toUint208(m));
        emit TokenRegistered(stockToken, m);
    }

    // ------------------------------------------------------------------
    // Proposer (keeper)
    // ------------------------------------------------------------------

    /// @notice The whole change since the last confirmation is a dividend.
    function proposeDividend(address stockToken) external onlyRole(PROPOSER_ROLE) returns (uint256) {
        return _propose(stockToken, ONE, false);
    }

    /// @notice The whole change since the last confirmation is a stock split (or reverse split).
    function proposeSplit(address stockToken) external onlyRole(PROPOSER_ROLE) returns (uint256) {
        return _propose(stockToken, 0, true);
    }

    /// @notice Mixed change: a split of `splitRatio` (1e18 = none) plus a dividend for the rest.
    function propose(address stockToken, uint256 splitRatio)
        external
        onlyRole(PROPOSER_ROLE)
        returns (uint256)
    {
        if (splitRatio == 0) revert InvalidSplitRatio();
        return _propose(stockToken, splitRatio, false);
    }

    // ------------------------------------------------------------------
    // Disputer (multisig) / anyone
    // ------------------------------------------------------------------

    /// @notice Reject the pending proposal during its dispute window.
    function dispute(address stockToken) external onlyRole(DISPUTER_ROLE) {
        (uint256 id, Proposal storage p) = _pending(stockToken);
        if (block.timestamp >= p.disputeEndsAt) revert DisputeWindowClosed();
        p.status = Status.Disputed;
        _state[stockToken].pendingPlusOne = 0;
        emit DividendDisputed(stockToken, id, msg.sender);
    }

    /// @notice Apply the pending proposal once its dispute window has passed. Permissionless.
    function confirm(address stockToken) external {
        (uint256 id, Proposal storage p) = _pending(stockToken);
        if (block.timestamp < p.disputeEndsAt) revert DisputeWindowOpen(p.disputeEndsAt);

        TokenState storage s = _state[stockToken];
        p.status = Status.Confirmed;
        s.pendingPlusOne = 0;
        s.multiplier = p.toMultiplier;
        s.splitFactor = Math.mulDiv(s.splitFactor, p.splitRatio, ONE);
        _dividendIndex[stockToken].push(_now48(), SafeCast.toUint208(p.dividendIndexAfter));
        emit DividendConfirmed(stockToken, id, p.dividendIndexAfter, s.splitFactor);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function isRegistered(address stockToken) external view returns (bool) {
        return _state[stockToken].registered;
    }

    /// @notice Latest confirmed dividend index (18 decimals). Only grows, and only through dividends.
    function dividendIndex(address stockToken) public view returns (uint256) {
        if (!_state[stockToken].registered) revert NotRegistered(stockToken);
        return _dividendIndex[stockToken].latest();
    }

    /// @notice Dividend index as of `timestamp` (0 before registration).
    function dividendIndexAt(address stockToken, uint256 timestamp) external view returns (uint256) {
        if (!_state[stockToken].registered) revert NotRegistered(stockToken);
        return _dividendIndex[stockToken].upperLookupRecent(SafeCast.toUint48(timestamp));
    }

    function splitFactor(address stockToken) external view returns (uint256) {
        if (!_state[stockToken].registered) revert NotRegistered(stockToken);
        return _state[stockToken].splitFactor;
    }

    /// @notice uiMultiplier as of the last confirmed proposal.
    function confirmedMultiplier(address stockToken) external view returns (uint256) {
        return _state[stockToken].multiplier;
    }

    /// @notice Pending proposal id, if any.
    function pendingProposal(address stockToken) external view returns (bool exists, uint256 id) {
        uint256 p = _state[stockToken].pendingPlusOne;
        return (p != 0, p == 0 ? 0 : p - 1);
    }

    function getProposal(address stockToken, uint256 id) external view returns (Proposal memory) {
        return _proposals[stockToken][id];
    }

    function proposalsLength(address stockToken) external view returns (uint256) {
        return _proposals[stockToken].length;
    }

    /// @notice True when the live uiMultiplier differs from the last confirmed one (keeper hint).
    function needsProposal(address stockToken) external view returns (bool) {
        TokenState storage s = _state[stockToken];
        return
            s.registered && s.pendingPlusOne == 0
                && IScaledUIAmount(stockToken).uiMultiplier() != s.multiplier;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _propose(address stockToken, uint256 splitRatio, bool pureSplit) internal returns (uint256 id) {
        TokenState storage s = _state[stockToken];
        if (!s.registered) revert NotRegistered(stockToken);
        if (s.pendingPlusOne != 0) revert ProposalPending(s.pendingPlusOne - 1);

        uint256 from = s.multiplier;
        uint256 to = _liveMultiplier(stockToken);
        if (to == from) revert MultiplierUnchanged();

        uint256 indexBefore = _dividendIndex[stockToken].latest();
        uint256 indexAfter;
        if (pureSplit) {
            splitRatio = Math.mulDiv(to, ONE, from);
            if (splitRatio == 0) revert InvalidSplitRatio();
            indexAfter = indexBefore;
        } else {
            // index * (to / from) / splitRatio
            indexAfter = Math.mulDiv(Math.mulDiv(indexBefore, to, from), ONE, splitRatio);
            if (indexAfter < indexBefore || (splitRatio == ONE && indexAfter == indexBefore)) {
                revert DividendIndexWouldDecrease();
            }
        }

        id = _proposals[stockToken].length;
        uint64 endsAt = SafeCast.toUint64(block.timestamp + DISPUTE_PERIOD);
        _proposals[stockToken].push(
            Proposal({
                fromMultiplier: from,
                toMultiplier: to,
                splitRatio: splitRatio,
                dividendIndexAfter: indexAfter,
                proposedAt: SafeCast.toUint64(block.timestamp),
                disputeEndsAt: endsAt,
                status: Status.Pending
            })
        );
        s.pendingPlusOne = id + 1;
        emit DividendProposed(stockToken, id, from, to, splitRatio, indexAfter, endsAt);
    }

    function _pending(address stockToken) internal view returns (uint256 id, Proposal storage p) {
        uint256 pp = _state[stockToken].pendingPlusOne;
        if (pp == 0) revert NoPendingProposal();
        id = pp - 1;
        p = _proposals[stockToken][id];
    }

    function _liveMultiplier(address stockToken) internal view returns (uint256 m) {
        m = IScaledUIAmount(stockToken).uiMultiplier();
        if (m == 0) revert InvalidMultiplier();
    }

    function _now48() internal view returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }
}
