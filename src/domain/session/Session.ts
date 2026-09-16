export interface Session {
  readonly tokenHash: string;
  readonly playerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt?: number;
}
