import jwt from 'jsonwebtoken';

export interface VerifiedToken {
  sub: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'stellar-anchor-secret';

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.split(' ')[1];
  return token || null;
};

export const signToken = (publicKey: string): string => {
  // SEP-10 convention (and how our middleware uses it):
  // the user's public key is stored in the JWT `sub` claim.
  return jwt.sign({ sub: publicKey }, JWT_SECRET);
};

export const verifyToken = (token: string): VerifiedToken => {
  const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
  if (!decoded?.sub) throw new Error('Invalid token payload');
  return { sub: decoded.sub };
};

