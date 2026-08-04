export interface AuthenticatedIdentity {
  issuer: string;
  subject: string;
}

declare global {
  namespace Express {
    interface Request {
      identity?: AuthenticatedIdentity;
    }
  }
}

export {};
