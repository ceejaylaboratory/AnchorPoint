//! NFT Metadata Contract (SEP-3 Compatible)
//!
//! This contract implements NFT metadata storage and retrieval following
//! Stellar SEP-3 standards for non-fungible tokens.
//!
//! Features:
//! - Store and retrieve NFT metadata
//! - Support for standard metadata fields (name, description, image, attributes)
//! - Royalty information support
//! - Collection management
//! - Owner-controlled metadata updates

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec, Map};

// ============================================================================
// Storage Keys
// ============================================================================

/// Storage keys for the NFT metadata contract
#[contracttype]
pub enum DataKey {
    /// Contract administrator
    Admin,
    /// NFT metadata by token ID
    NftMetadata(u64),
    /// Token owner by token ID
    TokenOwner(u64),
    /// Token ID counter for minting
    TokenCounter,
    /// Collection metadata
    CollectionMetadata,
    /// Approved operators for a token
    TokenApproval(u64, Address),
    /// Whether an operator is approved for all tokens of an owner
    OperatorApproval(Address, Address),
}

// ============================================================================
// Data Structures
// ============================================================================

/// NFT Metadata structure following SEP-3 standards
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct NftMetadata {
    /// Unique token identifier
    pub token_id: u64,
    /// Name of the NFT
    pub name: String,
    /// Description of the NFT
    pub description: String,
    /// URI pointing to the NFT image
    pub image: String,
    /// External URI for additional information
    pub external_url: String,
    /// Animation URL for multimedia NFTs
    pub animation_url: String,
    /// YouTube preview video URL
    pub youtube_url: String,
    /// Background color for display
    pub background_color: String,
    /// Attributes/trait types for the NFT
    pub attributes: Vec<NftAttribute>,
    /// Royalty percentage (basis points, e.g., 500 = 5%)
    pub royalty_percentage: u32,
    /// Royalty recipient address
    pub royalty_recipient: Address,
    /// Timestamp of creation
    pub created_at: u64,
    /// Whether metadata can be updated
    pub is_mutable: bool,
}

/// NFT Attribute structure for traits
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct NftAttribute {
    /// Display type (e.g., "number", "boost_percentage")
    pub display_type: String,
    /// Trait type (e.g., "Background", "Rarity")
    pub trait_type: String,
    /// Value of the trait
    pub value: String,
    /// Maximum value for numeric traits
    pub max_value: String,
}

/// Collection metadata structure
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CollectionMetadata {
    /// Collection name
    pub name: String,
    /// Collection symbol/ticker
    pub symbol: String,
    /// Collection description
    pub description: String,
    /// Collection image URI
    pub image: String,
    /// External URL for collection
    pub external_url: String,
    /// Seller fee basis points for royalties
    pub seller_fee_basis_points: u32,
    /// Fee recipient address
    pub fee_recipient: Address,
}

// ============================================================================
// Events
// ============================================================================

/// Event types for NFT operations
#[contracttype]
pub enum NftEvent {
    /// Emitted when an NFT is minted
    Minted(u64, Address),
    /// Emitted when an NFT is transferred
    Transferred(u64, Address, Address),
    /// Emitted when metadata is updated
    MetadataUpdated(u64),
    /// Emitted when approval is granted
    Approved(u64, Address, Address),
    /// Emitted when operator approval is set
    OperatorApprovalSet(Address, Address, bool),
}

// ============================================================================
// Contract Implementation
// ============================================================================

#[contract]
pub struct NftMetadataContract;

#[contractimpl]
impl NftMetadataContract {
    // ========================================================================
    // Initialization
    // ========================================================================

