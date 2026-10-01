#!/usr/bin/env bash
set -euo pipefail

# WASM Code Size Optimization & Unused Export Stripping Script
# Minimizes final compiled contract binary size (< 100KB / 102,400 bytes).

MAX_SIZE_BYTES=${MAX_WASM_SIZE:-102400}
TARGET_DIR="${1:-target}"

echo "==> Running WASM Optimization & Size Threshold Checks..."
echo "    Target search directory: $TARGET_DIR"
echo "    Max binary size threshold: $MAX_SIZE_BYTES bytes (100KB)"

WASM_FILES=$(find "$TARGET_DIR" -type f -name "*.wasm" ! -name "*-opt.wasm" 2>/dev/null || true)

if [ -z "$WASM_FILES" ]; then
    echo "No .wasm files found in $TARGET_DIR. Skipping optimization pass."
    exit 0
fi

FAILED=0

for WASM_FILE in $WASM_FILES; do
    INITIAL_SIZE=$(stat -c%s "$WASM_FILE" 2>/dev/null || stat -f%z "$WASM_FILE" 2>/dev/null || wc -c < "$WASM_FILE")
    echo "Processing WASM: $WASM_FILE (Original size: ${INITIAL_SIZE} bytes)"

    if command -v wasm-opt >/dev/null 2>&1; then
        OPT_FILE="${WASM_FILE%.wasm}-opt.wasm"
        echo "  Applying wasm-opt -Oz pass & unused export/debug stripping..."
        if wasm-opt -Oz --strip-debug --strip-dwarf "$WASM_FILE" -o "$OPT_FILE" 2>/dev/null || wasm-opt -Oz "$WASM_FILE" -o "$OPT_FILE"; then
            mv "$OPT_FILE" "$WASM_FILE"
            FINAL_SIZE=$(stat -c%s "$WASM_FILE" 2>/dev/null || stat -f%z "$WASM_FILE" 2>/dev/null || wc -c < "$WASM_FILE")
            echo "  Optimized size: ${FINAL_SIZE} bytes"
        else
            echo "  Warning: wasm-opt failed on $WASM_FILE, using unoptimized binary."
            FINAL_SIZE=$INITIAL_SIZE
        fi
    else
        echo "  Notice: wasm-opt command not available in environment. Skipping wasm-opt pass."
        FINAL_SIZE=$INITIAL_SIZE
    fi

    if [ "$FINAL_SIZE" -gt "$MAX_SIZE_BYTES" ]; then
        echo "❌ ERROR: $WASM_FILE size (${FINAL_SIZE} bytes) exceeds maximum threshold (${MAX_SIZE_BYTES} bytes / 100KB)"
        FAILED=1
    else
        echo "✅ PASS: $WASM_FILE size (${FINAL_SIZE} bytes) is within threshold (< 100KB)"
    fi
done

if [ $FAILED -ne 0 ]; then
    echo "❌ WASM size threshold check failed for one or more binaries."
    exit 1
fi

echo "✅ All WASM optimization & size threshold checks passed successfully!"
