import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { 
  ContractPlayground, 
  validateArg, 
  parseContractSpec, 
  PRESET_CONTRACTS 
} from './ContractPlayground';

describe('ContractPlayground - Interactive Soroban Contract Method Caller UI', () => {
  describe('validateArg', () => {
    it('validates Stellar Address correctly', () => {
      const validAddress = 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSW4WQHIFRHZSXO';
      expect(validateArg('Address', validAddress).isValid).toBe(true);

      const invalidAddress = 'invalid-address-123';
      expect(validateArg('Address', invalidAddress).isValid).toBe(false);
      expect(validateArg('Address', invalidAddress).error).toContain('Stellar Address');
    });

    it('validates i128 correctly', () => {
      expect(validateArg('i128', '10000000').isValid).toBe(true);
      expect(validateArg('i128', '-500').isValid).toBe(true);
      expect(validateArg('i128', 'abc').isValid).toBe(false);
      expect(validateArg('i128', '12.34').isValid).toBe(false);
    });

    it('validates Symbol correctly', () => {
      expect(validateArg('Symbol', 'USDC').isValid).toBe(true);
      expect(validateArg('Symbol', 'liquidation_vault').isValid).toBe(true);
      expect(validateArg('Symbol', 'Too Long Symbol That Exceeds The Maximum Thirty Two Characters Allowed').isValid).toBe(false);
      expect(validateArg('Symbol', 'bad symbol with spaces').isValid).toBe(false);
    });

    it('validates Bytes correctly', () => {
      expect(validateArg('Bytes', '0x12abef').isValid).toBe(true);
      expect(validateArg('Bytes', 'aGVsbG8gd29ybGQ=').isValid).toBe(true);
      expect(validateArg('Bytes', 'not_hex_or_base64!@#').isValid).toBe(false);
    });
  });

  describe('parseContractSpec', () => {
    it('parses valid contract spec JSON', () => {
      const json = JSON.stringify({
        id: 'test-contract',
        name: 'Test Contract',
        contractAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        methods: [
          {
            name: 'foo',
            inputs: [{ name: 'bar', type: 'Symbol' }],
            returnType: '()'
          }
        ]
      });

      const parsed = parseContractSpec(json);
      expect(parsed.id).toBe('test-contract');
      expect(parsed.methods).toHaveLength(1);
      expect(parsed.methods[0].name).toBe('foo');
    });

    it('throws error on invalid contract spec JSON', () => {
      expect(() => parseContractSpec('{"name": "No Address"}')).toThrow();
    });
  });

  describe('ContractPlayground component UI & Form Generation', () => {
    it('renders preset contract and initial method inputs dynamically', () => {
      render(<ContractPlayground />);

      expect(screen.getByTestId('soroban-contract-playground')).toBeInTheDocument();
      // Default method is 'balance' which has 'id' of type 'Address'
      expect(screen.getByTestId('param-group-id')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-id')).toHaveTextContent('Address');
      expect(screen.getByTestId('param-input-id')).toBeInTheDocument();
    });

    it('dynamically switches generated input fields when changing method to transfer (Address, Address, i128)', () => {
      render(<ContractPlayground />);

      const methodSelect = screen.getByTestId('method-select');
      fireEvent.change(methodSelect, { target: { value: 'transfer' } });

      // Method 'transfer' takes from (Address), to (Address), amount (i128)
      expect(screen.getByTestId('param-group-from')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-from')).toHaveTextContent('Address');

      expect(screen.getByTestId('param-group-to')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-to')).toHaveTextContent('Address');

      expect(screen.getByTestId('param-group-amount')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-amount')).toHaveTextContent('i128');
    });

    it('dynamically generates form controls for Symbol and Bytes when selecting a contract method with them', () => {
      render(<ContractPlayground />);

      // Switch contract to Liquidation Vault
      const contractSelect = screen.getByTestId('contract-select');
      fireEvent.change(contractSelect, { target: { value: 'liquidation-vault' } });

      // Switch method to update_oracle_price: asset (Symbol), price_stroop (i128), signature_bytes (Bytes)
      const methodSelect = screen.getByTestId('method-select');
      fireEvent.change(methodSelect, { target: { value: 'update_oracle_price' } });

      expect(screen.getByTestId('param-group-asset')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-asset')).toHaveTextContent('Symbol');

      expect(screen.getByTestId('param-group-price_stroop')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-price_stroop')).toHaveTextContent('i128');

      expect(screen.getByTestId('param-group-signature_bytes')).toBeInTheDocument();
      expect(screen.getByTestId('param-type-signature_bytes')).toHaveTextContent('Bytes');
    });

    it('populates wallet address when clicking Paste My Wallet', () => {
      const myWallet = 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSW4WQHIFRHZSXO';
      render(<ContractPlayground defaultWalletAddress={myWallet} />);

      const pasteBtn = screen.getByTestId('fill-wallet-id');
      fireEvent.click(pasteBtn);

      const input = screen.getByTestId('param-input-id') as HTMLInputElement;
      expect(input.value).toBe(myWallet);
    });

    it('displays error and halts execution if argument validation fails', async () => {
      render(<ContractPlayground />);

      const invokeBtn = screen.getByTestId('invoke-method-btn');
      fireEvent.click(invokeBtn);

      // Value was empty
      expect(await screen.findByText(/value is required/i)).toBeInTheDocument();
    });

    it('executes method and displays execution telemetry, return value, and emitted events', async () => {
      const mockExecute = vi.fn().mockResolvedValue({
        status: 'SUCCESS',
        method: 'balance',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        returnValue: '500000000',
        cpuInstructions: 32000,
        memoryBytes: 1400,
        events: [
          {
            topic: ['balance_queried'],
            data: { account: 'GA2C...ZSXO', balance: '500000000' },
            timestamp: new Date().toISOString()
          }
        ]
      });

      render(<ContractPlayground onExecuteMethod={mockExecute} />);

      // Fill in valid address
      const input = screen.getByTestId('param-input-id');
      fireEvent.change(input, { 
        target: { value: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2ZVOUSW4WQHIFRHZSXO' } 
      });

      const invokeBtn = screen.getByTestId('invoke-method-btn');
      fireEvent.click(invokeBtn);

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalled();
      });

      expect(screen.getByTestId('execution-status-badge')).toHaveTextContent('SUCCESS');
      expect(screen.getByTestId('return-value-display')).toHaveTextContent('500000000');
      expect(screen.getByTestId('events-log')).toHaveTextContent('balance_queried');
    });
  });
});
