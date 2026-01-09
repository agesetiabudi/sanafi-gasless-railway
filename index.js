/**
 * Sanafi Gasless Backend - Railway Node.js
 * Uses Privy RPC API to sponsor gas fees with Privy credits
 */

const express = require('express');
const cors = require('cors');
const { PrivyClient } = require('@privy-io/server-auth');
const { Connection, Transaction } = require('@solana/web3.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Privy client
const privy = new PrivyClient(
  process.env.PRIVY_APP_ID,
  process.env.PRIVY_APP_SECRET
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    gasSponsorship: 'Privy Managed Wallet (Fee Payer)',
    privyConfigured: !!(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET),
    feePayerConfigured: !!process.env.PRIVY_FEE_PAYER_WALLET_ID,
    timestamp: new Date().toISOString(),
  });
});

// Simple endpoint: Send signed transaction with Privy gas sponsorship
app.post('/api/transfer/send-with-sponsor', async (req, res) => {
  try {
    const { signedTransaction, walletAddress } = req.body;

    if (!signedTransaction) {
      return res.status(400).json({ error: 'Missing signedTransaction' });
    }

    console.log('[Gasless] Sending transaction with Privy sponsorship');
    console.log('[Debug] User wallet:', walletAddress);

    // Use Privy's sponsored RPC endpoint
    // Format: https://rpc.privy.io/solana/{app-id}
    const privyRpcUrl = `https://rpc.privy.io/solana/${process.env.PRIVY_APP_ID}`;

    console.log('[Debug] Privy RPC URL:', privyRpcUrl);

    // Send transaction via Privy RPC (with automatic gas sponsorship)
    const response = await fetch(privyRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'privy-app-id': process.env.PRIVY_APP_ID,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          signedTransaction,
          {
            encoding: 'base64',
            preflightCommitment: 'confirmed',
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Error] Privy RPC error:', errorText);
      throw new Error(`Privy RPC error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log('[Debug] Privy RPC response:', result);

    if (result.error) {
      throw new Error(`RPC error: ${JSON.stringify(result.error)}`);
    }

    const signature = result.result;
    console.log('[Gasless] Transaction sent:', signature);
    console.log('[Gasless] Gas sponsored by Privy ($50 credit)');

    res.json({
      data: {
        signature,
        message: 'Gasless transaction sent (gas paid by Privy)',
        explorer: `https://solscan.io/tx/${signature}`,
      }
    });

  } catch (error) {
    console.error('[Error]', error);
    res.status(500).json({
      error: error.message || 'Failed to send gasless transaction',
    });
  }
});

// Main gasless transaction endpoint - Using Privy Managed Wallet as Fee Payer
app.post('/api/transfer/signed-transaction-gasless', async (req, res) => {
  try {
    const { serializedTransaction, walletAddress } = req.body;

    if (!serializedTransaction) {
      return res.status(400).json({ error: 'Missing serializedTransaction' });
    }

    if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
      return res.status(500).json({ error: 'Privy credentials not configured' });
    }

    if (!process.env.PRIVY_FEE_PAYER_WALLET_ID) {
      return res.status(500).json({
        error: 'Fee payer wallet ID not configured. Please set PRIVY_FEE_PAYER_WALLET_ID in your .env file',
        hint: 'Get the wallet ID from your Privy dashboard under Managed Wallets'
      });
    }

    console.log('[Gasless] Processing transaction with Privy managed wallet as fee payer');
    console.log('[Debug] User wallet:', walletAddress);
    console.log('[Debug] Fee payer wallet ID:', process.env.PRIVY_FEE_PAYER_WALLET_ID);

    // Deserialize the transaction
    const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));

    console.log('[Debug] Transaction instructions:', transaction.instructions.length);
    console.log('[Debug] Transaction signatures before:', transaction.signatures.length);

    // Sign the transaction with Privy's managed wallet (fee payer)
    // This uses the $50 SOL balance in your Privy managed wallet
    const signedTransaction = await privy.signSolanaTransaction(
      process.env.PRIVY_FEE_PAYER_WALLET_ID,
      transaction.serialize({ requireAllSignatures: false })
    );

    console.log('[Debug] Transaction signed by fee payer');

    // Send to Solana network
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    const rpcEndpoint = network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com';

    const connection = new Connection(rpcEndpoint, 'confirmed');

    const signature = await connection.sendRawTransaction(
      Buffer.from(signedTransaction, 'base64'),
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      }
    );

    console.log('[Gasless] Transaction sent:', signature);
    console.log('[Gasless] Gas paid by Privy managed wallet (using $50 credit)');

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    res.json({
      data: {
        signature,
        message: 'Gasless transaction sent (gas paid by Privy managed wallet)',
        explorer: `https://solscan.io/tx/${signature}${network !== 'mainnet-beta' ? '?cluster=devnet' : ''}`,
      }
    });

  } catch (error) {
    console.error('[Error]', error);
    res.status(500).json({
      error: error.message || 'Failed to process gasless transaction',
      debug: {
        appIdConfigured: !!process.env.PRIVY_APP_ID,
        appSecretConfigured: !!process.env.PRIVY_APP_SECRET,
        feePayerConfigured: !!process.env.PRIVY_FEE_PAYER_WALLET_ID,
      }
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Sanafi Gasless Backend running on port ${PORT}`);
  console.log('Gas sponsorship: Privy RPC API with sponsor: true');
});
