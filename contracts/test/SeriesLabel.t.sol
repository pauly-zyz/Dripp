// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SeriesLabel} from "../src/libraries/SeriesLabel.sol";

contract SeriesLabelTest is Test {
    function label(uint256 ts) external pure returns (string memory) {
        return SeriesLabel.monthYear(ts);
    }

    function test_knownDates() public view {
        assertEq(this.label(0), "JAN70");
        assertEq(this.label(951_782_400), "FEB00"); // 2000-02-29
        assertEq(this.label(951_868_799), "FEB00"); // 2000-02-29 23:59:59
        assertEq(this.label(951_868_800), "MAR00"); // 2000-03-01
        assertEq(this.label(1_806_019_200), "MAR27"); // 2027-03-26
        assertEq(this.label(1_821_916_800), "SEP27"); // 2027-09-26
        assertEq(this.label(1_830_297_599), "DEC27"); // 2027-12-31 23:59:59
        assertEq(this.label(1_830_297_600), "JAN28"); // 2028-01-01
        assertEq(this.label(4_107_542_400), "MAR00"); // 2100-03-01 (not a leap year)
    }
}
