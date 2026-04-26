#!/bin/bash
set -e

echo "Starting Soroban Wasm Security Audit..."

if ! command -v find &> /dev/null; then
    echo "Error: 'find' command is required."
    exit 1
fi

WASM_COUNT=$(find target -name "*.wasm" 2>/dev/null | wc -l || echo 0)
if [ "$WASM_COUNT" -eq 0 ]; then
    WASM_COUNT=$(find . -name "*.wasm" 2>/dev/null | wc -l || echo 0)
fi

if [ "$WASM_COUNT" -eq 0 ]; then
    echo "No Wasm files found. Please ensure the project is built before running the audit."
    exit 0
fi

echo "Found Wasm files:"
find target -name "*.wasm" 2>/dev/null || find . -name "*.wasm" 2>/dev/null

if command -v soroban-analyzer &> /dev/null; then
    echo "Running soroban-analyzer..."
    # SC2044 avoidance by using while read -r
    (find target -name "*.wasm" 2>/dev/null || find . -name "*.wasm" 2>/dev/null) | while read -r file; do
        if [ -n "$file" ]; then
            echo "Analyzing $file..."
            soroban-analyzer "$file"
        fi
    done
else
    echo "Warning: 'soroban-analyzer' is not installed or available in PATH."
    echo "Skipping dedicated Wasm static analysis."
fi

echo "Checking for suspicious patterns in Rust source files..."

if grep -rn "unsafe {" src/ contracts/ > /dev/null 2>&1; then
    echo "Warning: 'unsafe' blocks found in source files. Please review for potential vulnerabilities."
fi

if grep -rn "env.panic" src/ contracts/ > /dev/null 2>&1; then
    echo "Warning: 'env.panic' usages found. Review panic conditions to prevent DoS or reentrancy issues."
fi

echo "Security audit completed successfully."
