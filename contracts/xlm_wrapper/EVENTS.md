# XLM Wrapper Events

| Event topic | Data | Emitted when |
| --- | --- | --- |
| `init` | `(admin, token, name, symbol, native_asset)` | The wrapper is initialized. |
| `deposit`, `from` | `amount` | Native XLM is deposited and wrapped. |
| `withdraw`, `from` | `amount` | Wrapped XLM is burned and native XLM released. |
| `unwrap`, `from` | `amount` | Wrapped XLM is unwrapped: burned and released as native XLM. |
| `transfer`, `from`, `to` | `amount` | Tokens are transferred. |
| `approve`, `owner`, `spender` | `amount` | Allowance changes. |
| `dec_allow`, `inc_allow`, `app_all`, `xfer_from`, `burn` | Operation-specific values | Token approvals, delegated transfers, or burns occur. |
| Authorization, trustline, cap, pause events | See `src/lib.rs` | Administrative configuration changes. |
