import type { Account } from "../data/types.js";

/** Throws a clear, user-facing error (not a crash) for an unknown accountId. */
export function findAccountOrThrow(accounts: Account[], accountId: string): Account {
  const account = accounts.find((a) => a.accountId === accountId);
  if (!account) {
    throw new Error(
      `No account found with accountId "${accountId}". Use list_accounts to see valid account IDs.`
    );
  }
  return account;
}
