// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDividendOracle {
    enum Status {
        None,
        Pending,
        Confirmed,
        Disputed
    }

    struct Proposal {
        uint256 fromMultiplier;
        uint256 toMultiplier;
        /// @dev Stock split ratio contained in the change (1e18 = no split, 2e18 = 2-for-1).
        uint256 splitRatio;
        /// @dev Dividend index after this proposal is confirmed.
        uint256 dividendIndexAfter;
        uint64 proposedAt;
        uint64 disputeEndsAt;
        Status status;
    }

    event TokenRegistered(address indexed stockToken, uint256 multiplier);
    event DividendProposed(
        address indexed stockToken,
        uint256 indexed id,
        uint256 fromMultiplier,
        uint256 toMultiplier,
        uint256 splitRatio,
        uint256 dividendIndexAfter,
        uint256 disputeEndsAt
    );
    event DividendDisputed(address indexed stockToken, uint256 indexed id, address indexed by);
    event DividendConfirmed(
        address indexed stockToken, uint256 indexed id, uint256 dividendIndex, uint256 splitFactor
    );

    error NotRegistered(address stockToken);
    error AlreadyRegistered(address stockToken);
    error InvalidMultiplier();
    error ProposalPending(uint256 id);
    error NoPendingProposal();
    error MultiplierUnchanged();
    error InvalidSplitRatio();
    error DividendIndexWouldDecrease();
    error DisputeWindowOpen(uint256 endsAt);
    error DisputeWindowClosed();

    function isRegistered(address stockToken) external view returns (bool);
    function dividendIndex(address stockToken) external view returns (uint256);
    function dividendIndexAt(address stockToken, uint256 timestamp) external view returns (uint256);
    function splitFactor(address stockToken) external view returns (uint256);
}
