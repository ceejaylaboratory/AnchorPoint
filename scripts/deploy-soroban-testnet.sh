#!/bin/bash
# =============================================================================
# Soroban Testnet Deployment Script - Issue #424
# =============================================================================
# This script deploys AnchorPoint smart contracts to the Soroban testnet.
# It builds WASM contracts and deploys them using the Soroban CLI.
#
# Usage:
#   ./deploy-soroban-testnet.sh [--dry-run]
#
# Required Environment Variables:
#   SOROBAN_NETWORK_PASSPHRASE - Stellar network passphrase
#   SOROBAN_RPC_URL            - Soroban RPC endpoint URL
#   SOROBAN_DEPLOYER_SECRET    - Deployer secret key (starts with 'S')
#
# Optional Environment Variables:
#   SOROBAN_DEPLOYER_PUBLIC    - Deployer public key (starts with 'G')
#   CONTRACTS_DIR             - Directory containing contracts (default: ./contracts)
#   OUTPUT_FILE               - Deployment output file (default: ./deployed-contracts.json)
#
# Prerequisites:
#   - soroban CLI installed and in PATH
#   - Rust toolchain installed
#   - AnchorPoint contracts built or available for build
#
# Manual QA Steps:
#   1. Set environment variables:
#      export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
#      export SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
#      export SOROBAN_DEPLOYER_SECRET="SB..."
#
#   2. Validate prerequisites (dry-run mode):
#      ./deploy-soroban-testnet.sh --dry-run
#
#   3. Run deployment:
#      ./deploy-soroban-testnet.sh
#
#   4. Verify contracts on testnet explorer:
#      curl "https://stellar.expert/explorer/soroban.json?$CONTRACT_ID"
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

# Contract directories to deploy
CONTRACTS_DIR="${CONTRACTS_DIR:-./contracts}"
OUTPUT_FILE="${OUTPUT_FILE:-./deployed-contracts.json}"
LOG_LEVEL="${LOG_LEVEL:-info}"

# Colors for output (disabled if not a terminal)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# -----------------------------------------------------------------------------
# Logging Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

# -----------------------------------------------------------------------------
# Prerequisite Checks
# -----------------------------------------------------------------------------

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check for soroban CLI
    if ! command -v soroban &> /dev/null; then
        log_error "soroban CLI not found in PATH"
        log_error "Install with: curl -sSf https://raw.githubusercontent.com/stellar/soroban-tools/master/install.sh | sh"
        return 1
    fi
    
    # Check for required environment variables
    local missing_vars=()
    
    if [ -z "${SOROBAN_NETWORK_PASSPHRASE:-}" ]; then
        missing_vars+=("SOROBAN_NETWORK_PASSPHRASE")
    fi
    
    if [ -z "${SOROBAN_RPC_URL:-}" ]; then
        missing_vars+=("SOROBAN_RPC_URL")
    fi
    
    if [ -z "${SOROBAN_DEPLOYER_SECRET:-}" ]; then
        missing_vars+=("SOROBAN_DEPLOYER_SECRET")
    fi
    
    # Also check for deployer public key (derived from secret if not provided)
    if [ -z "${SOROBAN_DEPLOYER_PUBLIC:-}" ]; then
        log_info "DERIVED_DEPLOYER_PUBLIC will be computed from SOROBAN_DEPLOYER_SECRET"
    fi
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        log_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            log_error "  - $var"
        done
        log_error "Set them before running the script"
        return 1
    fi
    
    log_success "All prerequisites satisfied"
    return 0
}

# -----------------------------------------------------------------------------
# Dry-Run Mode
# Checks prerequisites without deploying
# -----------------------------------------------------------------------------

