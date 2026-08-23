import NextAuth from '@/lib/auth';

// Route API NextAuth — Next.js App Router.
// NextAuth v4 expose un handler unique ; on l'exporte sous GET et POST.
const handler = NextAuth;

export { handler as GET, handler as POST };