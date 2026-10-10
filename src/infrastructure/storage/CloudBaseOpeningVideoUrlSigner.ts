import cloudbase from "@cloudbase/js-sdk";
import type { OpeningVideoUrlSigner } from "../../domain/video/OpeningVideoUrlService.js";

/**
 * 使用后端既有 CloudBase API Key 读取私有文件；该 Key 只保留在服务端。
 * 临时地址只返回给通过游戏会话鉴权的玩家，绝不把 Key 下发给客户端。
 */
export class CloudBaseOpeningVideoUrlSigner implements OpeningVideoUrlSigner {
  private readonly app: ReturnType<typeof cloudbase.init>;

  constructor(envId: string, region: string, accessKey: string) {
    this.app = cloudbase.init({ env: envId, region, accessKey, timeout: 5_000 });
  }

  async getTemporaryUrl(fileId: string): Promise<string> {
    const result = await this.app.getTempFileURL({ fileList: [fileId] });
    const file = result.fileList?.[0];
    if (!file?.tempFileURL || (file.code && file.code !== "SUCCESS")) {
      throw new Error(file?.message || result.message || "CloudBase 未返回视频临时地址");
    }
    return file.tempFileURL;
  }
}
