/** An error with an HTTP status the plugin can pass straight through. */
export class ReviewError extends Error {
  status: number;
  details?: string[];
  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.name = 'ReviewError';
    this.status = status;
    this.details = details;
  }
}
