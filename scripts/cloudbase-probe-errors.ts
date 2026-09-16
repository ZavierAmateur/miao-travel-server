interface CloudBaseErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
}

export function isMissingDocument(error: unknown): boolean {
  const { code, message } = readError(error);
  return code === "DOCUMENT_NOT_FOUND" || /document.*(not.*found|不存在)/i.test(message);
}

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
