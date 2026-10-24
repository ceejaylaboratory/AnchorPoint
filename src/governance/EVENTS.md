# Governance Events

| Topic | Data | Emitted when |
| --- | --- | --- |
| `gov_init` | `(admin, token_contract)` | Governance is initialized. |
| `gov/prop_adm`, `gov/new_adm` | Old/new administrator values | Admin succession is proposed or accepted. |
| `gov/credits` | User and credit amount | Governance credits are allocated. |
| `gov/quorum` | Admin and minimum quorum in basis points (`u32`) | The minimum quorum changes. |
| `created` | `(proposal_id, creator, title)` | A proposal is created. |
| `voted` | `(proposal_id, voter, support, votes)` | A vote is recorded. |
| `executed` | `(proposal_id, executor)` | A proposal is executed. |
