/**
 * Multi-signature Transaction Client Example
 * 
 * This example demonstrates how to use the multisig coordination service
 * to create and sign multi-signature transactions on Stellar.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

// Configuration
const API_BASE_URL = 'http://localhost:3002/api/multisig';
const STELLAR_NETWORK = StellarSdk.Networks.TESTNET;
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

/**
 * Example 1: Create a 2-of-3 multisig payment transaction
 */
async function example1_CreateMultisigPayment() {
  console.log('\n=== Example 1: Create 2-of-3 Multisig Payment ===\n');

  // Setup: Three signers
  const signer1 = StellarSdk.Keypair.random();
  const signer2 = StellarSdk.Keypair.random();
  const signer3 = StellarSdk.Keypair.random();

  console.log('Signer 1:', signer1.publicKey());
  console.log('Signer 2:', signer2.publicKey());
  console.log('Signer 3:', signer3.publicKey());

  // Create a payment transaction
  const server = new StellarSdk.Horizon.Server(HORIZON_URL);
  
  // For demo purposes, using signer1 as source account
  // In production, this would be a multisig account
  const sourceAccount = await server.loadAccount(signer1.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: STELLAR_NETWORK,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: 'GDESTINATION...',
        asset: StellarSdk.Asset.native(),
        amount: '100',
      })
    )
    .setTimeout(300)
    .build();

  const envelopeXdr = transaction.toEnvelope().toXDR('base64');

  // Create multisig transaction via API
  const createResponse = await fetch(`${API_BASE_URL}/transactions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken(signer1.publicKey())}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      envelopeXdr,
      requiredSigners: [
        signer1.publicKey(),
        signer2.publicKey(),
        signer3.publicKey(),
      ],
      threshold: 2,
      memo: 'Team payment - requires 2 of 3 signatures',
      metadata: {
        purpose: 'vendor_payment',
        amount: '100 XLM',
        department: 'engineering',
      },
    }),
  });

  const { data: createData } = await createResponse.json();
  console.log('\n✅ Transaction created:', createData.transaction.id);
  console.log('Status:', createData.transaction.status);
  console.log('Signatures:', `${createData.transaction.currentSignatures}/${createData.transaction.threshold}`);

  return {
    transactionId: createData.transaction.id,
    envelopeXdr,
    signers: [signer1, signer2, signer3],
  };
}

/**
 * Example 2: Add signatures to a multisig transaction
 */
async function example2_AddSignatures(transactionId: string, envelopeXdr: string, signers: StellarSdk.Keypair[]) {
  console.log('\n=== Example 2: Add Signatures ===\n');

  // Signer 1 signs the transaction
  console.log('Signer 1 signing...');
  const tx1 = StellarSdk.TransactionBuilder.fromXDR(envelopeXdr, STELLAR_NETWORK) as StellarSdk.Transaction;
  tx1.sign(signers[0]);
  const signed1Xdr = tx1.toEnvelope().toXDR('base64');

  const sign1Response = await fetch(`${API_BASE_URL}/transactions/${transactionId}/sign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken(signers[0].publicKey())}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedEnvelopeXdr: signed1Xdr,
    }),
  });

  const { data: sign1Data } = await sign1Response.json();
  console.log('✅ Signature 1 added');
  console.log('Status:', sign1Data.transaction.status);
  console.log('Signatures:', `${sign1Data.transaction.currentSignatures}/${sign1Data.transaction.threshold}`);

  // Signer 2 signs the transaction (threshold reached!)
  console.log('\nSigner 2 signing...');
  const tx2 = StellarSdk.TransactionBuilder.fromXDR(envelopeXdr, STELLAR_NETWORK) as StellarSdk.Transaction;
  tx2.sign(signers[1]);
  const signed2Xdr = tx2.toEnvelope().toXDR('base64');

  const sign2Response = await fetch(`${API_BASE_URL}/transactions/${transactionId}/sign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken(signers[1].publicKey())}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signedEnvelopeXdr: signed2Xdr,
    }),
  });

  const { data: sign2Data } = await sign2Response.json();
  console.log('✅ Signature 2 added');
  console.log('Status:', sign2Data.transaction.status);
  console.log('Signatures:', `${sign2Data.transaction.currentSignatures}/${sign2Data.transaction.threshold}`);

  if (sign2Data.transaction.status === 'READY' || sign2Data.transaction.status === 'SUBMITTED') {
    console.log('\n🎉 Threshold reached! Transaction ready for submission.');
    if (sign2Data.transaction.stellarTxId) {
      console.log('Stellar TX ID:', sign2Data.transaction.stellarTxId);
    }
  }
}

/**
 * Example 3: Check pending transactions
 */
async function example3_CheckPendingTransactions(publicKey: string) {
  console.log('\n=== Example 3: Check Pending Transactions ===\n');

  const response = await fetch(`${API_BASE_URL}/pending`, {
    headers: {
      'Authorization': `Bearer ${getAuthToken(publicKey)}`,
    },
  });

  const { data } = await response.json();
  
  console.log(`Found ${data.transactions.length} pending transaction(s):\n`);

  for (const tx of data.transactions) {
    console.log(`Transaction ID: ${tx.id}`);
    console.log(`  Hash: ${tx.hash}`);
    console.log(`  Status: ${tx.status}`);
    console.log(`  Signatures: ${tx.currentSignatures}/${tx.threshold}`);
    console.log(`  Memo: ${tx.memo || 'N/A'}`);
    console.log(`  Created: ${new Date(tx.createdAt).toLocaleString()}`);
    if (tx.expiresAt) {
      console.log(`  Expires: ${new Date(tx.expiresAt).toLocaleString()}`);
    }
    console.log('');
  }
}

/**
 * Example 4: Monitor notifications
 */
async function example4_MonitorNotifications(publicKey: string) {
  console.log('\n=== Example 4: Monitor Notifications ===\n');

  const response = await fetch(`${API_BASE_URL}/notifications?unreadOnly=true`, {
    headers: {
      'Authorization': `Bearer ${getAuthToken(publicKey)}`,
    },
  });

  const { data } = await response.json();
  
  console.log(`Found ${data.notifications.length} unread notification(s):\n`);

  const notificationIds: string[] = [];

  for (const notification of data.notifications) {
    console.log(`[${notification.type}]`);
    console.log(`  Message: ${notification.message}`);
    console.log(`  Transaction: ${notification.multisigTransaction.id}`);
    console.log(`  Status: ${notification.multisigTransaction.status}`);
    console.log(`  Sent: ${new Date(notification.sentAt).toLocaleString()}`);
    console.log('');

    notificationIds.push(notification.id);
  }

  // Mark notifications as read
  if (notificationIds.length > 0) {
    await fetch(`${API_BASE_URL}/notifications/read`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken(publicKey)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notificationIds,
      }),
    });

    console.log('✅ Marked all notifications as read');
  }
}

/**
 * Example 5: Treasury management with expiration
 */
async function example5_TreasuryManagement() {
  console.log('\n=== Example 5: Treasury Management with Expiration ===\n');

  const cfo = StellarSdk.Keypair.random();
  const ceo = StellarSdk.Keypair.random();
  const cto = StellarSdk.Keypair.random();

  console.log('CFO:', cfo.publicKey());
  console.log('CEO:', ceo.publicKey());
  console.log('CTO:', cto.publicKey());

  // Create a high-value transaction that expires in 24 hours
  const server = new StellarSdk.Horizon.Server(HORIZON_URL);
  const sourceAccount = await server.loadAccount(cfo.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: STELLAR_NETWORK,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: 'GVENDOR...',
        asset: new StellarSdk.Asset('USDC', 'GISSUER...'),
        amount: '50000',
      })
    )
    .setTimeout(300)
    .build();

  const envelopeXdr = transaction.toEnvelope().toXDR('base64');

  // Set expiration to 24 hours from now
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const response = await fetch(`${API_BASE_URL}/transactions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken(cfo.publicKey())}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      envelopeXdr,
      requiredSigners: [
        cfo.publicKey(),
        ceo.publicKey(),
        cto.publicKey(),
      ],
      threshold: 2,
      memo: 'Q4 Vendor Payment - AWS Services',
      expiresAt: expiresAt.toISOString(),
      metadata: {
        department: 'engineering',
        budget: 'Q4-2024',
        vendor: 'AWS',
        amount: '50000 USDC',
        approvalLevel: 'executive',
      },
    }),
  });

  const { data } = await response.json();
  console.log('\n✅ Treasury transaction created:', data.transaction.id);
  console.log('Amount: 50,000 USDC');
  console.log('Requires: 2 of 3 executive signatures');
  console.log('Expires:', new Date(data.transaction.expiresAt).toLocaleString());
  console.log('\nNotifications sent to:');
  console.log('  - CFO');
  console.log('  - CEO');
  console.log('  - CTO');
}

