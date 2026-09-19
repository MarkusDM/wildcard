// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vault} from "../src/Vault.sol";

contract PlayerActor {
    function depositTo(Vault vault, uint256 amount) external {
        vault.deposit(amount);
    }

    function withdrawFrom(Vault vault, uint256 amount) external {
        vault.withdraw(amount);
    }

    function lockTo(Vault vault, bytes32 tableId, uint256 amount) external {
        vault.lock(tableId, amount);
    }

    function unlockFrom(Vault vault, bytes32 tableId, uint256 amount) external {
        vault.unlock(tableId, amount);
    }

    function tryWithdrawFrom(Vault vault, uint256 amount) external returns (bool ok) {
        (ok,) = address(vault).call(abi.encodeWithSelector(vault.withdraw.selector, amount));
    }

    function tryLockTo(Vault vault, bytes32 tableId, uint256 amount) external returns (bool ok) {
        (ok,) = address(vault).call(abi.encodeWithSelector(vault.lock.selector, tableId, amount));
    }

    function tryUnlockFrom(Vault vault, bytes32 tableId, uint256 amount) external returns (bool ok) {
        (ok,) = address(vault).call(abi.encodeWithSelector(vault.unlock.selector, tableId, amount));
    }

    function trySettle(
        Vault vault,
        bytes32 tableId,
        address[] calldata winners,
        uint256[] calldata payouts
    ) external returns (bool ok) {
        (ok,) = address(vault).call(
            abi.encodeWithSelector(vault.settle.selector, tableId, winners, payouts)
        );
    }
}

contract VaultTest {
    bytes32 private constant TABLE_ID = keccak256("t25");

    function assertEqUint(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertTrue(bool value, string memory message) internal pure {
        require(value, message);
    }

    function testDepositAndWithdraw() public {
        Vault vault = new Vault();
        PlayerActor alice = new PlayerActor();

        alice.depositTo(vault, 100);
        assertEqUint(vault.balances(address(alice)), 100, "deposit failed");

        alice.withdrawFrom(vault, 40);
        assertEqUint(vault.balances(address(alice)), 60, "withdraw failed");
    }

    function testLockAndUnlock() public {
        Vault vault = new Vault();
        PlayerActor alice = new PlayerActor();

        alice.depositTo(vault, 100);
        alice.lockTo(vault, TABLE_ID, 30);

        assertEqUint(vault.balances(address(alice)), 70, "available balance should be reduced");
        assertEqUint(vault.locked(address(alice), TABLE_ID), 30, "locked amount mismatch");

        alice.unlockFrom(vault, TABLE_ID, 10);
        assertEqUint(vault.balances(address(alice)), 80, "unlock should restore available balance");
        assertEqUint(vault.locked(address(alice), TABLE_ID), 20, "unlock should reduce locked amount");
    }

    function testSettleTransfersBalancesCorrectly() public {
        Vault vault = new Vault();
        PlayerActor alice = new PlayerActor();
        PlayerActor bob = new PlayerActor();

        alice.depositTo(vault, 100);
        bob.depositTo(vault, 100);

        alice.lockTo(vault, TABLE_ID, 40);
        bob.lockTo(vault, TABLE_ID, 20);

        address[] memory winners = new address[](2);
        winners[0] = address(alice);
        winners[1] = address(bob);

        uint256[] memory payouts = new uint256[](2);
        payouts[0] = 10;
        payouts[1] = 50;

        vault.settle(TABLE_ID, winners, payouts);

        assertEqUint(vault.balances(address(alice)), 70, "alice final balance mismatch");
        assertEqUint(vault.balances(address(bob)), 130, "bob final balance mismatch");
        assertEqUint(vault.locked(address(alice), TABLE_ID), 0, "alice lock should be cleared");
        assertEqUint(vault.locked(address(bob), TABLE_ID), 0, "bob lock should be cleared");
        assertTrue(vault.settled(TABLE_ID), "table should be marked settled");
    }

    function testInvalidScenarios() public {
        Vault vault = new Vault();
        PlayerActor alice = new PlayerActor();
        PlayerActor bob = new PlayerActor();

        alice.depositTo(vault, 50);

        bool withdrawTooMuch = alice.tryWithdrawFrom(vault, 100);
        assertTrue(!withdrawTooMuch, "withdraw over balance should fail");

        bool lockTooMuch = alice.tryLockTo(vault, TABLE_ID, 60);
        assertTrue(!lockTooMuch, "lock over available should fail");

        alice.lockTo(vault, TABLE_ID, 30);
        bool unlockTooMuch = alice.tryUnlockFrom(vault, TABLE_ID, 40);
        assertTrue(!unlockTooMuch, "unlock over locked should fail");

        bob.depositTo(vault, 10);
        bob.lockTo(vault, TABLE_ID, 10);

        address[] memory winners = new address[](1);
        winners[0] = address(alice);

        uint256[] memory badPayouts = new uint256[](2);
        badPayouts[0] = 20;
        badPayouts[1] = 20;

        bool invalidInputSettle = alice.trySettle(vault, TABLE_ID, winners, badPayouts);
        assertTrue(!invalidInputSettle, "settle with invalid input should fail");

        uint256[] memory wrongSumPayouts = new uint256[](1);
        wrongSumPayouts[0] = 35;

        bool wrongSumSettle = alice.trySettle(vault, TABLE_ID, winners, wrongSumPayouts);
        assertTrue(!wrongSumSettle, "settle with wrong payout sum should fail");

        uint256[] memory goodPayouts = new uint256[](1);
        goodPayouts[0] = 40;
        vault.settle(TABLE_ID, winners, goodPayouts);

        bool settleTwice = alice.trySettle(vault, TABLE_ID, winners, goodPayouts);
        assertTrue(!settleTwice, "settle twice should fail");

        bool unlockAfterSettle = alice.tryUnlockFrom(vault, TABLE_ID, 1);
        assertTrue(!unlockAfterSettle, "unlock after settlement should fail");
    }
}
