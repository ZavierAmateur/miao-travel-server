import type { PlatformKind } from "../../config/AppConfig.js";

export const PlayerStatus = Object.freeze({
  Active: "active",
  Banned: "banned",
} as const);

export type PlayerStatus = typeof PlayerStatus[keyof typeof PlayerStatus];

export interface Player {
  readonly id: string;
  readonly platform: PlatformKind;
  readonly appId: string;
  readonly platformOpenId: string;
  readonly unionId?: string;
  readonly status: PlayerStatus;
  readonly createdAt: number;
  readonly lastLoginAt: number;
  readonly banReason?: string;
  readonly banExpiresAt?: number;
  readonly bannedAt?: number;
  readonly bannedBy?: string;
}

export function isPlayerBanActive(player: Player, now: number): boolean {
  return player.status === PlayerStatus.Banned
    && (!player.banExpiresAt || player.banExpiresAt > now);
}
