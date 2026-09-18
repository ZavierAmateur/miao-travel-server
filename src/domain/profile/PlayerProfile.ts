export interface PlayerProfile {
  readonly playerId: string;
  readonly nickName: string;
  readonly avatarUrl: string;
  readonly updatedAt: number;
}

export interface PutPlayerProfileInput {
  readonly nickName: string;
  readonly avatarUrl: string;
}