dry_run() {
    log_info "Running in dry-run mode - validating prerequisites only"
    
    # Check soroban CLI version
    log_info "Soroban CLI version: $(soroban --version 2>&1 || echo 'unknown')"
    
    # Check Rust toolchain
    if command -v rustc &> /dev/null; then
        log_info "Rust version: $(rustc --version 2>&1)"
    else
        log_warning "Rust not installed - contract build may fail"
    fi
    
    # Check contract directories
    if [ ! -d "$CONTRACTS_DIR" ]; then
        log_error "Contracts directory not found: $CONTRACTS_DIR"
        return 1
    fi
    
    log_info "Found $CONTRACTS_DIR directory"
    
    # List contracts to deploy
    log_info "Contracts to deploy:"
    for contract_dir in "$CONTRACTS_DIR"/*/; do
        if [ -d "$contract_dir" ]; then
            contract_name=$(basename "$contract_dir")
            if [ -f "$contract_dir/Cargo.toml" ]; then
                log_info "  - $contract_name (has Cargo.toml)"
            else
                log_warning "  - $contract_name (missing Cargo.toml)"
            fi
        fi
    done
    
    log_success "Dry-run validation complete"
    return 0
}

# -----------------------------------------------------------------------------
# Build Contract
# Builds the WASM for a single contract
# -----------------------------------------------------------------------------

build_contract() {
    local contract_name="$1"
    local contract_dir="$CONTRACTS_DIR/$contract_name"
    
    log_info "Building contract: $contract_name"
    
    if [ ! -d "$contract_dir" ]; then
        log_error "Contract directory not found: $contract_dir"
        return 1
    fi
    
    if [ ! -f "$contract_dir/Cargo.toml" ]; then
        log_error "Cargo.toml not found in $contract_dir"
        return 1
    fi
    
    # Build the WASM optimized for Soroban
    if ! soroban contract build --release --out-dir "$contract_dir/target" "$contract_dir"; then
        log_error "Failed to build contract: $contract_name"
        return 1
    fi
    
    local wasm_file="$contract_dir/target/${contract_name}.wasm"
    if [ ! -f "$wasm_file" ]; then
        # Check for alternative naming
        wasm_file=$(find "$contract_dir/target" -name "*.wasm" -type f 2>/dev/null | head -n1)
        if [ -z "$wasm_file" ]; then
            log_error "WASM file not found after build for: $contract_name"
            return 1
        fi
    fi
    
    log_success "Built WASM: $wasm_file"
    echo "$wasm_file"
}

# -----------------------------------------------------------------------------
# Deploy Contract
# Deploys a single contract to testnet
# -----------------------------------------------------------------------------

deploy_contract() {
    local contract_name="$1"
    local wasm_file="$2"
    
    log_info "Deploying contract: $contract_name"
    
    # Deploy using soroban CLI
    # The --durability persistent flag makes the contract persistent on-chain
    local contract_id
    if ! contract_id=$(soroban contract deploy \
        --network testnet \
        --rpc-url "$SOROBAN_RPC_URL" \
        --source "$SOROBAN_DEPLOYER_SECRET" \
        --wasm "$wasm_file" \
        --durability persistent \
        2>&1); then
        log_error "Failed to deploy contract: $contract_name"
        return 1
    fi
    
    # Extract contract ID from output (format: "abc123... (hosted)")
    contract_id=$(echo "$contract_id" | grep -oP '^[A-Z0-9]+' || echo "$contract_id")
    
    log_success "Deployed contract: $contract_name"
    log_success "Contract ID: $contract_id"
    
    echo "$contract_id"
}

# -----------------------------------------------------------------------------
# Save Deployment
# Saves deployed contract IDs to JSON file
# -----------------------------------------------------------------------------

save_deployments() {
    local deployments="$1"
    
    log_info "Saving deployments to: $OUTPUT_FILE"
    
    # Write deployments to file
    echo "$deployments" > "$OUTPUT_FILE"
    
    log_success "Deployments saved"
}

# -----------------------------------------------------------------------------
# Main Function
# -----------------------------------------------------------------------------

main() {
    log_info "============================================"
    log_info "AnchorPoint Soroban Testnet Deployment"
    log_info "============================================"
    
    # Parse arguments
    local dry_run_mode=false
    if [ "${1:-}" == "--dry-run" ]; then
        dry_run_mode=true
    fi
    
    # Source environment from .env if available
    if [ -f ".env" ]; then
        log_info "Loading environment from .env file"
        # shellcheck source=/dev/null
        source .env
    fi
    
    # Check prerequisites
    if ! check_prerequisites; then
        exit 1
    fi
    
    # Dry-run mode - just validate
    if [ "$dry_run_mode" = true ]; then
        if ! dry_run; then
            exit 1
        fi
        exit 0
    fi
    
    # Initialize deployments JSON
    local deployments_json='{'
    deployments_json+='"network": "testnet",'
    deployments_json+='"timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",'
    deployments_json+='"contracts": {'
    
    local first=true
    
    # Find and deploy all contracts
    for contract_dir in "$CONTRACTS_DIR"/*/; do
        if [ ! -d "$contract_dir" ]; then
            continue
        fi
        
        contract_name=$(basename "$contract_dir")
        
        # Build contract
        if ! wasm_file=$(build_contract "$contract_name"); then
            log_error "Skipping deployment for $contract_name due to build failure"
            continue
        fi
        
        # Deploy contract
        if ! contract_id=$(deploy_contract "$contract_name" "$wasm_file"); then
            log_error "Failed to deploy $contract_name"
            continue
        fi
        
        # Add to JSON output
        if [ "$first" = true ]; then
            first=false
        else
            deployments_json+=','
        fi
        
        deployments_json+="\"$contract_name\": \"$contract_id\""
    done
    
    deployments_json+='}}'
    
    # Save deployments
    save_deployments "$deployments_json"
    
    log_success "============================================"
    log_success "Deployment Complete!"
    log_success "============================================"
    
    # Print summary
    log_info "Deployed contracts:"
    echo "$deployments_json" | node -e "
        const data = require('fs').readFileSync('/dev/stdin', 'utf8');
        const contracts = JSON.parse(data).contracts;
        for (const [name, id] of Object.entries(contracts)) {
            console.log('  ' + name + ': ' + id);
        }
    " 2>/dev/null || cat "$OUTPUT_FILE"
    
    return 0
}

# Run main function
main "$@"