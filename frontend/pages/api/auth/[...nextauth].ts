import NextAuth, { type NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';

type CommentAuthSettings = {
  github_client_id?: string;
  github_client_secret?: string;
  google_client_id?: string;
  google_client_secret?: string;
  nextauth_secret?: string;
};

async function getCommentAuthSettings(): Promise<CommentAuthSettings> {
  try {
    const response = await fetch(`${API_URL}/api/settings/comments`, {
      headers: INTERNAL_API_TOKEN
        ? {
            'X-Internal-Token': INTERNAL_API_TOKEN,
          }
        : undefined,
    });
    if (response.ok) {
      return response.json();
    }
  } catch (error) {
    // ignore and fallback to env
  }
  return {
    github_client_id: process.env.GITHUB_ID,
    github_client_secret: process.env.GITHUB_SECRET,
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    nextauth_secret: process.env.NEXTAUTH_SECRET,
  };
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const settings = await getCommentAuthSettings();
  const providers = [];

  if (settings.github_client_id && settings.github_client_secret) {
    providers.push(
      GithubProvider({
        clientId: settings.github_client_id,
        clientSecret: settings.github_client_secret,
      }),
    );
  }

  if (settings.google_client_id && settings.google_client_secret) {
    providers.push(
      GoogleProvider({
        clientId: settings.google_client_id,
        clientSecret: settings.google_client_secret,
      }),
    );
  }

  if (providers.length === 0) {
    providers.push(
      CredentialsProvider({
        name: 'disabled',
        credentials: {},
        async authorize() {
          return null;
        },
      }),
    );
  }

  return {
    providers,
    session: {
      strategy: 'jwt',
    },
    callbacks: {
      async jwt({ token, account }) {
        if (account?.provider) {
          token.provider = account.provider;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.sub || '';
          session.user.provider = (token.provider as string) || '';
        }
        return session;
      },
    },
    secret: settings.nextauth_secret || process.env.NEXTAUTH_SECRET,
  };
}

export default async function auth(req: any, res: any) {
  const authOptions = await getAuthOptions();
  return NextAuth(req, res, authOptions);
}