/**
 * Example 6: Get transaction details
 */
async function example6_GetTransactionDetails(transactionId: string, publicKey: string) {
  console.log('\n=== Example 6: Get Transaction Details ===\n');

  const response = await fetch(`${API_BASE_URL}/transactions/${transactionId}`, {
    headers: {
      'Authorization': `Bearer ${getAuthToken(publicKey)}`,
    },
  });

  const { data } = await response.json();
  const tx = data.transaction;

  console.log('Transaction Details:');
  console.log('  ID:', tx.id);
  console.log('  Hash:', tx.hash);
  console.log('  Status:', tx.status);
  console.log('  Creator:', tx.creatorPublicKey);
  console.log('  Threshold:', tx.threshold);
  console.log('  Current Signatures:', tx.currentSignatures);
  console.log('  Memo:', tx.memo || 'N/A');
  console.log('  Created:', new Date(tx.createdAt).toLocaleString());
  
  if (tx.expiresAt) {
    console.log('  Expires:', new Date(tx.expiresAt).toLocaleString());
  }
  
  if (tx.submittedAt) {
    console.log('  Submitted:', new Date(tx.submittedAt).toLocaleString());
  }
  
  if (tx.stellarTxId) {
    console.log('  Stellar TX:', tx.stellarTxId);
  }

  console.log('\n  Required Signers:');
  tx.requiredSigners.forEach((signer: string, index: number) => {
    const hasSigned = tx.signatures.some((sig: any) => sig.signerPublicKey === signer);
    console.log(`    ${index + 1}. ${signer} ${hasSigned ? '✅' : '⏳'}`);
  });

  if (tx.metadata && Object.keys(tx.metadata).length > 0) {
    console.log('\n  Metadata:');
    Object.entries(tx.metadata).forEach(([key, value]) => {
      console.log(`    ${key}: ${value}`);
    });
  }
}

