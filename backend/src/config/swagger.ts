import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AnchorPoint API',
      version: '1.0.0',
      description: 'AnchorPoint Backend API for Stellar SEP-24 Anchor Operations',
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      contact: {
        name: 'AnchorPoint Support',
        url: 'https://github.com/ceejaylaboratory/AnchorPoint',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authorization token obtained from /auth/token endpoint',
        },
      },
      schemas: {
        Transaction: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Transaction unique identifier',
            },
            userPublicKey: {
              type: 'string',
              description: 'User Stellar public key',
            },
            assetCode: {
              type: 'string',
              description: 'Asset code (e.g., USD, EUR)',
            },
            amount: {
              type: 'string',
              description: 'Transaction amount',
            },
            kind: {
              type: 'string',
              enum: ['deposit', 'withdrawal'],
              description: 'Transaction type',
            },
            status: {
              type: 'string',
              description: 'Transaction status',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Transaction creation timestamp',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Transaction update timestamp',
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: {
              type: 'integer',
              description: 'Total number of items',
            },
            page: {
              type: 'integer',
              description: 'Current page number',
            },
            limit: {
              type: 'integer',
              description: 'Number of items per page',
            },
            totalPages: {
              type: 'integer',
              description: 'Total number of pages',
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'error',
            },
            message: {
              type: 'string',
              description: 'Error message',
            },
          },
        },
        SepError: {
          type: 'object',
          description: 'Error body returned by Stellar SEP endpoints',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
          },
          required: ['error'],
        },
        Challenge: {
          type: 'object',
          properties: {
            transaction: {
              type: 'string',
              description: 'SEP-10 challenge transaction XDR',
            },
            network_passphrase: {
              type: 'string',
              description: 'Stellar network passphrase',
            },
          },
        },
        TokenResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'JWT authentication token',
            },
          },
        },
        Job: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            jobId: {
              type: 'string',
            },
            type: {
              type: 'string',
            },
            priority: {
              type: 'string',
              enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
            },
            status: {
              type: 'string',
              enum: ['PENDING', 'ACTIVE', 'COMPLETED', 'FAILED', 'DELAYED', 'RETRYING'],
            },
            contractId: {
              type: 'string',
            },
            functionName: {
              type: 'string',
            },
            parameters: {
              type: 'object',
            },
            result: {
              type: 'object',
            },
            error: {
              type: 'string',
            },
            attempts: {
              type: 'integer',
            },
            maxAttempts: {
              type: 'integer',
            },
            createdBy: {
              type: 'string',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            startedAt: {
              type: 'string',
              format: 'date-time',
            },
            completedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        MultisigTransaction: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            hash: {
              type: 'string',
            },
            envelopeXdr: {
              type: 'string',
            },
            creatorPublicKey: {
              type: 'string',
            },
            requiredSigners: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            threshold: {
              type: 'integer',
            },
            currentSignatures: {
              type: 'integer',
            },
            status: {
              type: 'string',
              enum: ['PENDING', 'PARTIALLY_SIGNED', 'READY', 'SUBMITTED', 'FAILED', 'EXPIRED'],
            },
            signatures: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  signerPublicKey: {
                    type: 'string',
                  },
                  signedAt: {
                    type: 'string',
                    format: 'date-time',
                  },
                },
              },
            },
            memo: {
              type: 'string',
            },
            expiresAt: {
              type: 'string',
              format: 'date-time',
            },
            submittedAt: {
              type: 'string',
              format: 'date-time',
            },
            stellarTxId: {
              type: 'string',
            },
            metadata: {
              type: 'object',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Sep1Info: {
          type: 'object',
          description: 'SEP-1 anchor information (stellar.toml equivalent)',
          properties: {
            version: {
              type: 'string',
              description: 'Info version',
            },
            network: {
              type: 'string',
              description: 'Stellar network (e.g., public, testnet)',
            },
            federation_server: {
              type: 'string',
              description: 'Federation server URL',
            },
            auth_server: {
              type: 'string',
              description: 'Authentication server URL',
            },
            kyc_server: {
              type: 'string',
              description: 'KYC server URL',
            },
            web_auth_endpoint: {
              type: 'string',
              description: 'SEP-10 web authentication endpoint',
            },
            transfer_server: {
              type: 'string',
              description: 'SEP-6 transfer server URL',
            },
            transfer_server_sep24: {
              type: 'string',
              description: 'SEP-24 transfer server URL',
            },
            deposit_server: {
              type: 'string',
              description: 'Deposit server URL',
            },
            withdrawal_server: {
              type: 'string',
              description: 'Withdrawal server URL',
            },
            accounts: {
              type: 'object',
              properties: {
                receiving: {
                  type: 'string',
                  description: 'Receiving Stellar account public key',
                },
                distribution: {
                  type: 'string',
                  description: 'Distribution Stellar account public key',
                },
              },
            },
            assets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  issuer: { type: 'string' },
                  status: { type: 'string' },
                  is_asset_anchored: { type: 'boolean' },
                  anchored_asset_type: { type: 'string' },
                  desc: { type: 'string' },
                  max_amount: { type: 'string' },
                  min_amount: { type: 'string' },
                  fee_fixed: { type: 'number' },
                  fee_percent: { type: 'number' },
                  fee_minimum: { type: 'number' },
                },
              },
            },
            signing_key: {
              type: 'string',
              description: 'Stellar signing key',
            },
            horizon_url: {
              type: 'string',
              description: 'Horizon server URL',
            },
            url: {
              type: 'string',
              description: 'Anchor home URL',
            },
          },
        },
        ContractEvent: {
          type: 'object',
          description: 'A indexed Stellar smart-contract event',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Database record ID',
            },
            contractId: {
              type: 'string',
              description: 'Stellar contract address',
            },
            ledger: {
              type: 'integer',
              description: 'Ledger sequence number',
            },
            ledgerClosedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Ledger close timestamp',
            },
            txHash: {
              type: 'string',
              description: 'Transaction hash',
            },
            contractEventId: {
              type: 'string',
              description: 'Unique event ID from Soroban RPC',
            },
            topics: {
              type: 'string',
              description: 'JSON-stringified event topics',
            },
            value: {
              type: 'string',
              description: 'JSON-stringified event value',
            },
            type: {
              type: 'string',
              description: 'Event type (e.g., contract)',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Record creation timestamp',
            },
          },
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Transactions',
        description: 'Transaction history and management',
      },
      {
        name: 'SEP-10 Authentication',
        description: 'Stellar SEP-10 authentication endpoints',
      },
      {
        name: 'SEP-24',
        description: 'Stellar SEP-24 deposit and withdrawal operations',
      },
      {
        name: 'SEP-1 Info',
        description: 'Stellar SEP-1 anchor info endpoint',
      },
      {
        name: 'Info',
        description: 'Stellar SEP-1 anchor information',
      },
      {
        name: 'Events',
        description: 'Indexed smart-contract events',
      },
      {
        name: 'SEP-6',
        description: 'Stellar SEP-6 non-interactive deposit and withdrawal',
      },
      {
        name: 'SEP-12',
        description: 'Stellar SEP-12 KYC customer information',
      },
      {
        name: 'SEP-31',
        description: 'Stellar SEP-31 cross-border payments',
      },
      {
        name: 'SEP-38',
        description: 'Stellar SEP-38 anchor RFQ price quotes',
      },
      {
        name: 'SEP-40',
        description: 'Stellar SEP-40 swap rates',
      },
    ],
  },
  apis: ['./src/api/routes/*.ts', './src/index.ts'],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);