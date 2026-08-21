export type TreasuryTransaction = Readonly<{
  amount: number;
  reason: string;
  balanceAfter: number;
}>;

export class TreasurySystem {
  balance: number;
  readonly transactions: TreasuryTransaction[] = [];

  constructor(startingBalance: number) {
    if (!Number.isFinite(startingBalance) || startingBalance < 0) throw new Error('invalid starting balance');
    this.balance = startingBalance;
  }

  tryDebit(amount: number, reason: string): boolean {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid debit');
    if (amount > this.balance) return false;
    this.balance -= amount;
    this.transactions.push({ amount: -amount, reason, balanceAfter: this.balance });
    return true;
  }

  credit(amount: number, reason: string): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid credit');
    this.balance += amount;
    this.transactions.push({ amount, reason, balanceAfter: this.balance });
  }

  restore(balance: number, transactions: TreasuryTransaction[]): void {
    if (!Number.isFinite(balance) || balance < 0) throw new Error('invalid treasury restore');
    this.balance = balance;
    this.transactions.length = 0;
    this.transactions.push(...transactions.map((tx) => ({ ...tx })));
  }
}
