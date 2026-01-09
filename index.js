/**
 * Sanafi Gasless Backend - Railway Node.js
 * Uses Privy RPC API to sponsor gas fees with Privy credits
 */

const express = require('express');
const cors = require('cors');
const { PrivyClient } = require('@privy-io/server-auth');
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
    gasSponsorship: 'Privy RPC API with sponsor: true',
    privyConfigured: !!(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET),
    timestamp: new Date().toISOString(),
  });
});

// Main gasless transaction endpoint
app.post('/api/transfer/signed-transaction-gasless', async (req, res) => {
  try {
    const { signedTx } = req.body;

    if (!signedTx || !Array.isArray(signedTx) || signedTx.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid signedTx array' });
    }

    if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
      return res.status(500).json({ error: 'Privy credentials not configured' });
    }

    console.log('[Gasless] Processing', signedTx.length, 'transactions via Privy RPC');

    const signatures = [];

    // Process each signed transaction
    for (const signedTxBase64 of signedTx) {
      try {
        // Send to Privy API with sponsor: true
        const privyRpcUrl = `https://api.privy.io/v1/solana/rpc/${process.env.PRIVY_APP_ID}`;

        const response = await fetch(privyRpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString('base64')}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: [
              signedTxBase64,
              {
                encoding: 'base64',
                skipPreflight: true,
                maxRetries: 3,
                sponsor: true, // Enable gas sponsorship with Privy credits
              }
            ]
          })
        });

        // Check if response is OK
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Gasless] Privy RPC HTTP error:', response.status, errorText);
          throw new Error(`Privy RPC HTTP ${response.status}: ${errorText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const errorText = await response.text();
          console.error('[Gasless] Non-JSON response from Privy:', errorText);
          throw new Error(`Privy returned non-JSON response: ${errorText}`);
        }

        const result = await response.json();

        if (result.error) {
          throw new Error(result.error.message || JSON.stringify(result.error));
        }

        const signature = result.result;
        console.log('[Gasless] Transaction sent via Privy:', signature);
        signatures.push(signature);

      } catch (txError) {
        console.error('[Gasless] Transaction error:', txError);
        throw new Error(`Transaction failed: ${txError.message}`);
      }
    }

    res.json({
      data: {
        signatures,
        count: signatures.length,
        message: 'Gasless transactions sent via Privy RPC (using Privy credits)',
      }
    });

  } catch (error) {
    console.error('[Gasless] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process gasless transaction' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Sanafi Gasless Backend running on port ${PORT}`);
  console.log('Gas sponsorship: Privy RPC API with sponsor: true');
});
