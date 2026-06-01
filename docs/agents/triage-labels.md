# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in skills | Label in our tracker | Meaning                                  |
| --------------- | -------------------- | ---------------------------------------- |
| `needs-triage`  | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`    | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`  | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`  | Requires human implementation            |
| `wontfix`       | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Agent capability boundary

`ready-for-agent` applies to **all** issue types — including those requiring visual verification or specific hardware/OS environments. The boundary is:

- **Agent CAN**: write code, submit a PR for any issue
- **Agent CANNOT**: visually verify UI fixes, test on specific hardware/OS configs
- **Rule**: after a `ready-for-agent` issue is resolved by code, a human must verify and close it. The triage skill should note this requirement in the issue description when the issue involves visual or hardware-dependent behavior.
