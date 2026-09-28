export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function readErrorStatus(err: unknown): { status?: number; message: string } {
  if (typeof err === 'object' && err !== null) {
    const candidate = err as {
      code?: number | string;
      message?: string;
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    const status =
      candidate.response?.status ?? (typeof candidate.code === 'number' ? candidate.code : undefined);
    const message =
      candidate.response?.data?.error?.message || candidate.message || 'Request failed';
    return { status, message };
  }
  return { message: 'Request failed' };
}
