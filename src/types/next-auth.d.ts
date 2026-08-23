import 'next-auth';
import { DefaultSession } from 'next-auth';

// Extension des types NextAuth pour exposer `user.id` dans la session
// et `token.id` dans le JWT.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
  }
}