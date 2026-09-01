export type HttpError = Error & {
  status: number;
  code: string;
  retryable: boolean;
};

export function httpError(
  status: number,
  code: string,
  message: string,
  retryable = false,
): HttpError {
  const error = new Error(message) as HttpError;
  error.name = "HttpError";
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  return error;
}

export function isHttpError(error: unknown): error is HttpError {
  return (
    error instanceof Error &&
    error.name === "HttpError" &&
    typeof (error as Partial<HttpError>).status === "number" &&
    typeof (error as Partial<HttpError>).code === "string"
  );
}
