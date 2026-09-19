// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Vault
/// @notice Minimal in-memory USDC-like ledger for deposits, locks and settlements.
contract Vault {
    /// @notice Available (unlocked) balance per player.
    mapping(address => uint256) public balances;

    /// @notice Amount locked by player for a specific table.
    mapping(address => mapping(bytes32 => uint256)) public locked;

    /// @notice Marks table as settled so it cannot be settled twice.
    mapping(bytes32 => bool) public settled;

    // Internal helpers to enumerate locked players per table during settlement.
    mapping(bytes32 => address[]) private tablePlayers;
    mapping(bytes32 => mapping(address => bool)) private tableHasPlayer;

    event Deposit(address indexed account, uint256 amount);
    event Withdraw(address indexed account, uint256 amount);
    event Locked(address indexed account, bytes32 indexed tableId, uint256 amount);
    event Unlocked(address indexed account, bytes32 indexed tableId, uint256 amount);
    event Settled(bytes32 indexed tableId, uint256 totalLocked, uint256 winnersCount);

    error InvalidAmount();
    error InsufficientBalance();
    error TableAlreadySettled();
    error InvalidSettleInput();
    error InvalidPayoutSum();

    /// @notice Increase caller available balance.
    function deposit(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        balances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @notice Decrease caller available balance.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;
        emit Withdraw(msg.sender, amount);
    }

    /// @notice Lock caller funds for a specific table.
    function lock(bytes32 tableId, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;
        locked[msg.sender][tableId] += amount;

        if (!tableHasPlayer[tableId][msg.sender]) {
            tableHasPlayer[tableId][msg.sender] = true;
            tablePlayers[tableId].push(msg.sender);
        }

        emit Locked(msg.sender, tableId, amount);
    }

    /// @notice Unlock caller funds before a table is settled.
    function unlock(bytes32 tableId, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (settled[tableId]) revert TableAlreadySettled();
        if (locked[msg.sender][tableId] < amount) revert InsufficientBalance();

        locked[msg.sender][tableId] -= amount;
        balances[msg.sender] += amount;

        emit Unlocked(msg.sender, tableId, amount);
    }

    /// @notice Settle one table by distributing the whole locked pool.
    /// @dev Anyone may call; this is intentionally simple for MVP.
    function settle(bytes32 tableId, address[] calldata winners, uint256[] calldata payouts) external {
        if (settled[tableId]) revert TableAlreadySettled();
        if (winners.length == 0 || winners.length != payouts.length) revert InvalidSettleInput();

        uint256 totalLocked;
        address[] storage players = tablePlayers[tableId];
        uint256 playersLen = players.length;

        for (uint256 i = 0; i < playersLen; i++) {
            address player = players[i];
            uint256 amount = locked[player][tableId];
            if (amount > 0) {
                totalLocked += amount;
                locked[player][tableId] = 0;
            }
        }

        uint256 payoutSum;
        uint256 winnersLen = winners.length;
        for (uint256 i = 0; i < winnersLen; i++) {
            payoutSum += payouts[i];
        }

        if (payoutSum != totalLocked) revert InvalidPayoutSum();

        settled[tableId] = true;

        for (uint256 i = 0; i < winnersLen; i++) {
            balances[winners[i]] += payouts[i];
        }

        emit Settled(tableId, totalLocked, winnersLen);
    }
}