/**
 * Example 7: Manual submission
 */
async function example7_ManualSubmission(transactionId: string, publicKey: string) {
  console.log('\n=== Example 7: Manual Submission ===\n');

  console.log('Manually submitting transaction...');

  const response = await fetch(`${API_BASE_URL}/transactions/${transactionId}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken(publicKey)}`,
    },
  });

  if (response.ok) {
    const { data } = await response.json();
    console.log('✅ Transaction submitted successfully!');
    console.log('Status:', data.transaction.status);
    console.log('Stellar TX ID:', data.transaction.stellarTxId);
  } else {
    const { message } = await response.json();
    console.log('❌ Submission failed:', message);
  }
}

/**
 * Helper function to get auth token (mock implementation)
 */
function getAuthToken(publicKey: string): string {
  // In a real application, this would return a valid JWT token
  // For demo purposes, returning a mock token
  return `mock_token_for_${publicKey.substring(0, 8)}`;
}

/**
 * Run all examples
 */
async function runExamples() {
  try {
    // Example 1: Create multisig transaction
    const { transactionId, envelopeXdr, signers } = await example1_CreateMultisigPayment();

    // Example 2: Add signatures
    await example2_AddSignatures(transactionId, envelopeXdr, signers);

    // Example 3: Check pending transactions
    await example3_CheckPendingTransactions(signers[2].publicKey());

    // Example 4: Monitor notifications
    await example4_MonitorNotifications(signers[0].publicKey());

    // Example 5: Treasury management
    await example5_TreasuryManagement();

    // Example 6: Get transaction details
    await example6_GetTransactionDetails(transactionId, signers[0].publicKey());

    // Example 7: Manual submission (if needed)
    // await example7_ManualSubmission(transactionId, signers[0].publicKey());

    console.log('\n✅ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}

export {
  example1_CreateMultisigPayment,
  example2_AddSignatures,
  example3_CheckPendingTransactions,
  example4_MonitorNotifications,
  example5_TreasuryManagement,
  example6_GetTransactionDetails,
  example7_ManualSubmission,
};
