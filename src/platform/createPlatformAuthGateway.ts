import { PlatformKind, type AppConfig } from "../config/AppConfig.js";
import { BytedanceAuthGateway } from "./BytedanceAuthGateway.js";
import type { PlatformAuthGateway } from "./PlatformAuthGateway.js";
import { WechatAuthGateway } from "./WechatAuthGateway.js";

export function createPlatformAuthGateway(config: AppConfig): PlatformAuthGateway {
  switch (config.platform) {
    case PlatformKind.WeChat:
      return new WechatAuthGateway(config.appId, config.appSecret);
    case PlatformKind.ByteDance:
      return new BytedanceAuthGateway(config.appId, config.appSecret);
  }
}
