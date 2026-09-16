interface CloudBaseErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
}

/** CloudBase HTTP API 在按主键读取空文档时会抛错，而不是返回空 data。 */
export function isMissingDocument(error: unknown): boolean {
  const { code, message } = readError(error);
  return code === "DOCUMENT_NOT_FOUND" || /document.*(not.*found|不存在)/i.test(message);
}

/** 区分集合不存在与集合内文档不存在，避免把权限或网络错误误判为空集合。 */
export function isMissingCollection(error: unknown): boolean {
  const { code, message } = readError(error);
  if (code === "DOCUMENT_NOT_FOUND") return false;
  return /collection.*(not.*exist|not.*found|不存在)/i.test(`${code} ${message}`);
}

function readError(error: unknown): { code: string; message: string } {
  if (typeof error !== "object" || error === null) return { code: "", message: "" };
  const candidate = error as CloudBaseErrorLike;
  return {
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
  };
}
