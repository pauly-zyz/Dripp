// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Formats a unix timestamp as a series date label, e.g. 2027-03-26 -> "MAR27" (UTC).
library SeriesLabel {
    function monthYear(uint256 timestamp) internal pure returns (string memory) {
        (uint256 year, uint256 month) = _yearMonth(timestamp / 1 days);
        bytes memory months = "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC";
        uint256 yy = year % 100;
        bytes memory out = new bytes(5);
        out[0] = months[(month - 1) * 3];
        out[1] = months[(month - 1) * 3 + 1];
        out[2] = months[(month - 1) * 3 + 2];
        // yy < 100, so each digit is 0-9 and fits in uint8.
        // forge-lint: disable-next-line(unsafe-typecast)
        out[3] = bytes1(uint8(48 + yy / 10));
        // forge-lint: disable-next-line(unsafe-typecast)
        out[4] = bytes1(uint8(48 + yy % 10));
        return string(out);
    }

    /// @dev Days since 1970-01-01 -> (year, month). Howard Hinnant's civil_from_days.
    function _yearMonth(uint256 day) private pure returns (uint256 year, uint256 month) {
        uint256 z = day + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        month = mp < 10 ? mp + 3 : mp - 9;
        year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    }
}
