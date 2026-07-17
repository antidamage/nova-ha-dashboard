export type JsonRpcRequest = {
  id?: string | number | null;
  jsonrpc?: "2.0";
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  id: string | number | null;
  jsonrpc: "2.0";
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

export function response(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    id: id ?? null,
    jsonrpc: "2.0",
    result,
  };
}

export function errorResponse(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return {
    id: id ?? null,
    jsonrpc: "2.0",
    error: { code, message },
  };
}
