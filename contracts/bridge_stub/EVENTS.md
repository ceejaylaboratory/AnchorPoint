# Bridge Stub Events

| Topic | Data | Emitted when |
| --- | --- | --- |
| `br_init` | `(admin, bridge_token, relayer, relayer_key)` | The bridge stub is initialized. |
| `br_burn` | Destination recipient (user, amount, destination chain are topics) | Tokens are burned for an outbound bridge transfer. |
| `br_mint` | `(nonce)` (recipient, amount, source chain are topics) | A relayer mints an inbound bridge transfer after the signature, chain ID, contract address, and per-user nonce are verified. |

## Errors

| Error | Returned when |
| --- | --- |
| `Error::InvalidNonce` | The supplied nonce is not exactly `current_nonce + 1` for the recipient. |
| `Error::SignatureAlreadyUsed` | The claim ID has already been consumed, so the signature is a replay. |
