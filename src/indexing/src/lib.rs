#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

// ============================================================================
// Storage Keys (Minimized Entropy)
// ============================================================================

#[contracttype]
pub enum DataKey {
    /// Mapping: Address -> u32 (ID)
    /// Key: 'A' + Address
    AddrToId(Address),

    /// User Data: ID -> UserData
    /// Key: 'U' + u32
    UserData(u32),

    /// Bitmap for active status (64 users per entry)
    /// Key: 'B' + (u32 / 64)
    ActiveBitmap(u32),

    /// Volatile Data: ID -> u64 (Timestamp) - Stored in Temporary storage
    /// Key: 'T' + u32
    LastActive(u32),

    /// Global counter for assigning IDs
    Counter,
}

// ============================================================================
// Data Structures
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserData {
    pub balance: i128,
    pub tier: u32,
}

#[contract]
pub struct IndexingContract;

#[contractimpl]
impl IndexingContract {
    // ========================================================================
    // Registration & ID Management
    // ========================================================================

    /// Registers a user and assigns a sequential u32 ID.
    /// This ID will be used as a compact storage key for all other data.
    pub fn register_user(env: Env, user: Address) -> u32 {
        user.require_auth();

        if let Some(id) = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::AddrToId(user.clone()))
        {
            return id;
        }

        let id: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::AddrToId(user), &id);
        env.storage().instance().set(&DataKey::Counter, &(id + 1));

        id
    }

    pub fn get_user_id(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::AddrToId(user))
            .expect("user not registered")
    }

    // ========================================================================
    // Optimized Flag Storage (Bitmaps)
    // ========================================================================

    /// Sets the active status of a user using a shared u64 bitmap.
    /// Reduces 64 storage entries to 1, saving significant ledger space.
    pub fn set_active(env: Env, id: u32, active: bool) {
        let bitmap_index = id / 64;
        let bit_pos = id % 64;

        let mut bitmap: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveBitmap(bitmap_index))
            .unwrap_or(0);

        if active {
            bitmap |= 1 << bit_pos;
        } else {
            bitmap &= !(1 << bit_pos);
        }

        env.storage()
            .persistent()
            .set(&DataKey::ActiveBitmap(bitmap_index), &bitmap);
    }

    pub fn is_active(env: Env, id: u32) -> bool {
        let bitmap_index = id / 64;
        let bit_pos = id % 64;

        let bitmap: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ActiveBitmap(bitmap_index))
            .unwrap_or(0);
        (bitmap & (1 << bit_pos)) != 0
    }

    // ========================================================================
    // Temporary Storage (Volatile Metrics)
    // ========================================================================

    /// Updates the last active timestamp in Temporary storage.
    /// Cheaper than Persistent storage for non-essential metrics.
    pub fn update_activity(env: Env, id: u32) {
        let now = env.ledger().timestamp();
        env.storage()
            .temporary()
            .set(&DataKey::LastActive(id), &now);

        // Optionally renew to keep it alive for another 10,000 blocks
        // env.storage().temporary().extend_ttl(&DataKey::LastActive(id), 10000, 10000);
    }

    pub fn get_last_active(env: Env, id: u32) -> u64 {
        env.storage()
            .temporary()
            .get(&DataKey::LastActive(id))
            .unwrap_or(0)
    }

    // ========================================================================
    // User Data Management (Compact Keys)
    // ========================================================================

    pub fn set_user_data(env: Env, id: u32, data: UserData) {
        // We use the u32 ID as part of the key instead of the full Address
        // This minimizes key entropy and XDR size in the ledger.
        env.storage()
            .persistent()
            .set(&DataKey::UserData(id), &data);
    }

    pub fn get_user_data(env: Env, id: u32) -> UserData {
        env.storage()
            .persistent()
            .get(&DataKey::UserData(id))
            .unwrap_or(UserData {
                balance: 0,
                tier: 0,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[test]
    fn test_optimized_registration() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(IndexingContract, ());
        let client = IndexingContractClient::new(&env, &id);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let id1 = client.register_user(&user1);
        let id2 = client.register_user(&user2);

        assert_eq!(id1, 0);
        assert_eq!(id2, 1);
        assert_eq!(client.get_user_id(&user1), 0);
    }

    #[test]
    fn test_bitmap_logic() {
        let env = Env::default();
        let id = env.register(IndexingContract, ());
        let client = IndexingContractClient::new(&env, &id);

        // Test bits across a single bitmap entry (0-63)
        client.set_active(&0, &true);
        client.set_active(&63, &true);
        client.set_active(&64, &true); // New bitmap entry

        assert!(client.is_active(&0));
        assert!(client.is_active(&63));
        assert!(client.is_active(&64));
        assert!(!client.is_active(&1));

        client.set_active(&63, &false);
        assert!(!client.is_active(&63));
    }

    #[test]
    fn test_temporary_storage() {
        let env = Env::default();
        env.ledger().with_mut(|l| l.timestamp = 100);
        let id = env.register(IndexingContract, ());
        let client = IndexingContractClient::new(&env, &id);

        client.update_activity(&123);
        let last = client.get_last_active(&123);
        assert_eq!(last, 100);
    }
}
