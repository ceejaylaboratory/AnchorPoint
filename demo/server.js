const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Mock SEP-1 info
app.get('/info', (req, res) => {
  res.json({
    deposit: {
      USDC: {
        enabled: true,
        authentication_required: true,
        min_amount: 1,
      }
    },
    withdraw: {
      USDC: {
        enabled: true,
        authentication_required: true,
        min_amount: 1,
      }
    },
    fee: {
      enabled: false
    },
    transactions: {
      enabled: true
    }
  });
});

// Mock SEP-24 Deposit
app.post('/transactions/deposit/interactive', (req, res) => {
  const { asset_code, account } = req.body;
  console.log(`Deposit requested for ${asset_code} by ${account}`);
  
  res.json({
    type: "interactive_customer_info_needed",
    url: `http://localhost:3001/mock-kyc?account=${account}&asset=${asset_code}&type=deposit`,
    id: "tx_" + Math.random().toString(36).substr(2, 9)
  });
});

// Mock SEP-24 Withdraw
app.post('/transactions/withdraw/interactive', (req, res) => {
  const { asset_code, account } = req.body;
  console.log(`Withdraw requested for ${asset_code} by ${account}`);

  res.json({
    type: "interactive_customer_info_needed",
    url: `http://localhost:3001/mock-kyc?account=${account}&asset=${asset_code}&type=withdraw`,
    id: "tx_" + Math.random().toString(36).substr(2, 9)
  });
});

// Mock Transaction History
app.get('/transactions', (req, res) => {
  res.json({
    transactions: [
      {
        id: "tx_1",
        kind: "deposit",
        status: "completed",
        amount_in: "100.00",
        amount_out: "99.00",
        amount_fee: "1.00",
        started_at: new Date(Date.now() - 86400000).toISOString(),
        completed_at: new Date(Date.now() - 86000000).toISOString(),
        external_extra_text: "Bank Transfer Received",
      },
      {
        id: "tx_2",
        kind: "withdrawal",
        status: "pending_user_transfer_start",
        amount_in: "50.00",
        amount_out: "49.50",
        amount_fee: "0.50",
        started_at: new Date().toISOString(),
      }
    ]
  });
});

// Mock KYC page
app.get('/mock-kyc', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white;">
        <h1>Mock KYC / Interactive Flow</h1>
        <p>This path simulates the Anchor's hosted webview for SEP-24.</p>
        <button onclick="window.close()" style="padding: 10px 20px; cursor: pointer; background: #3b82f6; border: none; color: white; border-radius: 5px;">
          Complete and Close
        </button>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Mock Anchor Server running at http://localhost:${PORT}`);
});
