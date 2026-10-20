export interface PlayerProfile {
  readonly playerId: string;
  readonly nickName: string;
  readonly avatarUrl: string;
  readonly updatedAt: number;
  readonly leaderboardSyncPending?: boolean;
}

export interface PutPlayerProfileInput {
  readonly nickName: string;
  readonly avatarUrl: string;
}