    /// Initialize the NFT metadata contract
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `admin` - The administrator address
    /// * `collection_name` - Name of the NFT collection
    /// * `collection_symbol` - Symbol/ticker for the collection
    ///
    /// # Panics
    /// Panics if already initialized
    pub fn initialize(
        env: Env,
        admin: Address,
        collection_name: String,
        collection_symbol: String,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        admin.require_auth();

        let collection = CollectionMetadata {
            name: collection_name.clone(),
            symbol: collection_symbol,
            description: String::from_str(&env, ""),
            image: String::from_str(&env, ""),
            external_url: String::from_str(&env, ""),
            seller_fee_basis_points: 0,
            fee_recipient: admin.clone(),
        };

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CollectionMetadata, &collection);
        env.storage().instance().set(&DataKey::TokenCounter, &0u64);
    }

    // ========================================================================
    // NFT Minting
    // ========================================================================

    /// Mint a new NFT with metadata
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `minter` - Address minting the NFT (must be admin)
    /// * `to` - Recipient address
    /// * `name` - NFT name
    /// * `description` - NFT description
    /// * `image` - Image URI
    /// * `royalty_percentage` - Royalty percentage (basis points)
    /// * `is_mutable` - Whether metadata can be updated
    ///
    /// # Returns
    /// The newly minted token ID
    ///
    /// # Panics
    /// Panics if minter is not admin or invalid parameters
    pub fn mint(
        env: Env,
        minter: Address,
        to: Address,
        name: String,
        description: String,
        image: String,
        royalty_percentage: u32,
        is_mutable: bool,
    ) -> u64 {
        minter.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        assert!(minter == admin, "only admin can mint");
        assert!(royalty_percentage <= 10000, "royalty exceeds maximum");

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenCounter)
            .unwrap_or(0);
        let token_id = counter + 1;

        let metadata = NftMetadata {
            token_id,
            name,
            description,
            image,
            external_url: String::from_str(&env, ""),
            animation_url: String::from_str(&env, ""),
            youtube_url: String::from_str(&env, ""),
            background_color: String::from_str(&env, ""),
            attributes: Vec::new(&env),
            royalty_percentage,
            royalty_recipient: to.clone(),
            created_at: env.ledger().timestamp(),
            is_mutable,
        };

        env.storage().instance().set(&DataKey::NftMetadata(token_id), &metadata);
        env.storage().instance().set(&DataKey::TokenOwner(token_id), &to);
        env.storage().instance().set(&DataKey::TokenCounter, &token_id);

        env.events().publish(
            (symbol_short!("mint"), token_id),
            to,
        );

        token_id
    }

    /// Mint NFT with full metadata
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `minter` - Address minting the NFT (must be admin)
    /// * `to` - Recipient address
    /// * `metadata` - Complete NFT metadata
    ///
    /// # Returns
    /// The newly minted token ID
    pub fn mint_with_metadata(
        env: Env,
        minter: Address,
        to: Address,
        metadata: NftMetadata,
    ) -> u64 {
        minter.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        assert!(minter == admin, "only admin can mint");
        assert!(metadata.royalty_percentage <= 10000, "royalty exceeds maximum");

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TokenCounter)
            .unwrap_or(0);
        let token_id = counter + 1;

        let mut final_metadata = metadata;
        final_metadata.token_id = token_id;
        final_metadata.created_at = env.ledger().timestamp();

        env.storage().instance().set(&DataKey::NftMetadata(token_id), &final_metadata);
        env.storage().instance().set(&DataKey::TokenOwner(token_id), &to);
        env.storage().instance().set(&DataKey::TokenCounter, &token_id);

        env.events().publish(
            (symbol_short!("mint"), token_id),
            to,
        );

        token_id
    }

    // ========================================================================
    // Metadata Management
    // ========================================================================

    /// Get NFT metadata
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `token_id` - Token ID to query
    ///
    /// # Returns
    /// The NFT metadata
    ///
    /// # Panics
    /// Panics if token doesn't exist
    pub fn get_metadata(env: Env, token_id: u64) -> NftMetadata {
        env.storage()
            .instance()
            .get(&DataKey::NftMetadata(token_id))
            .expect("token not found")
    }

    /// Update NFT metadata (only if mutable)
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling the update
    /// * `token_id` - Token ID to update
    /// * `name` - New name (empty string to keep current)
    /// * `description` - New description (empty string to keep current)
    /// * `image` - New image URI (empty string to keep current)
    ///
    /// # Panics
    /// Panics if token not found, not mutable, or caller not owner
    pub fn update_metadata(
        env: Env,
        caller: Address,
        token_id: u64,
        name: String,
        description: String,
        image: String,
    ) {
        caller.require_auth();

        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        assert!(caller == owner, "only owner can update");

        let mut metadata: NftMetadata = env
            .storage()
            .instance()
            .get(&DataKey::NftMetadata(token_id))
            .expect("token not found");

        assert!(metadata.is_mutable, "metadata is not mutable");

        // Update only non-empty fields
        if !name.is_empty() {
            metadata.name = name;
        }
        if !description.is_empty() {
            metadata.description = description;
        }
        if !image.is_empty() {
            metadata.image = image;
        }

        env.storage().instance().set(&DataKey::NftMetadata(token_id), &metadata);

        env.events().publish(
            (symbol_short!("updated"), token_id),
            caller,
        );
    }

    /// Add attribute to NFT
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling the update
    /// * `token_id` - Token ID
    /// * `attribute` - Attribute to add
    pub fn add_attribute(
        env: Env,
        caller: Address,
        token_id: u64,
        attribute: NftAttribute,
    ) {
        caller.require_auth();

        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        assert!(caller == owner, "only owner can update");

        let mut metadata: NftMetadata = env
            .storage()
            .instance()
            .get(&DataKey::NftMetadata(token_id))
            .expect("token not found");

        assert!(metadata.is_mutable, "metadata is not mutable");

        metadata.attributes.push_back(attribute);

        env.storage().instance().set(&DataKey::NftMetadata(token_id), &metadata);

        env.events().publish(
            (symbol_short!("attr_add"), token_id),
            caller,
        );
    }

    /// Set royalty information for a token
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling the update
    /// * `token_id` - Token ID
    /// * `percentage` - New royalty percentage
    /// * `recipient` - New royalty recipient
    pub fn set_royalty(
        env: Env,
        caller: Address,
        token_id: u64,
        percentage: u32,
        recipient: Address,
    ) {
        caller.require_auth();

        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        assert!(caller == owner, "only owner can set royalty");
        assert!(percentage <= 10000, "royalty exceeds maximum");

        let mut metadata: NftMetadata = env
            .storage()
            .instance()
            .get(&DataKey::NftMetadata(token_id))
            .expect("token not found");

        metadata.royalty_percentage = percentage;
        metadata.royalty_recipient = recipient;

        env.storage().instance().set(&DataKey::NftMetadata(token_id), &metadata);
    }

    // ========================================================================
    // Ownership
    // ========================================================================

    /// Get the owner of a token
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `token_id` - Token ID to query
    ///
    /// # Returns
    /// The owner address
    pub fn owner_of(env: Env, token_id: u64) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found")
    }

    /// Transfer token ownership
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `from` - Current owner
    /// * `to` - New owner
    /// * `token_id` - Token to transfer
    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        token_id: u64,
    ) {
        from.require_auth();

        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        assert!(from == owner, "not token owner");

        env.storage().instance().set(&DataKey::TokenOwner(token_id), &to);

        // Clear any approvals
        env.storage().instance().remove(&DataKey::TokenApproval(token_id, from.clone()));

        env.events().publish(
            (symbol_short!("transfer"), token_id),
            (from, to),
        );
    }

    /// Burn an NFT (destroy it)
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling the burn (must be owner or admin)
    /// * `token_id` - Token to burn
    pub fn burn(env: Env, caller: Address, token_id: u64) {
        caller.require_auth();

        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        assert!(caller == owner || caller == admin, "not authorized to burn");

        env.storage().instance().remove(&DataKey::TokenOwner(token_id));
        env.storage().instance().remove(&DataKey::NftMetadata(token_id));
        env.storage().instance().remove(&DataKey::TokenApproval(token_id, owner));

        env.events().publish(
            (symbol_short!("burn"), token_id),
            caller,
        );
    }
    // ========================================================================
    // Approvals
    // ========================================================================

    /// Approve an address to operate on a token
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `owner` - Token owner
    /// * `approved` - Address to approve
    /// * `token_id` - Token ID
    pub fn approve(
        env: Env,
        owner: Address,
        approved: Address,
        token_id: u64,
    ) {
        owner.require_auth();

        let token_owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        assert!(owner == token_owner, "not token owner");

        env.storage().instance().set(&DataKey::TokenApproval(token_id, owner.clone()), &approved);

        env.events().publish(
            (symbol_short!("approved"), token_id),
            (owner, approved),
        );
    }

    /// Set approval for all tokens
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `owner` - Token owner
    /// * `operator` - Address to set approval for
    /// * `approved` - Whether to approve or revoke
    pub fn set_approval_for_all(
        env: Env,
        owner: Address,
        operator: Address,
        approved: bool,
    ) {
        owner.require_auth();

        if approved {
            env.storage().instance().set(&DataKey::OperatorApproval(owner.clone(), operator.clone()), &true);
        } else {
            env.storage().instance().remove(&DataKey::OperatorApproval(owner.clone(), operator.clone()));
        }

        env.events().publish(
            (symbol_short!("appr_all"), owner.clone()),
            (operator, approved),
        );
    }

    /// Check if an address is approved for a token
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `token_id` - Token ID
    /// * `spender` - Address to check
    ///
    /// # Returns
    /// Whether the spender is approved
    pub fn is_approved(env: Env, token_id: u64, spender: Address) -> bool {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenOwner(token_id))
            .expect("token not found");

        // Check direct approval
        let direct_approval: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::TokenApproval(token_id, owner.clone()));

        if let Some(approved) = direct_approval {
            if approved == spender {
                return true;
            }
        }

        // Check operator approval
        let is_operator: Option<bool> = env
            .storage()
            .instance()
            .get(&DataKey::OperatorApproval(owner, spender));

        is_operator.unwrap_or(false)
    }

    // ========================================================================
    // Collection Management
    // ========================================================================

    /// Get collection metadata
    ///
    /// # Returns
    /// The collection metadata
    pub fn get_collection(env: Env) -> CollectionMetadata {
        env.storage()
            .instance()
            .get(&DataKey::CollectionMetadata)
            .expect("not initialized")
    }

    /// Update collection metadata (admin only)
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address calling the update
    /// * `name` - New collection name
    /// * `description` - New description
    /// * `image` - New collection image
    pub fn update_collection(
        env: Env,
        caller: Address,
        name: String,
        description: String,
        image: String,
    ) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");

        assert!(caller == admin, "only admin can update collection");

        let mut collection: CollectionMetadata = env
            .storage()
            .instance()
            .get(&DataKey::CollectionMetadata)
            .expect("not initialized");

        collection.name = name;
        collection.description = description;
        collection.image = image;

        env.storage().instance().set(&DataKey::CollectionMetadata, &collection);
    }

    /// Get total supply of tokens
    ///
    /// # Returns
    /// Total number of minted tokens
    pub fn total_supply(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TokenCounter)
            .unwrap_or(0)
    }

    // ========================================================================
    // Query Functions
    // ========================================================================

    /// Check if a token exists
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `token_id` - Token ID to check
    ///
    /// # Returns
    /// Whether the token exists
    pub fn exists(env: Env, token_id: u64) -> bool {
        env.storage().instance().has(&DataKey::NftMetadata(token_id))
    }

    /// Get royalty info for a token
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `token_id` - Token ID
    /// * `sale_price` - Sale price (for calculating royalty amount)
    ///
    /// # Returns
    /// Tuple of (recipient, royalty_amount)
    pub fn royalty_info(env: Env, token_id: u64, sale_price: i128) -> (Address, i128) {
        let metadata: NftMetadata = env
            .storage()
            .instance()
            .get(&DataKey::NftMetadata(token_id))
            .expect("token not found");

        let royalty_amount = (sale_price * metadata.royalty_percentage as i128) / 10000;

        (metadata.royalty_recipient, royalty_amount)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, NftMetadataContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(NftMetadataContract, ());
        let client = NftMetadataContractClient::new(&env, &id);
        
        client.initialize(
            &admin,
            &String::from_str(&env, "Test Collection"),
            &String::from_str(&env, "TEST"),
        );
        
        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, client, admin) = setup();
        
        let collection = client.get_collection();
        assert_eq!(collection.name, String::from_str(&env, "Test Collection"));
        assert_eq!(collection.symbol, String::from_str(&env, "TEST"));
        assert_eq!(collection.fee_recipient, admin);
    }

    #[test]
    fn test_mint() {
        let (env, client, admin) = setup();
        let to = Address::generate(&env);
        
        let token_id = client.mint(
            &admin,
            &to,
            &String::from_str(&env, "Test NFT"),
            &String::from_str(&env, "A test NFT"),
            &String::from_str(&env, "ipfs://test"),
            &500u32, // 5% royalty
            &true,   // mutable
        );
        
        assert_eq!(token_id, 1);
        assert_eq!(client.total_supply(), 1);
        assert_eq!(client.owner_of(&token_id), to);
        assert!(client.exists(&token_id));
        
        let metadata = client.get_metadata(&token_id);
        assert_eq!(metadata.name, String::from_str(&env, "Test NFT"));
        assert_eq!(metadata.royalty_percentage, 500);
    }

    #[test]
    fn test_transfer() {
        let (env, client, admin) = setup();
        let to = Address::generate(&env);
        let new_owner = Address::generate(&env);
        
        let token_id = client.mint(
            &admin,
            &to,
            &String::from_str(&env, "Test NFT"),
            &String::from_str(&env, "A test NFT"),
            &String::from_str(&env, "ipfs://test"),
            &500u32,
            &true,
        );
        
        client.transfer(&to, &new_owner, &token_id);
        
        assert_eq!(client.owner_of(&token_id), new_owner);
    }

    #[test]
    fn test_update_metadata() {
        let (env, client, admin) = setup();
        let to = Address::generate(&env);
        
        let token_id = client.mint(
            &admin,
            &to,
            &String::from_str(&env, "Original Name"),
            &String::from_str(&env, "Original Description"),
            &String::from_str(&env, "ipfs://original"),
            &500u32,
            &true, // mutable
        );
        
        client.update_metadata(
            &to,
            &token_id,
            &String::from_str(&env, "New Name"),
            &String::from_str(&env, "New Description"),
            &String::from_str(&env, "ipfs://new"),
        );
        
        let metadata = client.get_metadata(&token_id);
        assert_eq!(metadata.name, String::from_str(&env, "New Name"));
        assert_eq!(metadata.description, String::from_str(&env, "New Description"));
        assert_eq!(metadata.image, String::from_str(&env, "ipfs://new"));
    }

    #[test]
    fn test_royalty_info() {
        let (env, client, admin) = setup();
        let to = Address::generate(&env);
        
        let token_id = client.mint(
            &admin,
            &to,
            &String::from_str(&env, "Test NFT"),
            &String::from_str(&env, "A test NFT"),
            &String::from_str(&env, "ipfs://test"),
            &500u32, // 5% royalty
            &true,
        );
        
        let (recipient, royalty) = client.royalty_info(&token_id, &10000);
        
        assert_eq!(recipient, to);
        assert_eq!(royalty, 500); // 5% of 10000
    }

    #[test]
    fn test_add_attribute() {
        let (env, client, admin) = setup();
        let to = Address::generate(&env);
        
        let token_id = client.mint(
            &admin,
            &to,
            &String::from_str(&env, "Test NFT"),
            &String::from_str(&env, "A test NFT"),
            &String::from_str(&env, "ipfs://test"),
            &500u32,
            &true,
        );
        
        let attr = NftAttribute {
            display_type: String::from_str(&env, ""),
            trait_type: String::from_str(&env, "Background"),
            value: String::from_str(&env, "Blue"),
            max_value: String::from_str(&env, ""),
        };
        
        client.add_attribute(&to, &token_id, &attr);
        
        let metadata = client.get_metadata(&token_id);
        assert_eq!(metadata.attributes.len(), 1);
    }

    #[test]
    fn test_approval() {
        let (env, client, admin) = setup();
        let to = Address::generate(&env);
        let spender = Address::generate(&env);
        
        let token_id = client.mint(
            &admin,
            &to,
            &String::from_str(&env, "Test NFT"),
            &String::from_str(&env, "A test NFT"),
            &String::from_str(&env, "ipfs://test"),
            &500u32,
            &true,
        );
        
        client.approve(&to, &spender, &token_id);
        
        assert!(client.is_approved(&token_id, &spender));
    }
}
