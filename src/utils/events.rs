#![no_std]
//! Standardized Contract Event Emitter for AnchorPoint
//! 
//! Provides a unified shape for all events emitted by AnchorPoint contracts,
//! making it easier for off-chain indexers to process Soroban data.

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol, Val};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DepositEvent {
    pub from: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WithdrawEvent {
    pub from: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SwapEvent {
    pub from: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalCreatedEvent {
    pub id: u32,
    pub creator: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VotedEvent {
    pub proposal_id: u32,
    pub voter: Address,
    pub support: bool,
    pub votes: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalExecutedEvent {
    pub proposal_id: u32,
    pub executor: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FundsReleasedEvent {
    pub recipient: Address,
    pub amount: i128,
}

/// Canonical events emitted across the AnchorPoint monorepo.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AnchorEvent {
    Deposit(DepositEvent),
    Withdraw(WithdrawEvent),
    Swap(SwapEvent),
    ProposalCreated(ProposalCreatedEvent),
    Voted(VotedEvent),
    ProposalExecuted(ProposalExecutedEvent),
    FundsReleased(FundsReleasedEvent),
}

/// A trait for standardized event emission.
/// Contracts can implement this or use the `emit_event` free function.
pub trait EventEmitter {
    fn emit(&self, env: &Env, event: AnchorEvent);
}

/// Emits an AnchorPoint event using a standardized topic structure.
///
/// The payload is the structured `AnchorEvent` enum.
/// The top-level topic is always `symbol_short!("anchor")` followed by the variant name,
/// which allows indexers to filter globally for all AnchorPoint events.
pub fn emit_event(env: &Env, event: AnchorEvent) {
    let sub_topic = match &event {
        AnchorEvent::Deposit(_) => symbol_short!("deposit"),
        AnchorEvent::Withdraw(_) => symbol_short!("withdraw"),
        AnchorEvent::Swap(_) => symbol_short!("swap"),
        AnchorEvent::ProposalCreated(_) => symbol_short!("prop_cre"),
        AnchorEvent::Voted(_) => symbol_short!("voted"),
        AnchorEvent::ProposalExecuted(_) => symbol_short!("prop_exe"),
        AnchorEvent::FundsReleased(_) => symbol_short!("release"),
    };

    env.events().publish((symbol_short!("anchor"), sub_topic), event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events, vec, IntoVal, FromVal, contract, contractimpl};

    #[contract]
    pub struct DummyContract;

    #[contractimpl]
    impl DummyContract {
        pub fn emit_test_event(env: Env, event: AnchorEvent) {
            emit_event(&env, event);
        }
    }

    #[test]
    fn test_emit_deposit() {
        let env = Env::default();
        let id = env.register(DummyContract, ());
        let client = DummyContractClient::new(&env, &id);

        let from = Address::generate(&env);
        let event = AnchorEvent::Deposit(DepositEvent {
            from: from.clone(),
            amount_a: 100,
            amount_b: 200,
            shares: 50,
        });

        client.emit_test_event(&event);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        
        let last_event = events.last().unwrap();
        let expected_topics: soroban_sdk::Vec<Val> = vec![
            &env, 
            symbol_short!("anchor").into_val(&env), 
            symbol_short!("deposit").into_val(&env)
        ];
        
        assert_eq!(last_event.1.len(), expected_topics.len());
        for i in 0..expected_topics.len() {
            assert_eq!(last_event.1.get(i).unwrap().get_payload(), expected_topics.get(i).unwrap().get_payload());
        }
        
        let published_event: AnchorEvent = AnchorEvent::from_val(&env, &last_event.2);
        assert_eq!(published_event, event);
    }

    #[test]
    fn test_emit_voted() {
        let env = Env::default();
        let id = env.register(DummyContract, ());
        let client = DummyContractClient::new(&env, &id);

        let voter = Address::generate(&env);
        let event = AnchorEvent::Voted(VotedEvent {
            proposal_id: 1,
            voter: voter.clone(),
            support: true,
            votes: 25,
        });

        client.emit_test_event(&event);

        let events = env.events().all();
        assert_eq!(events.len(), 1);
        
        let last_event = events.last().unwrap();
        let expected_topics: soroban_sdk::Vec<Val> = vec![
            &env, 
            symbol_short!("anchor").into_val(&env), 
            symbol_short!("voted").into_val(&env)
        ];
        
        for i in 0..expected_topics.len() {
            assert_eq!(last_event.1.get(i).unwrap().get_payload(), expected_topics.get(i).unwrap().get_payload());
        }
        
        let published_event: AnchorEvent = AnchorEvent::from_val(&env, &last_event.2);
        assert_eq!(published_event, event);
    }

}
